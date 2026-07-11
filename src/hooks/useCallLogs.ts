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

/**
 * The most recent still-ringing incoming call, if any. Drives the banner.
 *
 * Age-guarded: a WhatsApp call almost never rings for more than 45s. If a
 * `ringing` doc is older than that, Meta's `terminated` webhook was
 * dropped/missed and the doc is stale. Rendering it would re-show the
 * banner on every reload forever, which is exactly the bug users hit.
 */
export const RINGING_MAX_AGE_MS = 45_000;

export function isRingingLikeStatus(status: string): boolean {
  return status === "ringing" || status === "connect";
}

export function isCallFresh(call: Pick<CallLogRecord, "createdAt">): boolean {
  if (!call.createdAt) return false;
  const created = Date.parse(call.createdAt);
  return Number.isFinite(created) && Date.now() - created <= RINGING_MAX_AGE_MS;
}

export function effectiveCallStatus(call: Pick<CallLogRecord, "status" | "createdAt">): string {
  if (isRingingLikeStatus(call.status) && !isCallFresh(call)) return "missed";
  return call.status;
}

export function useRingingCall(): CallLogRecord | null {
  const { data } = useCallLogs(20);
  // Force re-evaluation every few seconds so a stale ringing doc drops
  // out of the banner without needing a Firestore update to arrive.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);
  if (!data) return null;
  const now = Date.now();
  return (
    data.find((c) => {
      if (c.type !== "incoming") return false;
      if (!isRingingLikeStatus(c.status)) return false;
      const started = c.createdAt ? Date.parse(c.createdAt) : NaN;
      if (!Number.isFinite(started)) return false;
      return now - started <= RINGING_MAX_AGE_MS;
    }) ?? null
  );
}