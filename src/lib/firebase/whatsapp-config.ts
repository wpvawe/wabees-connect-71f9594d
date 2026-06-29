import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { fbAuth, fbDb } from "@/integrations/firebase/client";

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

  // --- dataOwner detection (mirrors the Flutter app) ---------------------
  // If `wa_map/{phoneNumberId}` already names a different ownerId, the
  // current user is an AGENT — set `users/{uid}.dataOwner = existingOwner`
  // and register under the owner. Do NOT overwrite the existing owner,
  // otherwise the webhook will route incoming messages to the wrong UID
  // and the website + mobile app will see split conversations.
  let existingOwnerId: string | null = null;
  try {
    const existing = await getDoc(mapRef);
    if (existing.exists()) {
      const d = existing.data() as Record<string, unknown>;
      existingOwnerId = (d.ownerId as string | undefined)
        ?? (d.userId as string | undefined)
        ?? null;
    }
  } catch {
    // Non-fatal — treat as no existing owner.
  }

  const isAgent = !!existingOwnerId && existingOwnerId !== input.uid;

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
        // hold the real data. `useEffectiveUid()` reads this. When user is
        // the owner themselves, clear any stale dataOwner.
        dataOwner: isAgent ? existingOwnerId : deleteField(),
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

  // Webhook routing map used by the PHP backend.
  if (isAgent && existingOwnerId) {
    // Register this UID as an agent under the existing owner. Do NOT
    // overwrite `wa_map.ownerId` — webhook keeps routing to the original
    // owner's subcollections, which both clients read via dataOwner.
    try {
      await setDoc(
        doc(db, "users", existingOwnerId, "agents", input.uid),
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
    // Current user is the owner (first connect or reconnect).
    await setDoc(
      mapRef,
      {
        userId: input.uid,
        ownerId: input.uid,
        updatedAt: now,
      },
      { merge: true },
    ).catch(() => {});
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

export async function loadWaCredentials(uid: string): Promise<{ phone_number_id: string; access_token: string } | null> {
  const db = fbDb();
  // Prefer the subcollection doc the Flutter app writes
  // (`users/{uid}/whatsapp_config/config`). Fall back to the top-level
  // mirrored fields the website used before, for older website-only setups.
  const sub = await getDoc(doc(db, "users", uid, "whatsapp_config", "config"));
  if (sub.exists()) {
    const d = sub.data();
    const phone_number_id = (d.phoneNumberId as string | undefined) ?? undefined;
    const access_token = (d.accessToken as string | undefined) ?? undefined;
    if (phone_number_id && access_token) return { phone_number_id, access_token };
  }
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) {
    const d = snap.data();
    const phone_number_id = d.whatsappPhoneNumberId as string | undefined;
    const access_token = d.whatsappAccessToken as string | undefined;
    if (phone_number_id && access_token) return { phone_number_id, access_token };
  }
  return null;
}