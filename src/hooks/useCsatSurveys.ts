/**
 * Live list of CSAT surveys for the current owner (last 90 days). Used by
 * the workload dashboard to compute team CSAT and by the settings screen
 * to show recent ratings.
 */
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import type { CsatSurvey } from "@/lib/firebase/csat";
import { toIso } from "@/lib/firebase/normalizers";

export type CsatStats = {
  sent: number;
  responded: number;
  responseRate: number; // 0-1
  averageRating: number | null; // 1-5
  csatPct: number | null; // % ratings >= 4
  distribution: [number, number, number, number, number]; // count for 1..5
};

export function useCsatSurveys(max = 200): {
  data: CsatSurvey[] | null;
  stats: CsatStats;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CsatSurvey[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(
      collection(db, `users/${uid}/csat_surveys`),
      orderBy("sentAt", "desc"),
      limit(max),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: CsatSurvey[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const status = (() => {
            const s = typeof x.status === "string" ? x.status : "pending";
            return s === "responded" || s === "expired" || s === "failed"
              ? s
              : "pending";
          })();
          return {
            id: d.id,
            phone: typeof x.phone === "string" ? x.phone : "",
            conversationId:
              typeof x.conversationId === "string" ? x.conversationId : "",
            sentAt: toIso(x.sentAt),
            sentByUid: typeof x.sentByUid === "string" ? x.sentByUid : null,
            sentByEmail:
              typeof x.sentByEmail === "string" ? x.sentByEmail : null,
            agentId: typeof x.agentId === "string" ? x.agentId : null,
            agentEmail: typeof x.agentEmail === "string" ? x.agentEmail : null,
            wamid: typeof x.wamid === "string" ? x.wamid : null,
            status,
            rating:
              typeof x.rating === "number" && x.rating >= 1 && x.rating <= 5
                ? x.rating
                : null,
            comment: typeof x.comment === "string" ? x.comment : null,
            respondedAt: toIso(x.respondedAt),
            error: typeof x.error === "string" ? x.error : null,
          };
        });
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, max]);

  const stats = useMemo<CsatStats>(() => {
    const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    if (!data) {
      return {
        sent: 0,
        responded: 0,
        responseRate: 0,
        averageRating: null,
        csatPct: null,
        distribution: dist,
      };
    }
    let responded = 0;
    let sum = 0;
    let good = 0;
    for (const s of data) {
      if (s.status === "failed") continue;
      if (s.rating) {
        responded += 1;
        sum += s.rating;
        dist[s.rating - 1] += 1;
        if (s.rating >= 4) good += 1;
      }
    }
    const sent = data.filter((s) => s.status !== "failed").length;
    return {
      sent,
      responded,
      responseRate: sent > 0 ? responded / sent : 0,
      averageRating: responded > 0 ? sum / responded : null,
      csatPct: responded > 0 ? (good / responded) * 100 : null,
      distribution: dist,
    };
  }, [data]);

  return { data, stats, error };
}