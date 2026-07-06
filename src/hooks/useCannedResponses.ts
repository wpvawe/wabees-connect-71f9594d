/**
 * Real-time list of canned responses for the active owner tree. Agents
 * inherit the owner's library via `useEffectiveUid` (dataOwner override).
 */
import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";
import type { CannedResponse } from "@/lib/firebase/canned";

export function useCannedResponses(): {
  data: CannedResponse[] | null;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CannedResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, `users/${uid}/canned`),
          orderBy("shortcut", "asc"),
          limit(500),
        ),
      );
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
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [uid]);

  useEffect(() => {
    void load();
    const unsub = subscribeRefetch("canned", () => {
      void load();
    });
    return () => unsub();
  }, [load]);

  return { data, error };
}