import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

/**
 * One-shot server-side count of any `users/{uid}/{name}` subcollection.
 * Mirrors useLiveMessageCount but reusable — powers accurate contacts /
 * templates / campaigns / bots totals on the dashboard & plans page even
 * when the live list hook caps rows for performance.
 */
export function useLiveSubcollectionCount(
  name: string,
): { data: number | null; loading: boolean } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    setLoading(true);
    getCountFromServer(collection(db, `users/${uid}/${name}`))
      .then((snap) => {
        if (cancelled) return;
        setData(snap.data().count);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, name]);

  return { data, loading };
}