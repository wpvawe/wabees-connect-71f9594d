import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { toIso } from "@/lib/firebase/normalizers";

export type Campaign = {
  id: string;
  name: string;
  description: string;
  status: string;
  messageType: string;
  messageBody: string;
  templateName?: string | null;
  templateLanguage?: string | null;
  selectedTemplateId?: string | null;
  templateVariables?: string[];
  variableSource?: "static" | "contact";
  staticVariableValues?: Record<string, string>;
  contactFieldMap?: Record<string, string>;
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

export function useCampaigns(): { data: Campaign[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, `users/${uid}/campaigns`),
      (snap) => {
        const rows: Campaign[] = snap.docs
          .map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              name: (x.name as string) ?? "Untitled",
              description: (x.description as string) ?? "",
              status: (x.status as string) ?? "draft",
              messageType: (x.messageType as string) ?? "text",
              messageBody: (x.messageBody as string) ?? "",
              templateName: (x.templateName as string | null) ?? null,
              templateLanguage: (x.templateLanguage as string | null) ?? null,
              selectedTemplateId: (x.selectedTemplateId as string | null) ?? null,
              templateVariables: (x.templateVariables as string[] | undefined) ?? [],
              variableSource:
                ((x.variableSource as string) ?? "static") === "contact" ? "contact" : "static",
              staticVariableValues:
                (x.staticVariableValues as Record<string, string> | undefined) ?? {},
              contactFieldMap:
                (x.contactFieldMap as Record<string, string> | undefined) ?? {},
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
          })
          // Pending server timestamps arrive as null on the local snapshot
          // for a moment; treat them as newest so a freshly created campaign
          // appears at the top of the list immediately.
          .sort((a, b) => {
            const av = a.createdAt ?? "\uffff";
            const bv = b.createdAt ?? "\uffff";
            return bv.localeCompare(av);
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
