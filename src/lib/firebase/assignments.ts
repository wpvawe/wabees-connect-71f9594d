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
  updateDoc,
  deleteField,
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

// ============================================================
// Batch A additions — conversation state + agent lifecycle
// ============================================================

export type ConversationState = "open" | "pending" | "resolved" | "snoozed";

/**
 * Set the workflow state of a conversation (open / pending / resolved / snoozed).
 * Writes to every legacy doc-id variant of the phone so mixed-id inboxes stay
 * consistent. Appends an audit-log entry on the canonical doc.
 */
export async function setConversationState(
  uid: string,
  phone: string,
  state: ConversationState,
  actor: { uid: string; email: string | null },
  options?: { reason?: string; snoozeUntil?: Date | null },
): Promise<void> {
  const db = fbDb();
  const ids = await resolveConversationDocIds(uid, phone);
  const reason = options?.reason?.trim() || null;
  const snoozeUntilIso = options?.snoozeUntil ? options.snoozeUntil.toISOString() : null;
  await Promise.all(
    ids.map((id) =>
      setDoc(
        doc(db, `users/${uid}/conversations/${id}`),
        {
          contactPhone: normalizePhone(phone),
          state,
          stateUpdatedAt: serverTimestamp(),
          stateUpdatedByUid: actor.uid,
          stateUpdatedByEmail: actor.email,
          resolvedAt: state === "resolved" ? serverTimestamp() : null,
          snoozeUntil: state === "snoozed" ? snoozeUntilIso : null,
        },
        { merge: true },
      ),
    ),
  );
  try {
    const canonical = phoneDocId(phone);
    await addDoc(
      collection(db, `users/${uid}/conversations/${canonical}/assign_log`),
      {
        action: `state:${state}`,
        state,
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

/**
 * Revoke an agent's access immediately by writing `status: 'revoked'` on
 * their agent doc. Rules block any request whose caller's agent doc is
 * revoked, so this takes effect on the next Firestore read from that
 * session. Cheaper and safer than deleting the doc: the row stays visible
 * to the owner for audit, and can be un-revoked if needed.
 */
export async function revokeAgent(
  ownerUid: string,
  agentId: string,
  actor: { uid: string; email: string | null },
): Promise<void> {
  await setDoc(
    doc(fbDb(), `users/${ownerUid}/agents/${agentId}`),
    {
      status: "revoked",
      revokedAt: serverTimestamp(),
      revokedByUid: actor.uid,
      revokedByEmail: actor.email,
    },
    { merge: true },
  );
}

/** Reactivate a previously-revoked agent (owner-only in the UI). */
export async function reinstateAgent(ownerUid: string, agentId: string): Promise<void> {
  await updateDoc(doc(fbDb(), `users/${ownerUid}/agents/${agentId}`), {
    status: "active",
    revokedAt: deleteField(),
    revokedByUid: deleteField(),
    revokedByEmail: deleteField(),
  });
}

/** Update an agent's role (owner-only). */
export async function updateAgentRole(
  ownerUid: string,
  agentId: string,
  role: "agent" | "supervisor",
): Promise<void> {
  await updateDoc(doc(fbDb(), `users/${ownerUid}/agents/${agentId}`), { role });
}