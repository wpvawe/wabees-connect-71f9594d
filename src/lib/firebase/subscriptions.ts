import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { fbAuth, fbDb } from "@/integrations/firebase/client";
import type { Plan } from "@/hooks/usePlans";
import {
  renderSubscriptionMessage,
  type SubscriptionMessages,
} from "@/lib/firebase/subscriptionMessages";
import { resolvePricing } from "@/lib/plans/pricing";

export async function requestSubscription(uid: string, plan: Plan): Promise<void> {
  const db = fbDb();
  const pendingRef = doc(db, "pending_subscriptions", uid);
  // Fetch user/current-plan data OUTSIDE the transaction (reads that don't
  // need the atomicity guarantee) so the transaction body stays tight and
  // avoids Firestore's transaction contention limits.
  const userSnap = await getDoc(doc(db, "users", uid)).catch(() => null);
  const user = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : {};
  const currentSnap = await getDoc(doc(db, "users", uid, "subscription", "current")).catch(
    () => null,
  );
  const current = currentSnap?.exists() ? (currentSnap.data() as Record<string, unknown>) : {};
  // Atomic read-then-write closes the TOCTOU window where a rapid double
  // click / concurrent tab could bypass the "already pending" guard because
  // both reads happened before either write completed.
  await runTransaction(db, async (tx) => {
    const pendingSnap = await tx.get(pendingRef);
    if (pendingSnap.exists()) {
      const p = pendingSnap.data() as Record<string, unknown>;
      if (String(p.status ?? "") === "pending") {
        throw new Error(
          `You already have a pending request for "${String(p.planName ?? "a plan")}". Wait for admin approval.`,
        );
      }
    }
    tx.set(
      pendingRef,
      {
        planId: plan.id,
        planName: plan.name,
        status: "pending",
        userId: uid,
        userName:
          (user.businessName as string | undefined) ?? fbAuth().currentUser?.displayName ?? "",
        userEmail: (user.email as string | undefined) ?? fbAuth().currentUser?.email ?? "",
        userPhone: (user.phoneNumber as string | undefined) ?? "",
        currentPlanId: (current.planId as string | undefined) ?? null,
        requestedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
  await addDoc(collection(db, "admin_notifications"), {
    type: "subscription_request",
    title: "New subscription request",
    body: `${(user.email as string | undefined) ?? fbAuth().currentUser?.email ?? uid} requested ${plan.name}`,
    userId: uid,
    planId: plan.id,
    planName: plan.name,
    read: false,
    createdAt: serverTimestamp(),
  }).catch(() => undefined);
}

/**
 * Post the subscription request as an auto message into the user's own
 * support chat (`support_chats/{uid}/messages`) so admin sees it in the
 * support inbox. The message text is rendered from the admin-editable
 * `supportChatTemplate` in `settings/subscription_messages`.
 */
export async function postSubscriptionRequestToSupport(
  uid: string,
  plan: Plan,
  messages: SubscriptionMessages,
  user: { name: string; email: string; phone: string },
): Promise<void> {
  const db = fbDb();
  const priced = resolvePricing(plan);
  const text = renderSubscriptionMessage(messages.supportChatTemplate, {
    plan: plan.name,
    price: priced.effectivePrice,
    currency: plan.currency,
    user: user.name,
    email: user.email,
    phone: user.phone,
  });
  await setDoc(
    doc(db, "support_chats", uid),
    {
      userId: uid,
      userEmail: user.email || fbAuth().currentUser?.email || "",
      lastMessage: text.slice(0, 120),
      lastMessageAt: serverTimestamp(),
      unreadByAdmin: increment(1),
    },
    { merge: true },
  );
  await addDoc(collection(db, "support_chats", uid, "messages"), {
    senderId: uid,
    senderRole: "user",
    text,
    imageUrl: null,
    read: false,
    kind: "subscription_request",
    planId: plan.id,
    planName: plan.name,
    createdAt: serverTimestamp(),
  });
}
