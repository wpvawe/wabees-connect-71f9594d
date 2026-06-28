import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

export type Contact = {
  id: string;
  phone: string;
  name: string;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  tags: string[];
  group?: string | null;
  totalMessages: number;
  createdAt: string | null;
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export function useContacts(): { data: Contact[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, `users/${uid}/contacts`), orderBy("name", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Contact[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            phone: (x.phone as string) ?? "",
            name: (x.name as string) ?? "",
            email: (x.email as string | null) ?? null,
            company: (x.company as string | null) ?? null,
            notes: (x.notes as string | null) ?? null,
            tags: (x.tags as string[]) ?? [],
            group: (x.group as string | null) ?? null,
            totalMessages: (x.totalMessages as number) ?? 0,
            createdAt: toIso(x.createdAt),
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