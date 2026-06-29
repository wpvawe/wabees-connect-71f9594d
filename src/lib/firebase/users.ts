import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
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
    await ensureWelcomeSubscription(user.uid).catch(() => undefined);
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
  await ensureWelcomeSubscription(user.uid).catch(() => undefined);
}

async function ensureWelcomeSubscription(uid: string): Promise<void> {
  const db = fbDb();
  const subRef = doc(db, "users", uid, "subscription", "current");
  const existing = await getDoc(subRef);
  if (existing.exists()) return;

  const plans = await getDocs(
    query(collection(db, "plans"), where("isWelcomePlan", "==", true), limit(1)),
  ).catch(() => null);
  const planDoc = plans && !plans.empty ? plans.docs[0] : null;
  const plan = planDoc?.data() as Record<string, unknown> | undefined;
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  const str = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);

  await setDoc(
    subRef,
    {
      planId: planDoc?.id ?? "welcome",
      planName: str(plan?.name, "Welcome"),
      status: "active",
      maxMessages: num(plan?.maxMessages, 100),
      maxContacts: num(plan?.maxContacts, 50),
      maxCampaigns: num(plan?.maxCampaigns, 1),
      maxBots: num(plan?.maxBots, 1),
      maxTemplates: num(plan?.maxTemplates, 5),
      maxAiMessages: num(plan?.maxAiMessages, 0),
      messagesUsed: 0,
      contactsUsed: 0,
      campaignsUsed: 0,
      botsUsed: 0,
      templatesUsed: 0,
      aiMessagesUsed: 0,
      expiryType: str(plan?.expiryType, "monthly"),
      expiryDays: num(plan?.expiryDays, 30),
      startDate: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
  await setDoc(
    doc(db, "users", uid, "bot_usage", "current"),
    {
      monthlyLimit: num(plan?.maxAiMessages, 0),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ).catch(() => undefined);
}
