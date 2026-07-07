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

// Shared per-owner coalescing cache — many components mount useTemplates
// concurrently (analytics, composer, campaigns, template pages). Without
// this each mount re-billed up to 500 template docs. Mutations invalidate
// via `subscribeRefetch("templates")`.
type RawSnap = Array<{ id: string; data: Record<string, unknown> }>;
const REGISTRY = new Map<string, { at: number; docs: RawSnap }>();
const INFLIGHT = new Map<string, Promise<RawSnap>>();
const REGISTRY_TTL_MS = 60_000;

async function fetchTemplatesCoalesced(
  db: ReturnType<typeof fbDbOrNull>,
  uid: string,
): Promise<RawSnap> {
  const hit = REGISTRY.get(uid);
  if (hit && Date.now() - hit.at < REGISTRY_TTL_MS) return hit.docs;
  const existing = INFLIGHT.get(uid);
  if (existing) return existing;
  const p = (async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db!, `users/${uid}/templates`),
          orderBy("name", "asc"),
          limit(500),
        ),
      );
      const docs: RawSnap = snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
      REGISTRY.set(uid, { at: Date.now(), docs });
      return docs;
    } finally {
      INFLIGHT.delete(uid);
    }
  })();
  INFLIGHT.set(uid, p);
  return p;
}

function invalidateTemplates(uid: string): void {
  REGISTRY.delete(uid);
}

export function useTemplates(): { data: Template[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const docs = await fetchTemplatesCoalesced(db, uid);
      const rows: Template[] = docs
        .map((d) => {
            const x = d.data;
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
      if (uid) invalidateTemplates(uid);
      void load();
    });
    return () => unsub();
  }, [load, uid]);

  return { data, error };
}
