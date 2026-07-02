/**
 * Assign / unassign a conversation to a team agent. Writes assignedAgentId
 * (+ email + timestamp) onto the conversation doc so both web & Flutter can
 * filter / display who owns each thread. Also appends an entry to the
 * `conversations/{convId}/assign_log` subcollection for a full audit trail
 * (who assigned/reassigned to whom, when, and optional reason).
 */
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { normalizePhone, phoneDocId } from "@/lib/firebase/normalizers";
import { resolveConversationDocIds } from "@/lib/firebase/conversations";

export async function assignConversation(
  uid: string,
  phone: string,
  agent: { id: string; email: string | null } | null,
  actor: { uid: string; email: string | null },
  options?: { reason?: string; source?: "manual" | "auto_reply" | "auto_round_robin" },
): Promise<void> {
  const db = fbDb();
  const ids = await resolveConversationDocIds(uid, phone);
  const reason = options?.reason?.trim() || null;
  const source = options?.source ?? "manual";
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
  // Audit-log entry — best-effort, never blocks the assign call.
  try {
    const canonical = phoneDocId(phone);
    await addDoc(
      collection(db, `users/${uid}/conversations/${canonical}/assign_log`),
      {
        agentId: agent?.id ?? null,
        agentEmail: agent?.email ?? null,
        action: agent ? "assign" : "unassign",
        source,
        reason,
        actorUid: actor.uid,
        actorEmail: actor.email,
        at: serverTimestamp(),
      },
    );
  } catch {
    /* audit is best-effort */
  }
}