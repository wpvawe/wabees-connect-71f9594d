import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
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
    const unsub = onSnapshot(doc(db, "config", "announcement"), (snap) => {
      if (!snap.exists()) {
        setAnn(null);
        return;
      }
      const x = snap.data() as Record<string, unknown>;
      if (x.active !== true) {
        setAnn(null);
        return;
      }
      const message = ((x.message as string) ?? "").trim();
      if (!message) {
        setAnn(null);
        return;
      }
      const startsAt = toIso(x.startsAt);
      const endsAt = toIso(x.endsAt);
      const now = Date.now();
      if (startsAt && new Date(startsAt).getTime() > now) {
        setAnn(null);
        return;
      }
      if (endsAt && new Date(endsAt).getTime() < now) {
        setAnn(null);
        return;
      }
      setAnn({ message, startsAt, endsAt });
    });
    return () => unsub();
  }, []);
  return ann;
}