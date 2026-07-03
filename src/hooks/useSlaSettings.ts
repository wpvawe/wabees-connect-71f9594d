/**
 * Live snapshot of the owner's SLA targets. Agents inherit via effective UID.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { DEFAULT_SLA, slaDocPath, type SlaSettings } from "@/lib/firebase/sla";

export function useSlaSettings(): SlaSettings {
  const uid = useEffectiveUid();
  const [s, setS] = useState<SlaSettings>(DEFAULT_SLA);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      doc(db, slaDocPath(uid)),
      (snap) => {
        if (!snap.exists()) {
          setS(DEFAULT_SLA);
          return;
        }
        const x = snap.data() as Record<string, unknown>;
        setS({
          firstResponseMinutes:
            typeof x.firstResponseMinutes === "number"
              ? x.firstResponseMinutes
              : DEFAULT_SLA.firstResponseMinutes,
          resolutionMinutes:
            typeof x.resolutionMinutes === "number"
              ? x.resolutionMinutes
              : DEFAULT_SLA.resolutionMinutes,
        });
      },
      () => setS(DEFAULT_SLA),
    );
    return () => unsub();
  }, [uid]);

  return s;
}