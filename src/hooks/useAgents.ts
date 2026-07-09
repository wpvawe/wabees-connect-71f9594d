import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";
import { str, strOrNull, toIso } from "@/lib/firebase/normalizers";
import type { WorkingHours } from "@/lib/firebase/working-hours";
import type { Availability } from "@/hooks/useAgentAvailability";

export type Agent = {
  id: string;
  email: string;
  joinedAt: string | null;
  role: string | null;
  status: string;
  revokedAt: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  activeLoad: number;
  skills: string[];
  workingHours: WorkingHours | null;
  availability: Availability;
};

// Shared registry per owner uid — many components mount useAgents (dashboard,
// inbox, workload, analytics, AssignAgentDialog…). Without coalescing each
// mount fires its own `getDocs` and re-bills every agent doc. This keeps a
// single in-flight promise + fresh-cache window so a page swap serves cached
// docs and mutations still refresh via refetchBus.
type RawSnap = Array<{ id: string; data: Record<string, unknown> }>;
const REGISTRY = new Map<string, { at: number; docs: RawSnap }>();
const INFLIGHT = new Map<string, Promise<RawSnap>>();
const REGISTRY_TTL_MS = 60_000;

async function fetchAgentsCoalesced(db: ReturnType<typeof fbDbOrNull>, uid: string): Promise<RawSnap> {
  const hit = REGISTRY.get(uid);
  if (hit && Date.now() - hit.at < REGISTRY_TTL_MS) return hit.docs;
  const existing = INFLIGHT.get(uid);
  if (existing) return existing;
  const p = (async () => {
    try {
      const snap = await getDocs(collection(db!, `users/${uid}/agents`));
      const docs: RawSnap = snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
      REGISTRY.set(uid, { at: Date.now(), docs });
      return docs;
    } finally {
      INFLIGHT.delete(uid);
    }
  })();
  INFLIGHT.set(uid, p);
  return p;
}

function invalidateAgents(uid: string): void {
  REGISTRY.delete(uid);
}

export function useAgents(): { data: Agent[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const session = useFirebaseSession();
  const selfUid = session.status === "ready" ? session.uid : null;
  const maskOtherEmails =
    session.status === "ready" && !!session.dataOwner && session.dataOwner !== session.uid;
  const [data, setData] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const docs = await fetchAgentsCoalesced(db, uid);
      // Bug fix: bail if the caller signalled cancellation while the
      // coalesced fetch was in flight (uid changed / component unmounted).
      if (cancelledRef.current) return;
      setData(
        docs
          // Never surface the owner themselves as a teammate row —
          // legacy bootstrap code may seed `users/{uid}/agents/{uid}`.
          .filter((d) => d.id !== uid)
          .map((d) => {
            const x = d.data;
            const email = str(x.email);
            return {
              id: d.id,
              email: maskOtherEmails && d.id !== selfUid ? "" : email,
              joinedAt: toIso(x.joinedAt),
              role: strOrNull(x.role),
              status: (typeof x.status === "string" && x.status) ? x.status : "active",
              revokedAt: toIso(x.revokedAt),
              isOnline: Boolean(x.isOnline),
              lastSeenAt: toIso(x.lastSeenAt),
              activeLoad: typeof x.activeLoad === "number" ? x.activeLoad : 0,
              skills: Array.isArray(x.skills)
                ? (x.skills as unknown[])
                    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
                    .map((s) => s.trim().toLowerCase())
                : [],
              workingHours:
                x.workingHours && typeof x.workingHours === "object"
                  ? (x.workingHours as WorkingHours)
                  : null,
              availability:
                x.availability === "away" || x.availability === "dnd"
                  ? (x.availability as Availability)
                  : "available",
            };
          })
          // Agents who voluntarily left the workspace disappear from the
          // owner's list — the owner never explicitly removed them and
          // there's no reinstate flow for `left` (only `revoked`).
          .filter((a) => a.status !== "left"),
      );
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError((err as Error).message);
    }
  }, [uid, selfUid, maskOtherEmails]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const unsub = subscribeRefetch("agents", () => {
      if (uid) invalidateAgents(uid);
      void load();
    });
    return () => {
      cancelledRef.current = true;
      unsub();
    };
  }, [load, uid]);

  return { data, error };
}
