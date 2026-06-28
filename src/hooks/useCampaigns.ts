import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

export type Campaign = {
  id: string;
  name: string;
  description: string;
  status: string;
  messageType: string;
  messageBody: string;
  templateName?: string | null;
  totalRecipients: number;
  audiencePhones?: string[];
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  createdAt: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export function useCampaigns(): { data: Campaign[] | null; error: string | null } {
  const uid = useFirebaseUid();
  const [data, setData] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, `users/${uid}/campaigns`), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Campaign[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: (x.name as string) ?? "Untitled",
            description: (x.description as string) ?? "",
            status: (x.status as string) ?? "draft",
            messageType: (x.messageType as string) ?? "text",
            messageBody: (x.messageBody as string) ?? "",
            templateName: (x.templateName as string | null) ?? null,
            totalRecipients: (x.totalRecipients as number) ?? 0,
            audiencePhones: (x.audiencePhones as string[] | undefined) ?? [],
            sentCount: (x.sentCount as number) ?? 0,
            deliveredCount: (x.deliveredCount as number) ?? 0,
            readCount: (x.readCount as number) ?? 0,
            failedCount: (x.failedCount as number) ?? 0,
            createdAt: toIso(x.createdAt),
            scheduledAt: toIso(x.scheduledAt),
            startedAt: toIso(x.startedAt),
            completedAt: toIso(x.completedAt),
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

export function useCampaign(id: string | undefined): {
  data: Campaign | null | undefined;
  error: string | null;
} {
  const { data, error } = useCampaigns();
  if (!id) return { data: undefined, error };
  if (data === null) return { data: null, error };
  return { data: data.find((c) => c.id === id) ?? null, error };
}