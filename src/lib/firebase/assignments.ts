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
  increment,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { normalizePhone, phoneDocId } from "@/lib/firebase/normalizers";
import { resolveConversationDocIds } from "@/lib/firebase/conversations";

export async function assignConversation(
  uid: string,
  phone: string,
  agent: { id: string; email: string | null } | null,
  actor: { uid: string; email: string | null },
  options?: {
    reason?: string;
    source?: "manual" | "auto_reply" | "auto_round_robin";
    /** id of the agent this thread was previously assigned to (for load balancing) */
    previousAgentId?: string | null;
  },
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
  // Best-effort load counter maintenance for round-robin fairness. Rules
  // allow owners+agents to update the shared agents/{id} row, so both a
  // supervisor reassigning and an owner auto-routing land here.
  const prev = options?.previousAgentId ?? null;
  const nextId = agent?.id ?? null;
  if (prev && prev !== nextId) {
    try {
      await updateDoc(doc(db, `users/${uid}/agents/${prev}`), {
        activeLoad: increment(-1),
      });
    } catch {
      /* counter drift is self-healing */
    }
  }
  if (nextId && nextId !== prev) {
    try {
      await updateDoc(doc(db, `users/${uid}/agents/${nextId}`), {
        activeLoad: increment(1),
      });
    } catch {
      /* counter drift is self-healing */
    }
  }
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
  options?: {
    reason?: string;
    snoozeUntil?: Date | null;
    /**
     * Current assignee id (before this state change). When set, we adjust
     * their `activeLoad` counter so round-robin stays fair:
     *   - resolving / snoozing → decrement (thread no longer counts)
     *   - reopening from resolved/snoozed → increment (thread counts again)
     * Best-effort; drift heals on the next assignment cycle.
     */
    assignedAgentId?: string | null;
    /** Previous state — required to decide whether load should shift. */
    previousState?: ConversationState;
  },
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
  // ---- activeLoad drift repair ----
  const assignee = options?.assignedAgentId ?? null;
  const prev = options?.previousState ?? "open";
  const isActive = (s: ConversationState) => s === "open" || s === "pending";
  const wasActive = isActive(prev);
  const nowActive = isActive(state);
  if (assignee && wasActive !== nowActive) {
    try {
      await updateDoc(doc(db, `users/${uid}/agents/${assignee}`), {
        activeLoad: increment(nowActive ? 1 : -1),
      });
    } catch {
      /* self-heals on next assignment */
    }
  }
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

// ============================================================
// Batch B — Load-balanced round-robin picker
// ============================================================

/**
 * Pick the next agent to route a conversation to, using a load-balanced
 * round-robin over active, non-revoked agents. Preference order:
 *   1. Online agents with the lowest `activeLoad` counter.
 *   2. Any active agent with the lowest `activeLoad`.
 *   3. `null` if the team has no eligible agents.
 *
 * The caller is responsible for actually calling `assignConversation` — this
 * helper is a pure ranker so both the UI ("Auto-assign" button) and any
 * future auto-assign trigger can share the same policy.
 *
 * `activeLoad` is maintained best-effort: `assignConversation` bumps the
 * chosen agent's counter and decrements the previous owner's. If load counts
 * drift, the queue re-normalises on the next assignment cycle — the field
 * is a hint, not the source of truth.
 */
export type PickCandidate = {
  id: string;
  email: string | null;
  role?: string | null;
  status?: string;
  isOnline?: boolean;
  activeLoad?: number;
  skills?: string[];
};

export function pickRoundRobinAgent(
  agents: PickCandidate[],
  excludeAgentId: string | null = null,
): PickCandidate | null {
  const eligible = agents.filter(
    (a) => a.id !== excludeAgentId && (a.status ?? "active") !== "revoked",
  );
  if (eligible.length === 0) return null;

  const byLoad = (a: PickCandidate, b: PickCandidate) =>
    (a.activeLoad ?? 0) - (b.activeLoad ?? 0);

  const online = eligible.filter((a) => a.isOnline).sort(byLoad);
  if (online.length > 0) return online[0];
  return [...eligible].sort(byLoad)[0];
}

// ============================================================
// Batch E — Skills-based routing
// ============================================================

/**
 * Pick an agent whose declared skills best cover the required skills for a
 * conversation (typically its tags). Ranking:
 *   1. Highest number of matched skills (must be > 0 to be considered a match).
 *   2. Online agents preferred within the top match tier.
 *   3. Lowest `activeLoad` inside the tier (load-balanced round-robin).
 *
 * If no eligible agent has any skill overlap, falls back to plain
 * round-robin — never blocks routing.
 */
export function pickSkillsMatchAgent(
  agents: PickCandidate[],
  requiredSkills: string[],
  excludeAgentId: string | null = null,
): PickCandidate | null {
  const eligible = agents.filter(
    (a) => a.id !== excludeAgentId && (a.status ?? "active") !== "revoked",
  );
  if (eligible.length === 0) return null;

  const req = Array.from(
    new Set(
      requiredSkills
        .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
  if (req.length === 0) return pickRoundRobinAgent(eligible, excludeAgentId);

  const scored = eligible.map((a) => {
    const s = new Set((a.skills ?? []).map((x) => x.toLowerCase()));
    const matched = req.reduce((n, k) => n + (s.has(k) ? 1 : 0), 0);
    return { a, matched };
  });
  const maxMatched = scored.reduce((m, r) => (r.matched > m ? r.matched : m), 0);
  if (maxMatched === 0) return pickRoundRobinAgent(eligible, excludeAgentId);

  const top = scored.filter((r) => r.matched === maxMatched).map((r) => r.a);
  const byLoad = (a: PickCandidate, b: PickCandidate) =>
    (a.activeLoad ?? 0) - (b.activeLoad ?? 0);
  const online = top.filter((a) => a.isOnline).sort(byLoad);
  if (online.length > 0) return online[0];
  return [...top].sort(byLoad)[0];
}

/** Owner-only: update an agent's skills catalog. */
export async function updateAgentSkills(
  ownerUid: string,
  agentId: string,
  skills: string[],
): Promise<void> {
  const normalized = Array.from(
    new Set(
      skills
        .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
  await updateDoc(doc(fbDb(), `users/${ownerUid}/agents/${agentId}`), {
    skills: normalized,
  });
}