import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";
import type { CallLogRecord } from "@/lib/wabees/calls";

/**
 * Live call log subscription from `users/{ownerUid}/call_logs`.
 * Webhook (webhook.php::handle_call_event) writes inbound events;
 * send-call.php writes outbound intents. Agents see their owner's logs.
 */
export function useCallLogs(max = 100): {
  data: CallLogRecord[] | null;
  loading: boolean;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CallLogRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    const db = fbDbOrNull();
    if (!db) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, `users/${uid}/call_logs`),
      orderBy("createdAt", "desc"),
      limit(max),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: CallLogRecord[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            callId: str(x.callId, d.id),
            from: str(x.from),
            to: str(x.to),
            callerName: str(x.callerName) || null,
            type: (x.type === "outgoing" ? "outgoing" : "incoming") as "incoming" | "outgoing",
            callType: str(x.callType, "voice"),
            status: str(x.status),
            phoneNumberId: str(x.phoneNumberId) || null,
            duration:
              typeof x.duration === "number"
                ? x.duration
                : typeof x.duration === "string" && x.duration.trim()
                  ? Number(x.duration)
                  : null,
            startedAt: toIso(x.startedAt),
            connectedAt: toIso(x.connectedAt),
            endedAt: toIso(x.endedAt),
            createdAt: toIso(x.createdAt),
          };
        });
        setData(list);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [uid, max]);

  return { data, loading, error };
}

/** The most recent still-ringing incoming call, if any. Drives the banner. */
export function useRingingCall(): CallLogRecord | null {
  const { data } = useCallLogs(20);
  if (!data) return null;
  return (
    data.find(
      (c) => c.type === "incoming" && (c.status === "ringing" || c.status === "connect"),
    ) ?? null
  );
}