import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import type { AgentInvite, InviteRole, InviteStatus } from "@/lib/firebase/agent-invites";

function tsToMillis(v: unknown): number | null {
  if (!v) return null;
  const anyV = v as { toMillis?: () => number };
  if (typeof anyV.toMillis === "function") return anyV.toMillis();
  if (typeof v === "number") return v;
  return null;
}

export function useAgentInvites(): { data: AgentInvite[] | null; error: string | null } {
  const uid = useFirebaseUid();
  const [data, setData] = useState<AgentInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setData(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(
      collection(db, `users/${uid}/agent_invites`),
      orderBy("createdAt", "desc"),
      // Recent invites only — pending/expired ones can pile up over years.
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: AgentInvite[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            code: (x.code as string) ?? "",
            email: (x.email as string) ?? null,
            role: ((x.role as InviteRole) ?? "agent"),
            status: ((x.status as InviteStatus) ?? "pending"),
            createdAt: tsToMillis(x.createdAt),
            expiresAt: tsToMillis(x.expiresAt),
            acceptedBy: (x.acceptedBy as string) ?? null,
            acceptedAt: tsToMillis(x.acceptedAt),
            createdByEmail: (x.createdByEmail as string) ?? null,
          };
        });
        setData(rows);
        setError(null);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}
