import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string | null;
  targetAgentId: string | null;
};

export function useNotifications(): {
  data: AppNotification[] | null;
  unread: number;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const [data, setData] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !selfUid) return;
    const db = fbDbOrNull();
    if (!db) return;
    let first = true;
    const seen = new Set<string>();
    const q = query(
      collection(db, `users/${uid}/notifications`),
      orderBy("createdAt", "desc"),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const HIDE_TYPES = new Set(["new_message", "bot_triggered"]);
        const list = snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              title: str(x.title),
              body: str(x.body),
              type: str(x.type, "system"),
              data: x.data && typeof x.data === "object" ? (x.data as Record<string, unknown>) : {},
              read: Boolean(x.read),
              createdAt: toIso(x.createdAt),
              targetAgentId:
                typeof x.targetAgentId === "string" ? (x.targetAgentId as string) : null,
            };
          })
          // Hide legacy noise: every message / every bot trigger used to
          // write a notification doc. We now only persist meaningful events.
          .filter((n) => !HIDE_TYPES.has(n.type))
          // Owner (uid == selfUid) sees everything; agents only see items
          // targeted at them or with no target (broadcast).
          .filter((n) =>
            uid === selfUid ? true : n.targetAgentId === null || n.targetAgentId === selfUid,
          );
        if (first) {
          for (const n of list) seen.add(n.id);
          first = false;
        } else {
          for (const n of list) {
            if (!seen.has(n.id)) {
              seen.add(n.id);
            }
          }
        }
        setData(list);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, selfUid]);

  const unread = data ? data.filter((n) => !n.read).length : 0;
  return { data, unread, error };
}
