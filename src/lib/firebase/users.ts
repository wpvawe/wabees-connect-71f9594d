import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

/**
 * Create the `users/{uid}` Firestore document if missing. Mirrors the shape
 * written by the Flutter app (`UserModel.toJson`) so the same account on
 * either platform shows the same profile fields.
 */
export async function ensureUserDoc(
  user: User,
  extras: { businessName?: string; phoneNumber?: string } = {},
): Promise<void> {
  const ref = doc(fbDb(), "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    const patch: Record<string, unknown> = {};
    if (!data.email && user.email) patch.email = user.email;
    if (!data.profileImageUrl && user.photoURL) patch.profileImageUrl = user.photoURL;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = serverTimestamp();
      await setDoc(ref, patch, { merge: true });
    }
    return;
  }
  await setDoc(ref, {
    email: user.email ?? "",
    businessName: extras.businessName ?? user.displayName ?? "",
    phoneNumber: extras.phoneNumber ?? user.phoneNumber ?? "",
    role: "user",
    status: "pending",
    profileImageUrl: user.photoURL ?? null,
    whatsappConnected: false,
    whatsappPhoneNumberId: null,
    whatsappAccessToken: null,
    whatsappBusinessAccountId: null,
    whatsappDisplayPhone: null,
    whatsappQualityRating: null,
    dataOwner: null,
    fcmToken: null,
    apiKey: null,
    totalMessages: 0,
    totalContacts: 0,
    totalBots: 0,
    totalCampaigns: 0,
    aiBotEnabled: false,
    isOnline: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}