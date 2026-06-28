import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

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
};

export async function saveWhatsAppConfig(input: SaveWaConfigInput): Promise<void> {
  const db = fbDb();
  const userRef = doc(db, "users", input.uid);
  const subRef = doc(db, "users", input.uid, "whatsapp_config", "config");
  const now = serverTimestamp();
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
        connectedAt: now,
        lastVerifiedAt: now,
      },
      { merge: true },
    ),
  ]);
}

export async function disconnectWhatsApp(uid: string): Promise<void> {
  const db = fbDb();
  await Promise.all([
    updateDoc(doc(db, "users", uid), {
      whatsappPhoneNumberId: null,
      whatsappAccessToken: null,
      whatsappBusinessAccountId: null,
      whatsappDisplayPhone: null,
      whatsappQualityRating: null,
      whatsappConnected: false,
      updatedAt: serverTimestamp(),
    }),
    setDoc(
      doc(db, "users", uid, "whatsapp_config", "config"),
      { isConnected: false, accessToken: "", updatedAt: serverTimestamp() },
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