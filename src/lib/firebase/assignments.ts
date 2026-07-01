/**
 * Assign / unassign a conversation to a team agent. Writes assignedAgentId
 * (+ email + timestamp) onto the conversation doc so both web & Flutter can
 * filter / display who owns each thread.
 */
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { normalizePhone } from "@/lib/firebase/normalizers";
import { resolveConversationDocIds } from "@/lib/firebase/conversations";

export async function assignConversation(
  uid: string,
  phone: string,
  agent: { id: string; email: string | null } | null,
  actor: { uid: string; email: string | null },
): Promise<void> {
  const db = fbDb();
  const ids = await resolveConversationDocIds(uid, phone);
  await Promise.all(
    ids.map((id) =>
      setDoc(
        doc(db, `users/${uid}/conversations/${id}`),
        {
          contactPhone: normalizePhone(phone),
          assignedAgentId: agent?.id ?? null,
          assignedAgentEmail: agent?.email ?? null,
          assignedAt: agent ? serverTimestamp() : null,
          assignedByUid: actor.uid,
          assignedByEmail: actor.email,
        },
        { merge: true },
      ),
    ),
  );
}