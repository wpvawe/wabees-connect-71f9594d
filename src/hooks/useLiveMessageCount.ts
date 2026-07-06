import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { fetchCached } from "@/lib/firebase/countCache";

/**
 * One-shot server-side count of the owner's messages subcollection. Unlike
 * the cached `users/{uid}.totalMessages` counter (increment-only), this
 * reflects deletions immediately — so the dashboard doesn't lie after the
 * user prunes an old conversation. Costs a single billed aggregate read
 * per mount; safe for dashboard/plans pages that render once per visit.
 */
export function useLiveMessageCount(): { data: number | null; loading: boolean } {
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
    fetchCached<number>(`count:${uid}/messages`, async () => {
      const snap = await getCountFromServer(collection(db, `users/${uid}/messages`));
      return snap.data().count;
    })
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return { data, loading };
}
