import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
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
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CampaignLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !campaignId) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(
      collection(db, `users/${uid}/campaigns/${campaignId}/logs`),
      orderBy("timestamp", "desc"),
      limit(200),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
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
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, campaignId]);

  return { data, error };
}
