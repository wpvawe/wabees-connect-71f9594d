import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  deleteField,
  Timestamp,
  query,
  limit,
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
  const allowed = ["user", "admin"];
  if (!allowed.includes(role)) {
    throw new Error(`Invalid role "${role}". Must be one of: ${allowed.join(", ")}.`);
  }
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

// Hard-delete a user + all subcollections we know about. This is destructive
// and IRREVERSIBLE; the drawer wraps it in a double-confirm before calling.
// Note: Auth user record cannot be removed from the client SDK — that needs
// Firebase Admin (server function). We flag the doc as deleted for now and
// wipe the Firestore-side data; Auth cleanup should be done from the admin
// console or a future server function.
export async function deleteUserData(uid: string) {
  const db = fbDb();
  const subcollections = [
    "messages",
    "conversations",
    "contacts",
    "bots",
    "campaigns",
    "templates",
    "canned",
    "settings",
    "subscription",
    "notifications",
    "scheduled_messages",
    "tags",
    "products",
    "call_logs",
    "csat_surveys",
    "bot_config",
    "bot_usage",
    "bot_leads",
    "agents",
    "agent_invites",
    "whatsapp_config",
  ];
  for (const name of subcollections) {
    // Paginate & batch-delete up to a safe cap to avoid runaway loops.
    for (let round = 0; round < 20; round++) {
      const snap = await getDocs(
        query(collection(db, "users", uid, name), limit(200)),
      );
      if (snap.empty) break;
      const batch = writeBatch(db);
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      if (snap.size < 200) break;
    }
  }
  // Root user doc last so we can inspect leftovers if anything above throws.
  await deleteDoc(doc(db, "users", uid));
  // Clean up any pending subscription request under the same uid.
  try {
    await deleteDoc(doc(db, "pending_subscriptions", uid));
  } catch {
    /* absent */
  }
}

// Broadcast a custom notification. `uids: null` means "every user" and paginates
// through the users collection in batches. Otherwise writes to the targeted uids.
export async function broadcastNotification(args: {
  uids: string[] | null;
  /**
   * When broadcasting to "all users", pass a pre-loaded UID list from the
   * already-streaming `useAllUsers()` hook. This avoids a second full-read
   * of the users collection (which on Firestore charges one read per user
   * doc). Falls back to `getDocs(users)` only if not provided.
   */
  allUidsHint?: string[];
  title: string;
  body: string;
  type?: string;
}): Promise<number> {
  const db = fbDb();
  const title = args.title.trim().slice(0, 120);
  const body = args.body.trim().slice(0, 500);
  if (!title || !body) throw new Error("Title and message are required");
  const type = (args.type ?? "admin_broadcast").slice(0, 40);
  let targets: string[];
  if (args.uids) {
    targets = args.uids;
  } else if (args.allUidsHint && args.allUidsHint.length > 0) {
    targets = args.allUidsHint;
  } else {
    const usersSnap = await getDocs(collection(db, "users"));
    targets = usersSnap.docs.map((d) => d.id);
  }
  if (targets.length === 0) return 0;
  const payload = {
    title,
    body,
    type,
    data: {},
    read: false,
  };
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const uid of targets.slice(i, i + CHUNK)) {
      const ref = doc(collection(db, "users", uid, "notifications"));
      batch.set(ref, { ...payload, createdAt: serverTimestamp() });
    }
    await batch.commit();
    written += Math.min(CHUNK, targets.length - i);
  }
  return written;
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

  // Carry-over counters from the user's EXISTING subscription doc, not from
  // the pending request (which was written by the user and can be tampered).
  const currentSnap = await getDoc(doc(db, "users", userId, "subscription", "current"));
  const current =
    currentSnap.exists() ? (currentSnap.data() as Record<string, unknown>) : {};
  const carriedContacts = typeof current.contactsUsed === "number" ? current.contactsUsed : 0;
  const carriedBots = typeof current.botsUsed === "number" ? current.botsUsed : 0;
  const carriedTemplates = typeof current.templatesUsed === "number" ? current.templatesUsed : 0;

  const newSub = {
    id: "current",
    planId,
    planName: (plan.name as string) ?? "",
    status: "active",
    messagesUsed: 0,
    contactsUsed: carriedContacts,
    campaignsUsed: 0,
    botsUsed: carriedBots,
    templatesUsed: carriedTemplates,
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
    createdAt: current.createdAt ?? now,
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
  // Ensure chat doc has userId (chatId IS the user's uid per rules) so the
  // admin list still shows a label even when the admin is the first to write.
  await setDoc(
    doc(db, "support_chats", chatId),
    {
      userId: chatId,
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