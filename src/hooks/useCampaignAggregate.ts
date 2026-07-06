import { useEffect, useState } from "react";
import { collection, getAggregateFromServer, sum, count } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { fetchCached } from "@/lib/firebase/countCache";

export type CampaignAggregate = {
  totalCampaigns: number;
  sent: number;
  delivered: number;
  read: number;
};

/**
 * One-shot server-side aggregation over the entire campaigns collection.
 * Uses Firestore's aggregate query (a single billed read) so totals stay
 * correct even when useCampaigns() caps the live list at 100 rows.
 */
export function useCampaignAggregate(): {
  data: CampaignAggregate | null;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CampaignAggregate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    let alive = true;
    (async () => {
      try {
        const value = await fetchCached<CampaignAggregate>(
          `agg:${uid}/campaigns`,
          async () => {
            const snap = await getAggregateFromServer(
              collection(db, `users/${uid}/campaigns`),
              {
                totalCampaigns: count(),
                sent: sum("sentCount"),
                delivered: sum("deliveredCount"),
                read: sum("readCount"),
              },
            );
            const d = snap.data();
            return {
              totalCampaigns: Number(d.totalCampaigns ?? 0),
              sent: Number(d.sent ?? 0),
              delivered: Number(d.delivered ?? 0),
              read: Number(d.read ?? 0),
            };
          },
        );
        if (!alive) return;
        setData(value);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "aggregate_failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  return { data, error };
}