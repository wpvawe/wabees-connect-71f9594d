/**
 * Role of the signed-in user within the currently-active owner tree.
 *
 * - "owner"       — user is the account owner (no dataOwner override)
 * - "supervisor"  — user is an agent with role='supervisor' (or explicit)
 * - "agent"       — user is a regular agent
 * - null          — still resolving / not signed in
 *
 * Regular agents get scoped visibility by default in the UI (Mine +
 * Unassigned only). Supervisors and owners see everything.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";

export type AgentRole = "owner" | "supervisor" | "agent";

export function useAgentRole(): AgentRole | null {
  const session = useFirebaseSession();
  const [role, setRole] = useState<AgentRole | null>(null);

  useEffect(() => {
    if (session.status !== "ready") {
      setRole(null);
      return;
    }
    const { uid, dataOwner } = session;
    // No dataOwner override → this is the owner's own account.
    if (!dataOwner || dataOwner === uid) {
      setRole("owner");
      return;
    }
    const db = fbDbOrNull();
    if (!db) {
      setRole("agent");
      return;
    }
    const unsub = onSnapshot(
      doc(db, `users/${dataOwner}/agents/${uid}`),
      (snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        const r = typeof data.role === "string" ? data.role : "agent";
        setRole(r === "supervisor" ? "supervisor" : "agent");
      },
      () => setRole("agent"),
    );
    return () => unsub();
  }, [session]);

  return role;
}

export function useCanManageTeam(): boolean {
  const r = useAgentRole();
  return r === "owner" || r === "supervisor";
}