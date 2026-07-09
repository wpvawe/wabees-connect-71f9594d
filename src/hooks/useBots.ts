import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { listOfStrings, str, strOrNull, toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

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
  // MIN-01 fix — refetching on every tab focus re-billed up to 200 bot
  // docs per switch. Only refresh when the cache is >5 min old.
  const lastLoadRef = useRef(0);

  const load = useCallback(async () => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, `users/${uid}/bots`),
          orderBy("createdAt", "desc"),
          limit(200),
        ),
      );
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
      setError(null);
      lastLoadRef.current = Date.now();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    const safeLoad = async () => {
      const before = uid;
      await load();
      if (cancelled || before !== uid) return;
    };
    void safeLoad();
    const unsubBus = subscribeRefetch("bots", () => void load());
    const onVis = () => {
      // MIN-01 — 5-minute staleness guard so tab-switch spam doesn't
      // re-read all bot docs. Mutations still refresh via refetchBus.
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoadRef.current > 5 * 60_000
      ) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      unsubBus();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  return { data, error };
}
