import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { fetchCached, invalidateCachedCount } from "@/lib/firebase/countCache";
import { subscribeRefetch, type RefetchKey } from "@/lib/firebase/refetchBus";

const COUNT_TTL_MS = 5 * 60_000;

export function useOwnerCollectionCount(
  collectionName: string,
  refetchKey?: RefetchKey,
): { data: number | null; loading: boolean; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setData(null);
      setLoading(false);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    const cacheKey = `count:${uid}/${collectionName}`;

    async function load(force = false) {
      if (force) invalidateCachedCount(cacheKey);
      setLoading(true);
      try {
        const count = await fetchCached<number>(
          cacheKey,
          async () => {
            const snap = await getCountFromServer(
              collection(db!, "users", uid, collectionName),
            );
            return snap.data().count;
          },
          COUNT_TTL_MS,
        );
        if (cancelled) return;
        setData(typeof count === "number" ? count : null);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Count failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const unsub = refetchKey
      ? subscribeRefetch(refetchKey, () => void load(true))
      : () => undefined;
    return () => {
      cancelled = true;
      unsub();
    };
  }, [collectionName, refetchKey, uid]);

  return { data, loading, error };
}