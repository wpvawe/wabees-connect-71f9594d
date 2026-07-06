import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

export type Template = {
  id: string;
  metaTemplateId?: string | null;
  name: string;
  category: string;
  languageCode: string;
  body: string;
  header?: string | null;
  headerFormat?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  headerMediaUrl?: string | null;
  headerVariables?: string[];
  footer?: string | null;
  buttons: Array<Record<string, unknown>>;
  status: string;
  isSynced: boolean;
  variables: string[];
  variableSamples: Record<string, string>;
  variableTypes: Record<string, string>;
  qualityScore?: string | null;
};

export function useTemplates(): { data: Template[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, `users/${uid}/templates`),
          orderBy("name", "asc"),
          limit(500),
        ),
      );
      const rows: Template[] = snap.docs
        .map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              metaTemplateId: (x.metaTemplateId as string | null) ?? null,
              name: (x.name as string) ?? "",
              category: ((x.category as string) ?? "UTILITY").toUpperCase(),
              languageCode: (x.languageCode as string) ?? "en_US",
              body: (x.body as string) ?? "",
              header: (x.header as string | null) ?? null,
              headerFormat:
                ((x.headerFormat as string | null) ?? (x.header ? "TEXT" : null)) as
                  | "TEXT"
                  | "IMAGE"
                  | "VIDEO"
                  | "DOCUMENT"
                  | null,
              headerMediaUrl: (x.headerMediaUrl as string | null) ?? null,
              headerVariables: (x.headerVariables as string[] | undefined) ?? [],
              footer: (x.footer as string | null) ?? null,
              buttons: Array.isArray(x.buttons)
                ? (x.buttons as Array<Record<string, unknown>>)
                : [],
              status: (x.status as string) ?? "PENDING",
              isSynced: (x.isSynced as boolean) ?? false,
              variables: (x.variables as string[]) ?? [],
              variableSamples:
                x.variableSamples && typeof x.variableSamples === "object"
                  ? (x.variableSamples as Record<string, string>)
                  : {},
              variableTypes:
                x.variableTypes && typeof x.variableTypes === "object"
                  ? (x.variableTypes as Record<string, string>)
                  : {},
              qualityScore: (x.qualityScore as string | null) ?? null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      setData(rows);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [uid]);

  useEffect(() => {
    void load();
    const unsub = subscribeRefetch("templates", () => {
      void load();
    });
    return () => unsub();
  }, [load]);

  return { data, error };
}
