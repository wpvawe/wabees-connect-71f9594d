import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { toIso } from "@/lib/firebase/normalizers";

export type ActiveAnnouncement = {
  message: string;
  startsAt: string | null;
  endsAt: string | null;
};

/**
 * Reads the global announcement config and returns it only when currently
 * "live" — active flag on, and (if set) `startsAt`/`endsAt` include now.
 * Returns null when there's nothing to show.
 */
export function useAnnouncement(): ActiveAnnouncement | null {
  const [ann, setAnn] = useState<ActiveAnnouncement | null>(null);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    let stopped = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db!, "config", "announcement"));
        if (stopped) return;
        if (!snap.exists()) return setAnn(null);
        const x = snap.data() as Record<string, unknown>;
        if (x.active !== true) return setAnn(null);
        const message = ((x.message as string) ?? "").trim();
        if (!message) return setAnn(null);
        const startsAt = toIso(x.startsAt);
        const endsAt = toIso(x.endsAt);
        const now = Date.now();
        if (startsAt && new Date(startsAt).getTime() > now) return setAnn(null);
        if (endsAt && new Date(endsAt).getTime() < now) return setAnn(null);
        setAnn({ message, startsAt, endsAt });
      } catch {
        /* transient — retried on next tick */
      }
    }
    void load();
    // Poll every 10 min; also refresh when the tab regains focus so an
    // admin toggling the banner sees it within a page switch.
    const timer = window.setInterval(() => void load(), 10 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return ann;
}