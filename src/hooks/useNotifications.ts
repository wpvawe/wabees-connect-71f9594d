import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string | null;
};

export function useNotifications(): { data: AppNotification[] | null; unread: number; error: string | null } {
  const uid = useFirebaseUid();
  const [data, setData] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, `users/${uid}/notifications`), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              title: str(x.title),
              body: str(x.body),
              type: str(x.type, "system"),
              data: (x.data && typeof x.data === "object" ? (x.data as Record<string, unknown>) : {}),
              read: Boolean(x.read),
              createdAt: toIso(x.createdAt),
            };
          }),
        );
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  const unread = data ? data.filter((n) => !n.read).length : 0;
  return { data, unread, error };
}