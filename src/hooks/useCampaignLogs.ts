import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

export type CampaignLog = {
  id: string;
  phone: string;
  status: string;
  error?: string | null;
  sentAt: string | null;
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (
    typeof v === "object" &&
    v &&
    "toDate" in v &&
    typeof (v as { toDate: () => Date }).toDate === "function"
  ) {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export function useCampaignLogs(campaignId: string | undefined): {
  data: CampaignLog[] | null;
  error: string | null;
  refresh: () => void;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CampaignLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflightRef = useRef(false);

  const load = useCallback(async () => {
    if (!uid || !campaignId) return;
    const db = fbDbOrNull();
    if (!db) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      // Audit §1.4 — was `onSnapshot(limit(200))` which re-billed up to 200
      // reads on EVERY log write during a running campaign (10k+ reads for a
      // 2000-contact send). Switched to a one-shot paginated `getDocs` with a
      // gentle 30s poll so progress still updates but cost is bounded.
      const snap = await getDocs(
        query(
          collection(db, `users/${uid}/campaigns/${campaignId}/logs`),
          orderBy("timestamp", "desc"),
          limit(200),
        ),
      );
      const rows: CampaignLog[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          phone: (x.phone as string) ?? "",
          status: (x.status as string) ?? "pending",
          error: (x.reason as string | null) ?? (x.error as string | null) ?? null,
          sentAt: toIso(x.timestamp ?? x.sentAt ?? x.createdAt),
        };
      });
      setData(rows);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inflightRef.current = false;
    }
  }, [uid, campaignId]);

  useEffect(() => {
    if (!uid || !campaignId) return;
    void load();
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, uid, campaignId]);

  return { data, error, refresh: load };
}
