/**
 * Scheduled outbound messages. Stored under
 * users/{uid}/scheduled_messages/{id}. Delivered by the server cron
 * (backend/api/cron/dispatch-scheduled.php) every minute — the client
 * dispatcher (useScheduledDispatcher) still runs as a warm-tab fallback.
 * Text-only. Supports optional recurrence (daily / weekly / monthly): the
 * cron re-queues the next occurrence after a successful send.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { normalizePhone } from "@/lib/firebase/normalizers";

export type ScheduledStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";
export type ScheduledRecurrence = "none" | "daily" | "weekly" | "monthly";

export type ScheduledMessage = {
  id: string;
  contactPhone: string;
  body: string;
  scheduledFor: string | null;
  status: ScheduledStatus;
  errorReason: string | null;
  createdAt: string | null;
  sentMessageId: string | null;
  recurrence: ScheduledRecurrence;
};

export async function createScheduledMessage(
  uid: string,
  args: { phone: string; body: string; scheduledFor: Date; recurrence?: ScheduledRecurrence },
): Promise<string> {
  const db = fbDb();
  const ref = await addDoc(collection(db, `users/${uid}/scheduled_messages`), {
    contactPhone: normalizePhone(args.phone),
    body: args.body.trim(),
    scheduledFor: Timestamp.fromDate(args.scheduledFor),
    status: "pending",
    errorReason: null,
    sentMessageId: null,
    recurrence: args.recurrence ?? "none",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateScheduledMessage(
  uid: string,
  id: string,
  args: { body?: string; scheduledFor?: Date; recurrence?: ScheduledRecurrence },
): Promise<void> {
  const db = fbDb();
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (args.body !== undefined) patch.body = args.body.trim();
  if (args.scheduledFor) patch.scheduledFor = Timestamp.fromDate(args.scheduledFor);
  if (args.recurrence !== undefined) patch.recurrence = args.recurrence;
  await updateDoc(doc(db, `users/${uid}/scheduled_messages/${id}`), patch);
}

export async function cancelScheduledMessage(uid: string, id: string): Promise<void> {
  const db = fbDb();
  await updateDoc(doc(db, `users/${uid}/scheduled_messages/${id}`), {
    status: "cancelled",
  });
}

export async function deleteScheduledMessage(uid: string, id: string): Promise<void> {
  const db = fbDb();
  await deleteDoc(doc(db, `users/${uid}/scheduled_messages/${id}`));
}