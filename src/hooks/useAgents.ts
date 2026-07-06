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
      const snap = await getDocs(collection(db, `users/${uid}/agents`));
      setData(
        snap.docs
            // Never surface the owner themselves as a teammate row —
            // legacy bootstrap code may seed `users/{uid}/agents/{uid}`.
            .filter((d) => d.id !== uid)
            .map((d) => {
            const x = d.data() as Record<string, unknown>;
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
      setError((err as Error).message);
    }
  }, [uid, selfUid, maskOtherEmails]);

  useEffect(() => {
    void load();
    const unsub = subscribeRefetch("agents", () => {
      void load();
    });
    return () => unsub();
  }, [load]);

  return { data, error };
}
