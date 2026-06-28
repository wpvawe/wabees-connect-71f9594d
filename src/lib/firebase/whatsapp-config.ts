import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

/**
 * WhatsApp config is mirrored in two places, matching the Flutter app:
 *  - `users/{uid}` top-level fields (whatsappPhoneNumberId, whatsappAccessToken,
 *    whatsappConnected) — read for quick checks.
 *  - `users/{uid}/whatsapp_config/main` — the WhatsappConfig document with
 *    extended metadata (businessAccountId, qualityRating, etc).
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
  const subRef = doc(db, "users", input.uid, "whatsapp_config", "main");
  const now = serverTimestamp();
  await Promise.all([
    setDoc(
      userRef,
      {
        whatsappPhoneNumberId: input.phone_number_id,
        whatsappAccessToken: input.access_token,
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
      whatsappConnected: false,
      updatedAt: serverTimestamp(),
    }),
    setDoc(
      doc(db, "users", uid, "whatsapp_config", "main"),
      { isConnected: false, accessToken: "", updatedAt: serverTimestamp() },
      { merge: true },
    ),
  ]);
}

export async function loadWaCredentials(uid: string): Promise<{ phone_number_id: string; access_token: string } | null> {
  const snap = await getDoc(doc(fbDb(), "users", uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  const phone_number_id = d.whatsappPhoneNumberId as string | undefined;
  const access_token = d.whatsappAccessToken as string | undefined;
  if (!phone_number_id || !access_token) return null;
  return { phone_number_id, access_token };
}