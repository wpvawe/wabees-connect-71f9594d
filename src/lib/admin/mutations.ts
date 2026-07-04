import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  deleteField,
  Timestamp,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

// ============ USER ACTIONS ============
export async function setUserStatus(uid: string, status: string) {
  await updateDoc(doc(fbDb(), "users", uid), {
    status,
    updatedAt: serverTimestamp(),
  });
  if (status === "active") {
    // notify user
    try {
      await addDoc(collection(fbDb(), "users", uid, "notifications"), {
        title: "Account Approved 🎉",
        body: "Your account has been approved. You can now use all features.",
        type: "user_approved",
        data: {},
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch {
      /* non-critical */
    }
  }
}

export async function setUserRole(uid: string, role: string) {
  await updateDoc(doc(fbDb(), "users", uid), {
    role,
    updatedAt: serverTimestamp(),
  });
}

export async function setUserField(uid: string, field: string, value: unknown) {
  await updateDoc(doc(fbDb(), "users", uid), {
    [field]: value,
    updatedAt: serverTimestamp(),
  });
}

// ============ PENDING SUBS ============
export async function activatePendingSubscription(userId: string) {
  const db = fbDb();
  const pendingRef = doc(db, "pending_subscriptions", userId);
  const pendingSnap = await getDoc(pendingRef);
  if (!pendingSnap.exists()) throw new Error("No pending request found");
  const raw = pendingSnap.data() as Record<string, unknown>;
  const sub = (raw.subscription as Record<string, unknown>) ?? {};
  const planId = (sub.planId as string) ?? "";
  if (!planId) throw new Error("Pending request has no planId");

  const planSnap = await getDoc(doc(db, "plans", planId));
  if (!planSnap.exists()) throw new Error("Plan no longer exists");
  const plan = planSnap.data() as Record<string, unknown>;

  const expiryType = (plan.expiryType as string) ?? "monthly";
  const expiryDays = (plan.expiryDays as number) ?? 30;
  const days = expiryType === "yearly" ? (expiryDays <= 0 ? 365 : expiryDays) : expiryDays;
  const isLifetime = expiryType === "lifetime";

  const now = Timestamp.now();
  const endDate = isLifetime
    ? null
    : Timestamp.fromMillis(now.toMillis() + days * 24 * 60 * 60 * 1000);

  const newSub = {
    id: "current",
    planId,
    planName: (plan.name as string) ?? "",
    status: "active",
    messagesUsed: 0,
    contactsUsed: (sub.contactsUsed as number) ?? 0,
    campaignsUsed: (sub.campaignsUsed as number) ?? 0,
    botsUsed: (sub.botsUsed as number) ?? 0,
    templatesUsed: (sub.templatesUsed as number) ?? 0,
    aiMessagesUsed: 0,
    maxMessages: (plan.maxMessages as number) ?? 0,
    maxContacts: (plan.maxContacts as number) ?? 0,
    maxCampaigns: (plan.maxCampaigns as number) ?? 0,
    maxBots: (plan.maxBots as number) ?? 0,
    maxTemplates: (plan.maxTemplates as number) ?? 0,
    maxAiMessages: (plan.maxAiMessages as number) ?? 0,
    expiryType,
    expiryDays,
    startDate: now,
    endDate,
    activatedAt: now,
    createdAt: now,
  };

  await setDoc(doc(db, "users", userId, "subscription", "current"), newSub);
  await deleteDoc(pendingRef);

  // Reset bot usage
  await setDoc(
    doc(db, "users", userId, "bot_usage", "current"),
    {
      monthlyLimit: newSub.maxAiMessages,
      usedThisMonth: 0,
      currentPeriodStart: new Date().toISOString().slice(0, 7) + "-01",
    },
    { merge: true },
  );

  // Notify user
  try {
    await addDoc(collection(db, "users", userId, "notifications"), {
      title: "Plan Activated ✅",
      body: `Your ${newSub.planName} plan is now active.`,
      type: "plan_activated",
      data: { planId },
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    /* non-critical */
  }
}

export async function rejectPendingSubscription(userId: string) {
  const db = fbDb();
  const pendingRef = doc(db, "pending_subscriptions", userId);
  const pendingSnap = await getDoc(pendingRef);
  const planName =
    pendingSnap.exists()
      ? ((pendingSnap.data()?.subscription as Record<string, unknown> | undefined)?.planName as string) ?? "plan"
      : "plan";

  const subRef = doc(db, "users", userId, "subscription", "current");
  try {
    await updateDoc(subRef, {
      pendingPlanId: deleteField(),
      pendingPlanName: deleteField(),
    });
  } catch {
    /* subscription may not exist yet */
  }
  await deleteDoc(pendingRef);

  try {
    await addDoc(collection(db, "users", userId, "notifications"), {
      title: "Plan Request Declined",
      body: `Your request for ${planName} was declined. Please contact support.`,
      type: "plan_rejected",
      data: {},
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    /* non-critical */
  }
}

// ============ PLANS ============
export type PlanInput = {
  name: string;
  description: string;
  priceMonthly: number;
  currency: string;
  maxMessages: number;
  maxContacts: number;
  maxCampaigns: number;
  maxBots: number;
  maxTemplates: number;
  maxAiMessages: number;
  hasAnalytics: boolean;
  hasPrioritySupport: boolean;
  hasApiAccess: boolean;
  features: string[];
  expiryType: string;
  expiryDays: number;
  isActive: boolean;
  isPopular: boolean;
  showOnPublic: boolean;
  sortOrder: number;
};

export async function createPlan(input: PlanInput) {
  const db = fbDb();
  const ref = doc(collection(db, "plans"));
  await setDoc(ref, {
    ...input,
    isWelcomePlan: false,
    createdAt: serverTimestamp(),
  });
}

export async function updatePlan(planId: string, input: Partial<PlanInput>) {
  await updateDoc(doc(fbDb(), "plans", planId), input);
}

export async function deletePlan(planId: string) {
  const db = fbDb();
  const snap = await getDoc(doc(db, "plans", planId));
  if (snap.exists() && snap.data()?.isWelcomePlan === true) {
    throw new Error("Cannot delete the Welcome plan");
  }
  await deleteDoc(doc(db, "plans", planId));
}

export async function togglePlanActive(planId: string, isActive: boolean) {
  await updateDoc(doc(fbDb(), "plans", planId), { isActive });
}

// ============ ADMIN SUPPORT ============
export async function adminSendSupportMessage(
  chatId: string,
  adminUid: string,
  body: string,
  imageUrl: string | null,
) {
  const db = fbDb();
  await setDoc(
    doc(db, "support_chats", chatId),
    {
      lastMessage: body || (imageUrl ? "📷 Image" : ""),
      lastMessageAt: serverTimestamp(),
      unreadByUser: increment(1),
    },
    { merge: true },
  );
  await addDoc(collection(db, "support_chats", chatId, "messages"), {
    senderId: adminUid,
    senderRole: "admin",
    text: body,
    imageUrl,
    read: false,
    createdAt: serverTimestamp(),
  });
}

export async function markSupportChatReadByAdmin(chatId: string, unreadIds: string[]) {
  const db = fbDb();
  const batch = writeBatch(db);
  for (const id of unreadIds) {
    batch.update(doc(db, "support_chats", chatId, "messages", id), { read: true });
  }
  batch.set(doc(db, "support_chats", chatId), { unreadByAdmin: 0 }, { merge: true });
  await batch.commit();
}

// ============ CONFIG DOCS ============
export async function saveConfigDoc(
  path: [string, string],
  data: Record<string, unknown>,
) {
  await setDoc(
    doc(fbDb(), path[0], path[1]),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  );
}