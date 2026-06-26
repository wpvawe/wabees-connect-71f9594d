import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

export type Template = {
  id: string;
  metaTemplateId?: string | null;
  name: string;
  category: string;
  languageCode: string;
  body: string;
  header?: string | null;
  footer?: string | null;
  status: string;
  isSynced: boolean;
  variables: string[];
  qualityScore?: string | null;
};

export function useTemplates(): { data: Template[] | null; error: string | null } {
  const uid = useFirebaseUid();
  const [data, setData] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, `users/${uid}/templates`), orderBy("name", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Template[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            metaTemplateId: (x.metaTemplateId as string | null) ?? null,
            name: (x.name as string) ?? "",
            category: ((x.category as string) ?? "UTILITY").toUpperCase(),
            languageCode: (x.languageCode as string) ?? "en_US",
            body: (x.body as string) ?? "",
            header: (x.header as string | null) ?? null,
            footer: (x.footer as string | null) ?? null,
            status: (x.status as string) ?? "PENDING",
            isSynced: (x.isSynced as boolean) ?? false,
            variables: (x.variables as string[]) ?? [],
            qualityScore: (x.qualityScore as string | null) ?? null,
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