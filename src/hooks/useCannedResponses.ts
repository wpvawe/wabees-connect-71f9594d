/**
 * Real-time list of canned responses for the active owner tree. Agents
 * inherit the owner's library via `useEffectiveUid` (dataOwner override).
 */
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";
import type { CannedResponse } from "@/lib/firebase/canned";

export function useCannedResponses(): {
  data: CannedResponse[] | null;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CannedResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    setError(null);
    const q = query(
      collection(db, `users/${uid}/canned`),
      orderBy("shortcut", "asc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: CannedResponse[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            shortcut: str(x.shortcut),
            title: str(x.title),
            body: str(x.body),
            createdAt: toIso(x.createdAt),
            updatedAt: toIso(x.updatedAt),
          };
        });
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}