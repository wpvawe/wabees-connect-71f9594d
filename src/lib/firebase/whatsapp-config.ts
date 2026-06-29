import { arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { fbAuth, fbDb } from "@/integrations/firebase/client";
import { clearWebhookOwnerCache, subscribeWhatsAppWebhook } from "@/lib/wabees/api";
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
  const mapRef = doc(db, "wa_map", input.phone_number_id);
  const now = serverTimestamp();

  // Server repair must run BEFORE this new website UID writes
  // `whatsappPhoneNumberId`; otherwise a brand-new email becomes a candidate
  // and can hijack an already-connected phone from the mobile app owner.
  const serverIdToken = await fbAuth().currentUser?.getIdToken().catch(() => null);
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
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Could not verify existing WhatsApp owner");
  }

  // Only if the authoritative server-side repair is unavailable do we use the
  // older client-side fallback. Even here, resolve owner BEFORE writing this
  // UID's `whatsappPhoneNumberId`, otherwise a brand-new email contaminates the
  // lookup and can look like the owner.
  const currentUserSnap = await getDoc(userRef).catch(() => null);
  const currentUserData = currentUserSnap?.exists() ? (currentUserSnap.data() as Record<string, unknown>) : {};
  const existingDataOwner = typeof currentUserData.dataOwner === "string" && currentUserData.dataOwner.trim()
    ? currentUserData.dataOwner.trim()
    : null;
  const existingOwnerId = existingDataOwner ?? (await resolveExistingOwnerForPhone(input.phone_number_id, input.uid));

  const isAgent = !!existingOwnerId && existingOwnerId !== input.uid;

  // Inspect the current wa_map. If `ownerId` already points at someone other
  // than this UID, we MUST NOT overwrite it — even if our local resolution
  // came back as self. That's the bug that turned the website into a separate
  // data island after a reconnect.
  let mapOwnerOther: string | null = null;
  try {
    const mapSnap = await getDoc(mapRef);
    if (mapSnap.exists()) {
      const m = mapSnap.data() as Record<string, unknown>;
      const owner = typeof m.ownerId === "string" ? m.ownerId : typeof m.userId === "string" ? m.userId : null;
      if (owner && owner !== input.uid) mapOwnerOther = owner;
    }
  } catch {
    /* rules may block — ignore */
  }

  const effectiveOwner = isAgent
    ? existingOwnerId
    : (mapOwnerOther ?? null);
  const treatAsAgent = !!effectiveOwner && effectiveOwner !== input.uid;

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
        // Critical: link this UID to the owner whose Firestore subcollections
        // hold the real data. `useEffectiveUid()` reads this. When this user
        // really is the owner, clear any stale dataOwner.
        dataOwner: treatAsAgent ? effectiveOwner : deleteField(),
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

  // If this website account is being linked to the mobile app's existing data
  // owner, mirror the fresh credentials onto the owner too. The Flutter app's
  // send flow resolves the owner's config first; without this, app may keep
  // reading old/revoked credentials while the website uses the new token.
  if (treatAsAgent && effectiveOwner) {
    await Promise.all([
      setDoc(
        doc(db, "users", effectiveOwner),
        {
          whatsappPhoneNumberId: input.phone_number_id,
          whatsappAccessToken: input.access_token,
          whatsappBusinessAccountId: input.waba_id ?? null,
          whatsappDisplayPhone: input.display_phone ?? null,
          whatsappQualityRating: input.quality_rating ?? null,
          whatsappConnected: true,
          updatedAt: now,
        },
        { merge: true },
      ).catch(() => undefined),
      setDoc(
        doc(db, "users", effectiveOwner, "whatsapp_config", "config"),
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
      ).catch(() => undefined),
    ]);
  }

  // Webhook routing map used by the PHP backend.
  if (treatAsAgent && effectiveOwner) {
    // Register this UID as an agent under the existing owner. Do NOT
    // overwrite `wa_map.ownerId` — webhook keeps routing to the original
    // owner's subcollections, which both clients read via dataOwner.
    try {
      // If wa_map.ownerId was previously hijacked by this UID (a bad earlier
      // reconnect), restore the real owner so the PHP webhook routes to the
      // correct subcollections again.
      const needsRestore = mapOwnerOther !== effectiveOwner;
      await setDoc(
        mapRef,
        needsRestore
          ? {
              ownerId: effectiveOwner,
              userId: effectiveOwner,
              users: arrayUnion({ userId: input.uid }, { userId: effectiveOwner }),
                active: true,
              updatedAt: now,
            }
          : { users: arrayUnion({ userId: input.uid }), updatedAt: now },
        { merge: true },
      ).catch(() => {});
      await setDoc(
        doc(db, "users", effectiveOwner, "agents", input.uid),
        {
          email: fbAuth().currentUser?.email ?? null,
          joinedAt: now,
        },
        { merge: true },
      );
    } catch {
      // Non-fatal — owner's rules may not allow agent writes from this UID.
    }
  } else {
    // Current user is the owner (first connect or legitimate reconnect).
    await setDoc(
      mapRef,
      {
        userId: input.uid,
        ownerId: input.uid,
        users: arrayUnion({ userId: input.uid }),
        active: true,
        accessTokenUpdatedAt: now,
        updatedAt: now,
      },
      { merge: true },
    ).catch(() => {});
  }

  // Subscribe only AFTER wa_map has the final owner. Otherwise the PHP backend
  // can re-cache the wrong owner while handling subscribe-webhook.php.
  if (!treatAsAgent) {
    await subscribeWhatsAppWebhook({
      phone_number_id: input.phone_number_id,
      access_token: input.access_token,
    }).catch(() => null);
  }

  await clearWebhookOwnerCache(input.phone_number_id).catch(() => null);

  // Final authoritative repair runs through the backend credentials so it can
  // see all users/wa_map documents, unlike client rules which only expose the
  // signed-in user's own docs. This fixes reconnects where the website UID had
  // already hijacked wa_map and the mobile app kept reading the old owner tree.
  const idToken = await fbAuth().currentUser?.getIdToken().catch(() => null);
  if (idToken) {
    await repairWhatsAppOwnerServer({
      data: {
        idToken,
        phoneNumberId: input.phone_number_id,
        accessToken: input.access_token,
        businessAccountId: input.waba_id ?? "",
        displayPhone: input.display_phone ?? "",
        businessName: input.business_name ?? "",
        qualityRating: input.quality_rating ?? "",
        connectedVia: input.connected_via ?? "manual",
      },
    }).catch(() => null);
  }
}

export async function disconnectWhatsApp(uid: string): Promise<void> {
  const db = fbDb();
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef).catch(() => null);
  const data = snap?.exists() ? (snap.data() as Record<string, unknown>) : {};
  const phoneId =
    (data.whatsappPhoneNumberId as string | undefined) ??
    (await getDoc(doc(db, "users", uid, "whatsapp_config", "config")).then((s) =>
      s.exists() ? (s.data().phoneNumberId as string | undefined) : undefined,
    ).catch(() => undefined));
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
      { isConnected: false, accessToken: "", updatedAt: serverTimestamp() },
      { merge: true },
    ),
  ]);
  if (isAgent) {
    await deleteDoc(doc(db, "users", dataOwner, "agents", uid)).catch(() => {});
  } else if (phoneId) {
    const agents = await getDocs(collection(db, "users", uid, "agents")).catch(() => null);
    if (!agents || agents.empty) {
      await deleteDoc(doc(db, "wa_map", phoneId)).catch(() => {});
    }
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

async function loadOwnWaCredentials(uid: string): Promise<{ phone_number_id: string; access_token: string } | null> {
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

export async function loadWaCredentials(uid: string): Promise<{ phone_number_id: string; access_token: string } | null> {
  const db = fbDb();
  const self = await getDoc(doc(db, "users", uid)).catch(() => null);
  const selfData = self?.exists() ? (self.data() as Record<string, unknown>) : {};
  const dataOwner = typeof selfData.dataOwner === "string" && selfData.dataOwner ? selfData.dataOwner : null;
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

export async function repairWhatsAppOwnership(uid: string): Promise<string | null> {
  const db = fbDb();
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef).catch(() => null);
  const user = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : {};
  const cfgSnap = await getDoc(doc(db, "users", uid, "whatsapp_config", "config")).catch(() => null);
  const cfg = cfgSnap?.exists() ? (cfgSnap.data() as Record<string, unknown>) : {};
  const phoneNumberId =
    (typeof user.whatsappPhoneNumberId === "string" && user.whatsappPhoneNumberId) ||
    (typeof cfg.phoneNumberId === "string" && cfg.phoneNumberId) ||
    "";
  if (!phoneNumberId) return null;

  const ownerId = await resolveExistingOwnerForPhone(phoneNumberId, uid);
  if (!ownerId || ownerId === uid) return uid;

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