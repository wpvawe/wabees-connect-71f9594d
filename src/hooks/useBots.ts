import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { listOfStrings, str, strOrNull, toIso } from "@/lib/firebase/normalizers";

export type Bot = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  triggerType: string;
  triggerKeywords: string[];
  caseSensitive: boolean;
  responseText: string;
  headerText?: string | null;
  templateName?: string | null;
  delaySeconds: number;
  quickReplies: Array<Record<string, unknown>>;
  ctaButton: Record<string, unknown> | null;
  footerText?: string | null;
  maxTriggersPerContact?: number | null;
  cooldownMinutes?: number | null;
  additionalResponses: Array<Record<string, unknown>>;
  totalTriggered: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export function useBots(): { data: Bot[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, `users/${uid}/bots`),
      (snap) => {
        setData(
          snap.docs
            .map((d) => {
              const x = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                name: str(x.name, "Untitled bot"),
                description: str(x.description),
                isActive: x.isActive !== false,
                triggerType: str(x.triggerType, "keyword"),
                triggerKeywords: listOfStrings(x.triggerKeywords),
                caseSensitive: Boolean(x.caseSensitive),
                responseText: str(x.responseText),
                headerText: strOrNull(x.headerText),
                templateName: strOrNull(x.templateName),
                delaySeconds: typeof x.delaySeconds === "number" ? x.delaySeconds : 0,
                quickReplies: Array.isArray(x.quickReplies)
                  ? (x.quickReplies as Array<Record<string, unknown>>)
                  : [],
                ctaButton:
                  x.ctaButton && typeof x.ctaButton === "object"
                    ? (x.ctaButton as Record<string, unknown>)
                    : null,
                footerText: strOrNull(x.footerText),
                maxTriggersPerContact:
                  typeof x.maxTriggersPerContact === "number" ? x.maxTriggersPerContact : null,
                cooldownMinutes: typeof x.cooldownMinutes === "number" ? x.cooldownMinutes : null,
                additionalResponses: Array.isArray(x.additionalResponses)
                  ? (x.additionalResponses as Array<Record<string, unknown>>)
                  : [],
                totalTriggered: typeof x.totalTriggered === "number" ? x.totalTriggered : 0,
                createdAt: toIso(x.createdAt),
                updatedAt: toIso(x.updatedAt),
              };
            })
            .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
        );
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}
