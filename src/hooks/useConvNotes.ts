import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { phoneDocId, str, strOrNull, toIso } from "@/lib/firebase/normalizers";
import type { ConvNote } from "@/lib/firebase/notes";

export function useConvNotes(phone: string): {
  data: ConvNote[] | null;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<ConvNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !phone) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      query(
        collection(db, `users/${uid}/conversations/${phoneDocId(phone)}/notes`),
        orderBy("createdAt", "desc"),
      ),
      (snap) => {
        setData(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              body: str(x.body),
              authorUid: str(x.authorUid),
              authorEmail: strOrNull(x.authorEmail),
              createdAt: toIso(x.createdAt),
              updatedAt: toIso(x.updatedAt),
            };
          }),
        );
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, phone]);

  return { data, error };
}