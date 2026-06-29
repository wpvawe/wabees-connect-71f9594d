import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { normalizePhone, phoneQueryCandidates, str, strOrNull, toIso } from "@/lib/firebase/normalizers";

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
  mediaId?: string | null;
  templateName?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  quickReplies?: Array<Record<string, unknown>> | null;
  ctaButton?: Record<string, unknown> | null;
  whatsappMessageId?: string | null;
  errorReason?: string | null;
  createdAt: string | null;
};

export function useMessages(phone: string | undefined): { data: Message[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !phone) return;
    const db = fbDbOrNull();
    if (!db) return;
    setData(null);
    const candidates = phoneQueryCandidates(phone);
    const q = query(
      collection(db, `users/${uid}/messages`),
      candidates.length === 1 ? where("contactPhone", "==", candidates[0]) : where("contactPhone", "in", candidates),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Message[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const contactPhone = str(x.contactPhone, phone);
          return {
            id: d.id,
            contactPhone: normalizePhone(contactPhone),
            contactName: str(x.contactName, normalizePhone(contactPhone)),
            type: str(x.type, "text"),
            direction: ((x.direction as string) === "outgoing" ? "outgoing" : "incoming") as
              | "incoming"
              | "outgoing",
            status: str(x.status, "sent"),
            body: str(x.body),
            mediaUrl: strOrNull(x.mediaUrl),
            mediaId: strOrNull(x.mediaId),
            mimeType: strOrNull(x.mimeType),
            caption: strOrNull(x.caption),
            fileName: strOrNull(x.fileName),
            templateName: strOrNull(x.templateName),
            headerText: strOrNull(x.headerText),
            footerText: strOrNull(x.footerText),
            quickReplies: Array.isArray(x.quickReplies) ? x.quickReplies as Array<Record<string, unknown>> : null,
            ctaButton: x.ctaButton && typeof x.ctaButton === "object" ? x.ctaButton as Record<string, unknown> : null,
            whatsappMessageId: strOrNull(x.whatsappMessageId),
            errorReason: strOrNull(x.errorReason),
            createdAt: toIso(x.createdAt),
          };
        }).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, phone]);

  return { data, error };
}