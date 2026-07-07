/**
 * Live snapshot of the owner's SLA targets. Agents inherit via effective UID.
 */
import { useEffect, useState } from "react";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { DEFAULT_SLA, slaDocPath, type SlaSettings } from "@/lib/firebase/sla";
import { subscribeDoc } from "@/lib/firebase/docBroker";

export function useSlaSettings(): SlaSettings {
  const uid = useEffectiveUid();
  const [s, setS] = useState<SlaSettings>(DEFAULT_SLA);

  useEffect(() => {
    if (!uid) return;
    const path = slaDocPath(uid).split("/");
    return subscribeDoc(path, (snap) => {
      if (snap.error) {
        setS(DEFAULT_SLA);
        return;
      }
      if (!snap.exists || !snap.data) {
        setS(DEFAULT_SLA);
        return;
      }
      const x = snap.data as Record<string, unknown>;
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
    });
  }, [uid]);

  return s;
}