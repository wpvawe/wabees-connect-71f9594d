/**
 * Scheduled outbound messages. Stored under
 * users/{uid}/scheduled_messages/{id} and dispatched client-side by
 * useScheduledDispatcher() whenever any tab is open. Text-only for the MVP.
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

export type ScheduledMessage = {
  id: string;
  contactPhone: string;
  body: string;
  scheduledFor: string | null;
  status: ScheduledStatus;
  errorReason: string | null;
  createdAt: string | null;
  sentMessageId: string | null;
};

export async function createScheduledMessage(
  uid: string,
  args: { phone: string; body: string; scheduledFor: Date },
): Promise<string> {
  const db = fbDb();
  const ref = await addDoc(collection(db, `users/${uid}/scheduled_messages`), {
    contactPhone: normalizePhone(args.phone),
    body: args.body.trim(),
    scheduledFor: Timestamp.fromDate(args.scheduledFor),
    status: "pending",
    errorReason: null,
    sentMessageId: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
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