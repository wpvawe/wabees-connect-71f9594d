import { useCallback, useEffect, useRef, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

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
  templateHeader?: string | null;
  templateHeaderFormat?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  templateHeaderMediaUrl?: string | null;
  templateFooter?: string | null;
  templateButtons?: Array<Record<string, unknown>>;
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
  // Track last successful load so visibility-change doesn't refetch on
  // every tab switch. Refetches only when data is >5 min stale.
  const lastLoadRef = useRef(0);
  // Race guard — see useBots. Ignores setState from stale in-flight loads
  // after uid changes.
  const genRef = useRef(0);

  const load = useCallback(async () => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const gen = genRef.current;
    try {
      const snap = await getDocs(
        query(
          collection(db, `users/${uid}/campaigns`),
          orderBy("createdAt", "desc"),
          limit(100),
        ),
      );
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
              templateHeader: (x.templateHeader as string | null) ?? null,
              templateHeaderFormat:
                (x.templateHeaderFormat as
                  | "TEXT"
                  | "IMAGE"
                  | "VIDEO"
                  | "DOCUMENT"
                  | null) ?? null,
              templateHeaderMediaUrl: (x.templateHeaderMediaUrl as string | null) ?? null,
              templateFooter: (x.templateFooter as string | null) ?? null,
              templateButtons:
                (x.templateButtons as Array<Record<string, unknown>> | undefined) ?? [],
              variableSource: (((x.variableSource as string) ?? "static") === "contact"
                ? "contact"
                : "static") as "static" | "contact",
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
          .sort((a, b) => {
            const av = a.createdAt ?? "\uffff";
            const bv = b.createdAt ?? "\uffff";
            return bv.localeCompare(av);
          });
      if (gen !== genRef.current) return;
      setData(rows);
      setError(null);
      lastLoadRef.current = Date.now();
    } catch (err) {
      if (gen !== genRef.current) return;
      setError((err as Error).message);
    }
  }, [uid]);

  useEffect(() => {
    genRef.current += 1;
    setData(null);
    void load();
    const unsub = subscribeRefetch("campaigns", () => void load());
    const onVis = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoadRef.current > 5 * 60_000
      ) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  return { data, error };
}

export function useCampaign(id: string | undefined): {
  data: Campaign | null | undefined;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Campaign | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset when uid/id changes so a previous campaign never briefly renders
    // in the detail page while the new snapshot is in flight.
    setData(undefined);
    setError(null);
    if (!uid || !id) {
      setData(undefined);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      doc(db, `users/${uid}/campaigns/${id}`),
      (snap) => {
        if (!snap.exists()) {
          setData(null);
          return;
        }
        const x = snap.data() as Record<string, unknown>;
        setData({
          id: snap.id,
          name: (x.name as string) ?? "Untitled",
          description: (x.description as string) ?? "",
          status: (x.status as string) ?? "draft",
          messageType: (x.messageType as string) ?? "text",
          messageBody: (x.messageBody as string) ?? "",
          templateName: (x.templateName as string | null) ?? null,
          templateLanguage: (x.templateLanguage as string | null) ?? null,
          selectedTemplateId: (x.selectedTemplateId as string | null) ?? null,
          templateVariables: (x.templateVariables as string[] | undefined) ?? [],
          templateHeader: (x.templateHeader as string | null) ?? null,
          templateHeaderFormat:
            (x.templateHeaderFormat as
              | "TEXT"
              | "IMAGE"
              | "VIDEO"
              | "DOCUMENT"
              | null) ?? null,
          templateHeaderMediaUrl: (x.templateHeaderMediaUrl as string | null) ?? null,
          templateFooter: (x.templateFooter as string | null) ?? null,
          templateButtons:
            (x.templateButtons as Array<Record<string, unknown>> | undefined) ?? [],
          variableSource: (((x.variableSource as string) ?? "static") === "contact"
            ? "contact"
            : "static") as "static" | "contact",
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
        });
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, id]);

  return { data, error };
}
