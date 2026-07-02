import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { phoneQueryCandidates, str, strOrNull, toIso } from "@/lib/firebase/normalizers";
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
    setData(null);
    setError(null);
    const candidates = phoneQueryCandidates(phone);
    const byId = new Map<string, ConvNote>();
    const loaded = new Set<string>();
    const emit = () => {
      if (loaded.size < candidates.length) return;
      setData(
        Array.from(byId.values())
          .filter((n) => n.body)
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
          }),
      );
    };
    const unsubs = candidates.map((convId) =>
      onSnapshot(
        query(collection(db, `users/${uid}/conversations/${convId}/notes`), orderBy("createdAt", "desc")),
        (snap) => {
          for (const key of Array.from(byId.keys())) {
            if (key.startsWith(`${convId}/`)) byId.delete(key);
          }
          for (const d of snap.docs) {
            const x = d.data() as Record<string, unknown>;
            if (x.isDeleted === true) continue;
            byId.set(`${convId}/${d.id}`, {
              id: d.id,
              body: str(x.body),
              authorUid: str(x.authorUid),
              authorEmail: strOrNull(x.authorEmail),
              createdAt: toIso(x.createdAt),
              updatedAt: toIso(x.updatedAt),
              pinned: x.pinned === true,
            });
          }
          loaded.add(convId);
          emit();
        },
        (err) => {
          loaded.add(convId);
          setError(err.message);
          emit();
        },
      ),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [uid, phone]);

  return { data, error };
}