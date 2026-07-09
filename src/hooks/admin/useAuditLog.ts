import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

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
 * Read the last 200 admin audit-log entries. Ordered newest first.
 * The log is append-only — no client-side deletes.
 *
 * High-sev fix: previously used `onSnapshot`, which kept an unbounded
 * live listener open on `admin_audit_logs` for the whole admin session
 * and re-billed reads on every append. We now do a one-shot `getDocs`
 * on mount + on the shared refetch bus + when the tab becomes visible
 * again after 5 minutes.
 */
export function useAuditLog(): { data: AuditEntry[] | null; error: string | null } {
  const [data, setData] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastLoadRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "admin_audit_logs"),
          orderBy("createdAt", "desc"),
          limit(200),
        ),
      );
      if (!mountedRef.current) return;
      const rows: AuditEntry[] = snap.docs.map((d) => {
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
      });
      setData(rows);
      lastLoadRef.current = Date.now();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const unsub = subscribeRefetch("adminAuditLogs", () => {
      void load();
    });
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadRef.current < 5 * 60_000) return;
      void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mountedRef.current = false;
      unsub();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);
  return { data, error };
}