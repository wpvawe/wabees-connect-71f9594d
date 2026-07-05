import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { phoneDocId, toIso } from "@/lib/firebase/normalizers";

export type AssignLogEntry = {
  id: string;
  action: string;
  state?: string | null;
  source?: string | null;
  reason?: string | null;
  agentId?: string | null;
  agentEmail?: string | null;
  actorUid?: string | null;
  actorEmail?: string | null;
  at: string | null;
};

/**
 * Live activity/audit timeline for one conversation.
 * Streams `users/{uid}/conversations/{canonicalPhone}/assign_log` desc,
 * capped at 100 entries — enough for a full context switch without
 * unbounded reads.
 */
export function useAssignLog(phone: string | null | undefined): {
  data: AssignLogEntry[] | null;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const session = useFirebaseSession();
  const selfUid = session.status === "ready" ? session.uid : null;
  const maskOtherAgentEmails =
    session.status === "ready" && !!session.dataOwner && session.dataOwner !== session.uid;
  const [data, setData] = useState<AssignLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !phone) {
      setData(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    const canonical = phoneDocId(phone);
    const q = query(
      collection(db, `users/${uid}/conversations/${canonical}/assign_log`),
      orderBy("at", "desc"),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: AssignLogEntry[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            action: typeof x.action === "string" ? x.action : "unknown",
            state: typeof x.state === "string" ? x.state : null,
            source: typeof x.source === "string" ? x.source : null,
            reason: typeof x.reason === "string" ? x.reason : null,
            agentId: typeof x.agentId === "string" ? x.agentId : null,
            agentEmail:
              maskOtherAgentEmails && x.agentId !== selfUid
                ? null
                : typeof x.agentEmail === "string"
                  ? x.agentEmail
                  : null,
            actorUid: typeof x.actorUid === "string" ? x.actorUid : null,
            actorEmail:
              maskOtherAgentEmails && x.actorUid !== selfUid
                ? null
                : typeof x.actorEmail === "string"
                  ? x.actorEmail
                  : null,
            at: toIso(x.at),
          };
        });
        setData(rows);
        setError(null);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, phone, selfUid, maskOtherAgentEmails]);

  return { data, error };
}