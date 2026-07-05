import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { toIso } from "@/lib/firebase/normalizers";

export type AuditEntry = {
  id: string;
  action: string;
  target: string;
  actorEmail: string | null;
  actorUid: string | null;
  meta: Record<string, unknown>;
  createdAt: string | null;
};

/**
 * Live-read the last 200 admin audit-log entries. Ordered newest first.
 * The log is append-only — no client-side deletes.
 */
export function useAuditLog(): { data: AuditEntry[] | null; error: string | null } {
  const [data, setData] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(
      collection(db, "admin_audit_logs"),
      orderBy("createdAt", "desc"),
      limit(200),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              action: (x.action as string) ?? "",
              target: (x.target as string) ?? "",
              actorEmail: (x.actorEmail as string | null) ?? null,
              actorUid: (x.actorUid as string | null) ?? null,
              meta: (x.meta as Record<string, unknown>) ?? {},
              createdAt: toIso(x.createdAt),
            };
          }),
        );
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, []);
  return { data, error };
}