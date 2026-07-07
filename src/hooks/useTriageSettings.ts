/**
 * Live snapshot of the owner's auto-triage settings.
 */
import { useEffect, useState } from "react";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  DEFAULT_TRIAGE,
  triageDocPath,
  type AutoTriageSettings,
} from "@/lib/firebase/triage";
import { subscribeDoc } from "@/lib/firebase/docBroker";

export function useTriageSettings(): AutoTriageSettings {
  const uid = useEffectiveUid();
  const [s, setS] = useState<AutoTriageSettings>(DEFAULT_TRIAGE);

  useEffect(() => {
    if (!uid) return;
    const path = triageDocPath(uid).split("/");
    return subscribeDoc(path, (snap) => {
      if (snap.error) {
        setS(DEFAULT_TRIAGE);
        return;
      }
      if (!snap.exists || !snap.data) {
        setS(DEFAULT_TRIAGE);
        return;
      }
      const x = snap.data as Record<string, unknown>;
        setS({
          enabled: Boolean(x.enabled),
          autoApplyTags: x.autoApplyTags === undefined ? true : Boolean(x.autoApplyTags),
          autoSetPriority: x.autoSetPriority === undefined ? true : Boolean(x.autoSetPriority),
          categories: Array.isArray(x.categories)
            ? (x.categories.filter((c) => typeof c === "string") as string[])
            : DEFAULT_TRIAGE.categories,
        });
    });
  }, [uid]);

  return s;
}