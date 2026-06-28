import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

export type Message = {
  id: string;
  contactPhone: string;
  contactName: string;
  type: string;
  direction: "incoming" | "outgoing";
  status: string;
  body: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  fileName?: string | null;
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

export function useMessages(phone: string | undefined): { data: Message[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !phone) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(
      collection(db, `users/${uid}/messages`),
      where("contactPhone", "==", phone),
      orderBy("createdAt", "asc"),
      limit(500),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Message[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            contactPhone: (x.contactPhone as string) ?? phone,
            contactName: (x.contactName as string) ?? phone,
            type: (x.type as string) ?? "text",
            direction: ((x.direction as string) === "outgoing" ? "outgoing" : "incoming") as
              | "incoming"
              | "outgoing",
            status: (x.status as string) ?? "sent",
            body: (x.body as string) ?? "",
            mediaUrl: (x.mediaUrl as string | null) ?? null,
            mimeType: (x.mimeType as string | null) ?? null,
            caption: (x.caption as string | null) ?? null,
            fileName: (x.fileName as string | null) ?? null,
            createdAt: toIso(x.createdAt),
          };
        });
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, phone]);

  return { data, error };
}