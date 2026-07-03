/**
 * Live snapshot of the owner's auto-triage settings.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  DEFAULT_TRIAGE,
  triageDocPath,
  type AutoTriageSettings,
} from "@/lib/firebase/triage";

export function useTriageSettings(): AutoTriageSettings {
  const uid = useEffectiveUid();
  const [s, setS] = useState<AutoTriageSettings>(DEFAULT_TRIAGE);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      doc(db, triageDocPath(uid)),
      (snap) => {
        if (!snap.exists()) {
          setS(DEFAULT_TRIAGE);
          return;
        }
        const x = snap.data() as Record<string, unknown>;
        setS({
          enabled: Boolean(x.enabled),
          autoApplyTags: x.autoApplyTags === undefined ? true : Boolean(x.autoApplyTags),
          autoSetPriority: x.autoSetPriority === undefined ? true : Boolean(x.autoSetPriority),
          categories: Array.isArray(x.categories)
            ? (x.categories.filter((c) => typeof c === "string") as string[])
            : DEFAULT_TRIAGE.categories,
        });
      },
      () => setS(DEFAULT_TRIAGE),
    );
    return () => unsub();
  }, [uid]);

  return s;
}