/**
 * Live snapshot of the owner's CSAT settings. Agents inherit via effective UID.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  DEFAULT_CSAT,
  csatSettingsPath,
  type CsatSettings,
} from "@/lib/firebase/csat";

export function useCsatSettings(): CsatSettings {
  const uid = useEffectiveUid();
  const [s, setS] = useState<CsatSettings>(DEFAULT_CSAT);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      doc(db, csatSettingsPath(uid)),
      (snap) => {
        if (!snap.exists()) {
          setS(DEFAULT_CSAT);
          return;
        }
        const x = snap.data() as Record<string, unknown>;
        setS({
          enabled: Boolean(x.enabled),
          autoOnResolve: x.autoOnResolve !== false,
          question:
            typeof x.question === "string" && x.question.trim()
              ? x.question
              : DEFAULT_CSAT.question,
          footer:
            typeof x.footer === "string" && x.footer.trim()
              ? x.footer
              : DEFAULT_CSAT.footer,
          askComment: x.askComment !== false,
          commentPrompt:
            typeof x.commentPrompt === "string" && x.commentPrompt.trim()
              ? x.commentPrompt
              : DEFAULT_CSAT.commentPrompt,
        });
      },
      () => setS(DEFAULT_CSAT),
    );
    return () => unsub();
  }, [uid]);

  return s;
}