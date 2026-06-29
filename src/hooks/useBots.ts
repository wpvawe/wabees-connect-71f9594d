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
  responseText: string;
  templateName?: string | null;
  delaySeconds: number;
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
        setData(snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: str(x.name, "Untitled bot"),
            description: str(x.description),
            isActive: x.isActive !== false,
            triggerType: str(x.triggerType, "keyword"),
            triggerKeywords: listOfStrings(x.triggerKeywords),
            responseText: str(x.responseText),
            templateName: strOrNull(x.templateName),
            delaySeconds: typeof x.delaySeconds === "number" ? x.delaySeconds : 0,
            totalTriggered: typeof x.totalTriggered === "number" ? x.totalTriggered : 0,
            createdAt: toIso(x.createdAt),
            updatedAt: toIso(x.updatedAt),
          };
        }).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}