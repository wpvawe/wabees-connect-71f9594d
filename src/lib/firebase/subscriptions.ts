import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbAuth, fbDb } from "@/integrations/firebase/client";
import type { Plan } from "@/hooks/usePlans";

export async function requestSubscription(uid: string, plan: Plan): Promise<void> {
  const db = fbDb();
  // Guard: block duplicate requests while a previous one is still pending.
  const pendingRef = doc(db, "pending_subscriptions", uid);
  const pendingSnap = await getDoc(pendingRef).catch(() => null);
  if (pendingSnap?.exists()) {
    const p = pendingSnap.data() as Record<string, unknown>;
    if (String(p.status ?? "") === "pending") {
      throw new Error(
        `You already have a pending request for "${String(p.planName ?? "a plan")}". Wait for admin approval.`,
      );
    }
  }
  const userSnap = await getDoc(doc(db, "users", uid)).catch(() => null);
  const user = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : {};
  const currentSnap = await getDoc(doc(db, "users", uid, "subscription", "current")).catch(
    () => null,
  );
  const current = currentSnap?.exists() ? (currentSnap.data() as Record<string, unknown>) : {};
  await setDoc(
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
