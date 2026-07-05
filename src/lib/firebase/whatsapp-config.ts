import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { fbAuth, fbDb } from "@/integrations/firebase/client";
import { clearWebhookOwnerCache } from "@/lib/wabees/api";
import { resolveExistingOwnerForPhone } from "@/lib/firebase/owner";
import { repairWhatsAppOwnerServer } from "@/lib/firebase/owner-repair.functions";

/**
 * WhatsApp config is mirrored in two places, matching the Flutter app:
 *  - `users/{uid}` top-level fields (whatsappPhoneNumberId, whatsappAccessToken,
 *    whatsappConnected, whatsappBusinessAccountId, whatsappDisplayPhone,
 *    whatsappQualityRating) — read for quick checks.
 *  - `users/{uid}/whatsapp_config/config` — the WhatsappConfig document with
 *    full metadata. Doc id is `config` to match the Flutter app
 *    (FirestorePaths.whatsappConfig).
 */
export type SaveWaConfigInput = {
  uid: string;
  phone_number_id: string;
  access_token: string;
  waba_id?: string;
  display_phone?: string;
  business_name?: string;
  quality_rating?: string;
  connected_via?: "embedded_signup" | "manual";
};

export async function saveWhatsAppConfig(input: SaveWaConfigInput): Promise<void> {
  const db = fbDb();
  const userRef = doc(db, "users", input.uid);
  const subRef = doc(db, "users", input.uid, "whatsapp_config", "config");
  const now = serverTimestamp();

  // Authoritative server-side ownership repair is required. The client cannot
  // safely decide whether this phone belongs to a disconnected historical
  // owner, an active workspace, or the current signed-in account.
  const serverIdToken = await fbAuth()
    .currentUser?.getIdToken()
    .catch(() => null);
  if (!serverIdToken) throw new Error("Please sign in again before connecting WhatsApp");
  try {
    const serverRepair = await repairWhatsAppOwnerServer({
      data: {
        idToken: serverIdToken,
        phoneNumberId: input.phone_number_id,
        accessToken: input.access_token,
        businessAccountId: input.waba_id ?? "",
        displayPhone: input.display_phone ?? "",
        businessName: input.business_name ?? "",
        qualityRating: input.quality_rating ?? "",
        connectedVia: input.connected_via ?? "manual",
      },
    });
    await clearWebhookOwnerCache(input.phone_number_id).catch(() => null);
    if (serverRepair?.ownerId) {
      // Server repair handled wa_map + owner writes. Mirror the caller's own
      // docs client-side as well so the active onSnapshot immediately switches
      // to users/{ownerId} through dataOwner, matching Flutter's dataOwner flow.
      await Promise.all([
        setDoc(
          userRef,
          {
            whatsappPhoneNumberId: input.phone_number_id,
            whatsappAccessToken: input.access_token,
            whatsappBusinessAccountId: input.waba_id ?? null,
            whatsappDisplayPhone: input.display_phone ?? null,
            whatsappQualityRating: input.quality_rating ?? null,
            whatsappConnected: true,
            dataOwner: serverRepair.ownerId !== input.uid ? serverRepair.ownerId : deleteField(),
            updatedAt: now,
          },
          { merge: true },
        ),
        setDoc(
          subRef,
          {
            phoneNumberId: input.phone_number_id,
            accessToken: input.access_token,
            businessAccountId: input.waba_id ?? "",
            webhookVerifyToken: "",
            displayPhoneNumber: input.display_phone ?? null,
            businessName: input.business_name ?? null,
            qualityRating: input.quality_rating ?? null,
            isConnected: true,
            connectedVia: input.connected_via ?? "manual",
            connectedAt: now,
            lastVerifiedAt: now,
          },
          { merge: true },
        ),
      ]);
      return;
    }
    throw new Error("We couldn't verify this number right now. Please try again in a moment.");
  } catch (error) {
    const emsg = error instanceof Error ? error.message : String(error ?? "");
    if (/already connected to another workspace/i.test(emsg)) {
      throw error instanceof Error ? error : new Error(emsg);
    }
    console.warn(
      "[wa-connect] server repair failed:",
      error instanceof Error ? error.message : error,
    );
    throw new Error("We couldn't verify this number right now. Please try again in a moment.");
  }

}

export async function disconnectWhatsApp(uid: string): Promise<void> {
  const db = fbDb();
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef).catch(() => null);
  const data = snap?.exists() ? (snap.data() as Record<string, unknown>) : {};
  const phoneId =
    (data.whatsappPhoneNumberId as string | undefined) ??
    (await getDoc(doc(db, "users", uid, "whatsapp_config", "config"))
      .then((s) => (s.exists() ? (s.data().phoneNumberId as string | undefined) : undefined))
      .catch(() => undefined));
  const dataOwner = (data.dataOwner as string | undefined) ?? "";
  const isAgent = Boolean(dataOwner);
  await Promise.all([
    updateDoc(userRef, {
      whatsappPhoneNumberId: null,
      whatsappAccessToken: null,
      whatsappBusinessAccountId: null,
      whatsappDisplayPhone: null,
      whatsappQualityRating: null,
      whatsappConnected: false,
      dataOwner: deleteField(),
      updatedAt: serverTimestamp(),
    }),
    setDoc(
      doc(db, "users", uid, "whatsapp_config", "config"),
      {
        // Keep the phone id as disconnected history so a later reconnect of
        // the same WhatsApp number can find and move the existing workspace
        // data. Runtime session repair ignores this because isConnected=false.
        phoneNumberId: phoneId ?? deleteField(),
        accessToken: "",
        businessAccountId: "",
        displayPhoneNumber: null,
        businessName: null,
        qualityRating: null,
        isConnected: false,
        disconnectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  ]);
  if (isAgent) {
    await deleteDoc(doc(db, "users", dataOwner, "agents", uid)).catch(() => {});
  } else if (phoneId) {
    // Owner disconnect: cancel pending scheduled messages and pause any
    // currently-running campaigns so the cron does not keep retrying against
    // a revoked access token, and the user sees clear "cancelled — WhatsApp
    // disconnected" state instead of a silent retry loop.
    await pauseOutboundWorkOnDisconnect(uid).catch(() => undefined);
    // Disconnect means the number is no longer owned by this workspace.
    // Always remove webhook routing so another account can connect the same
    // phone cleanly; agents will see the disconnected-workspace gate.
    await deleteDoc(doc(db, "wa_map", phoneId)).catch(() => {});
    await clearWebhookOwnerCache(phoneId).catch(() => null);
  }
}

/**
 * Owner-side cleanup when the WhatsApp account is disconnected. Cancels any
 * `pending` scheduled messages and pauses any `running` campaigns so the
 * server cron does not keep retrying with a revoked token. Best-effort —
 * per-doc failures never block the disconnect itself.
 */
async function pauseOutboundWorkOnDisconnect(ownerUid: string): Promise<void> {
  const db = fbDb();
  const reason = "WhatsApp disconnected";
  const nowStamp = serverTimestamp();

  // Scheduled messages — mark pending as cancelled.
  try {
    const pending = await getDocs(
      query(
        collection(db, "users", ownerUid, "scheduled_messages"),
        where("status", "==", "pending"),
      ),
    );
    if (!pending.empty) {
      const batch = writeBatch(db);
      pending.docs.forEach((d) =>
        batch.update(d.ref, {
          status: "cancelled",
          errorReason: reason,
          updatedAt: nowStamp,
        }),
      );
      await batch.commit();
    }
  } catch {
    /* non-fatal */
  }

  // Campaigns — pause any running campaign.
  try {
    const running = await getDocs(
      query(collection(db, "users", ownerUid, "campaigns"), where("status", "==", "running")),
    );
    if (!running.empty) {
      const batch = writeBatch(db);
      running.docs.forEach((d) =>
        batch.update(d.ref, {
          status: "paused",
          pauseReason: reason,
          pausedAt: nowStamp,
        }),
      );
      await batch.commit();
    }
  } catch {
    /* non-fatal */
  }
}

export async function updateWhatsAppBusinessAccountId(uid: string, wabaId: string): Promise<void> {
  const db = fbDb();
  const clean = wabaId.trim();
  if (!clean) throw new Error("WABA ID is required");
  await Promise.all([
    setDoc(
      doc(db, "users", uid),
      { whatsappBusinessAccountId: clean, updatedAt: serverTimestamp() },
      { merge: true },
    ),
    setDoc(
      doc(db, "users", uid, "whatsapp_config", "config"),
      { businessAccountId: clean, updatedAt: serverTimestamp() },
      { merge: true },
    ),
  ]);
}

async function loadOwnWaCredentials(
  uid: string,
): Promise<{ phone_number_id: string; access_token: string } | null> {
  const db = fbDb();
  const self = await getDoc(doc(db, "users", uid)).catch(() => null);
  const sub = await getDoc(doc(db, "users", uid, "whatsapp_config", "config"));
  if (sub.exists()) {
    const d = sub.data();
    const phone_number_id = (d.phoneNumberId as string | undefined) ?? undefined;
    const access_token = (d.accessToken as string | undefined) ?? undefined;
    if (phone_number_id && access_token) return { phone_number_id, access_token };
  }
  if (self?.exists()) {
    const d = self.data();
    const phone_number_id = d.whatsappPhoneNumberId as string | undefined;
    const access_token = d.whatsappAccessToken as string | undefined;
    if (phone_number_id && access_token) return { phone_number_id, access_token };
  }
  return null;
}

export async function loadWaCredentials(
  uid: string,
): Promise<{ phone_number_id: string; access_token: string } | null> {
  const db = fbDb();
  const self = await getDoc(doc(db, "users", uid)).catch(() => null);
  const selfData = self?.exists() ? (self.data() as Record<string, unknown>) : {};
  const dataOwner =
    typeof selfData.dataOwner === "string" && selfData.dataOwner ? selfData.dataOwner : null;
  // Match Flutter _resolveConfig: agents try the owner's config first, then
  // fall back to their own config if the owner has no credentials.
  if (dataOwner && dataOwner !== uid) {
    const ownerCreds = await loadOwnWaCredentials(dataOwner).catch(() => null);
    if (ownerCreds) return ownerCreds;
  }
  const ownCreds = await loadOwnWaCredentials(uid).catch(() => null);
  if (ownCreds) return ownCreds;
  return null;
}

/**
 * Batch 4 (post Step B) — UI gating helper that ONLY returns the
 * `phone_number_id` (public routing id already visible in wa_map / webhook
 * URLs). The Meta `access_token` is intentionally NOT read into the
 * browser: PHP endpoints resolve it server-side from Firestore via the
 * verified Firebase bearer token (`wa-bearer-auth.php::wabees_apply_bearer_auth`).
 *
 * Use this in place of `loadWaCredentials` anywhere the UI just needs to
 * (a) gate an action on "is WhatsApp connected?" and (b) know which phone
 * number id to send to. It matches Flutter's `_resolveConfig` owner lookup
 * so agents get the owner's phone id, falling back to their own.
 */
async function loadOwnPhoneNumberId(uid: string): Promise<string | null> {
  const db = fbDb();
  const sub = await getDoc(doc(db, "users", uid, "whatsapp_config", "config")).catch(() => null);
  if (sub?.exists()) {
    const d = sub.data() as Record<string, unknown>;
    const id = typeof d.phoneNumberId === "string" ? d.phoneNumberId : null;
    const connected = d.isConnected !== false; // treat undefined as connected
    if (id && connected) return id;
  }
  const self = await getDoc(doc(db, "users", uid)).catch(() => null);
  if (self?.exists()) {
    const d = self.data() as Record<string, unknown>;
    const id = typeof d.whatsappPhoneNumberId === "string" ? d.whatsappPhoneNumberId : null;
    const connected = d.whatsappConnected !== false;
    if (id && connected) return id;
  }
  return null;
}

export async function loadWaConnection(
  uid: string,
): Promise<{ phone_number_id: string } | null> {
  const db = fbDb();
  const self = await getDoc(doc(db, "users", uid)).catch(() => null);
  const selfData = self?.exists() ? (self.data() as Record<string, unknown>) : {};
  const dataOwner =
    typeof selfData.dataOwner === "string" && selfData.dataOwner ? selfData.dataOwner : null;
  if (dataOwner && dataOwner !== uid) {
    const ownerId = await loadOwnPhoneNumberId(dataOwner).catch(() => null);
    if (ownerId) return { phone_number_id: ownerId };
  }
  const own = await loadOwnPhoneNumberId(uid).catch(() => null);
  if (own) return { phone_number_id: own };
  return null;
}

export async function repairWhatsAppOwnership(uid: string): Promise<string | null> {
  const db = fbDb();
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef).catch(() => null);
  const user = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : {};
  const cfgSnap = await getDoc(doc(db, "users", uid, "whatsapp_config", "config")).catch(
    () => null,
  );
  const cfg = cfgSnap?.exists() ? (cfgSnap.data() as Record<string, unknown>) : {};
  const phoneNumberId =
    (user.whatsappConnected !== false &&
      typeof user.whatsappPhoneNumberId === "string" &&
      user.whatsappPhoneNumberId) ||
    (cfg.isConnected !== false && typeof cfg.phoneNumberId === "string" && cfg.phoneNumberId) ||
    "";
  if (!phoneNumberId) return null;

  const ownerId = await resolveExistingOwnerForPhone(phoneNumberId, uid);
  if (!ownerId || ownerId === uid) return uid;

  const agentSnap = await getDoc(doc(db, "users", ownerId, "agents", uid)).catch(() => null);
  const agentStatus = agentSnap?.exists()
    ? ((agentSnap.data() as Record<string, unknown>).status as string | undefined) || "active"
    : "missing";
  if (!agentSnap?.exists() || agentStatus === "revoked" || agentStatus === "left") return null;

  const accessToken =
    (typeof user.whatsappAccessToken === "string" && user.whatsappAccessToken) ||
    (typeof cfg.accessToken === "string" && cfg.accessToken) ||
    "";
  const wabaId =
    (typeof user.whatsappBusinessAccountId === "string" && user.whatsappBusinessAccountId) ||
    (typeof cfg.businessAccountId === "string" && cfg.businessAccountId) ||
    "";

  await setDoc(userRef, { dataOwner: ownerId, updatedAt: serverTimestamp() }, { merge: true });
  await setDoc(
    doc(db, "wa_map", phoneNumberId),
    {
      ownerId,
      userId: ownerId,
      users: arrayUnion({ userId: uid }, { userId: ownerId }),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ).catch(() => undefined);

  if (accessToken) {
    await Promise.all([
      setDoc(
        doc(db, "users", ownerId),
        {
          whatsappPhoneNumberId: phoneNumberId,
          whatsappAccessToken: accessToken,
          whatsappBusinessAccountId: wabaId || null,
          whatsappConnected: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ).catch(() => undefined),
      setDoc(
        doc(db, "users", ownerId, "whatsapp_config", "config"),
        {
          phoneNumberId,
          accessToken,
          businessAccountId: wabaId,
          isConnected: true,
          lastVerifiedAt: serverTimestamp(),
        },
        { merge: true },
      ).catch(() => undefined),
    ]);
  }

  await clearWebhookOwnerCache(phoneNumberId).catch(() => null);
  return ownerId;
}
