import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { listOfStrings, normalizePhone, str, strOrNull, toIso } from "@/lib/firebase/normalizers";

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
          const phone = str(x.phone, d.id);
          return {
            id: d.id,
            phone: phone ? normalizePhone(phone) : "",
            name: str(x.name, phone || d.id),
            email: strOrNull(x.email),
            company: strOrNull(x.company),
            notes: strOrNull(x.notes),
            tags: listOfStrings(x.tags),
            group: strOrNull(x.group),
            totalMessages: typeof x.totalMessages === "number" ? x.totalMessages : 0,
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