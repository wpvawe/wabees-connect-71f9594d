import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { str, strOrNull, toIso } from "@/lib/firebase/normalizers";

export type SupportMessage = {
  id: string;
  senderId: string;
  senderRole: "user" | "admin";
  text: string;
  imageUrl: string | null;
  read: boolean;
  createdAt: string | null;
};

export function useSupportChat(): {
  data: SupportMessage[] | null;
  error: string | null;
  uid: string | null;
} {
  const uid = useFirebaseUid();
  const [data, setData] = useState<SupportMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setData(null);
      setError(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    // Support threads can accumulate hundreds of messages over months.
    // Read the newest 300 (desc + limit) and reverse to keep the asc UI
    // order — chat UI only shows the most recent tail anyway.
    const q = query(
      collection(db, `support_chats/${uid}/messages`),
      orderBy("createdAt", "desc"),
      limit(300),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              senderId: str(x.senderId),
              senderRole: (x.senderRole === "admin" ? "admin" : "user") as "user" | "admin",
              text: str(x.text),
              imageUrl: strOrNull(x.imageUrl),
              read: Boolean(x.read),
              createdAt: toIso(x.createdAt),
            };
        });
        setData(rows.reverse());
      },
      (err) => setError(err.message),
    );
    return () => {
      unsub();
      // Clear on uid change so previous user's support thread never bleeds
      // into the next signed-in account on the same tab.
      setData(null);
    };
  }, [uid]);

  return { data, error, uid };
}
