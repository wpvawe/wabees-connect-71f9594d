/**
 * Assign / unassign a conversation to a team agent. Writes assignedAgentId
 * (+ email + timestamp) onto the conversation doc so both web & Flutter can
 * filter / display who owns each thread.
 */
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { phoneDocId } from "@/lib/firebase/normalizers";

export async function assignConversation(
  uid: string,
  phone: string,
  agent: { id: string; email: string | null } | null,
  actor: { uid: string; email: string | null },
): Promise<void> {
  const db = fbDb();
  await updateDoc(doc(db, `users/${uid}/conversations/${phoneDocId(phone)}`), {
    assignedAgentId: agent?.id ?? null,
    assignedAgentEmail: agent?.email ?? null,
    assignedAt: agent ? serverTimestamp() : null,
    assignedByUid: actor.uid,
    assignedByEmail: actor.email,
  });
}