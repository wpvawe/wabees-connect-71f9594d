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
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { subscribeDoc } from "@/lib/firebase/docBroker";

export type AgentRole = "owner" | "supervisor" | "agent";

export function useAgentRole(): AgentRole | null {
  const session = useFirebaseSession();
  // Depend on primitives so a fresh session object per parent render
  // doesn't tear down + re-attach the agent doc listener.
  const ready = session.status === "ready";
  const uid = ready ? session.uid : null;
  const dataOwner = ready ? session.dataOwner : null;
  const [role, setRole] = useState<AgentRole | null>(null);

  useEffect(() => {
    if (!ready || !uid) {
      setRole(null);
      return;
    }
    // No dataOwner override → this is the owner's own account.
    if (!dataOwner || dataOwner === uid) {
      setRole("owner");
      return;
    }
    return subscribeDoc(["users", dataOwner, "agents", uid], (snap) => {
      if (snap.error) {
        setRole("agent");
        return;
      }
      const data = (snap.exists ? snap.data : {}) as Record<string, unknown>;
      const r = typeof data?.role === "string" ? data.role : "agent";
      setRole(r === "supervisor" ? "supervisor" : "agent");
    });
  }, [ready, uid, dataOwner]);

  return role;
}

export function useCanManageTeam(): boolean {
  const r = useAgentRole();
  return r === "owner" || r === "supervisor";
}