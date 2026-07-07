/**
 * Live snapshot of the owner's CSAT settings. Agents inherit via effective UID.
 */
import { useEffect, useState } from "react";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  DEFAULT_CSAT,
  csatSettingsPath,
  type CsatSettings,
} from "@/lib/firebase/csat";
import { subscribeDoc } from "@/lib/firebase/docBroker";

export function useCsatSettings(): CsatSettings {
  const uid = useEffectiveUid();
  const [s, setS] = useState<CsatSettings>(DEFAULT_CSAT);

  useEffect(() => {
    if (!uid) return;
    const path = csatSettingsPath(uid).split("/");
    return subscribeDoc(path, (snap) => {
      if (snap.error) {
        setS(DEFAULT_CSAT);
        return;
      }
      if (!snap.exists || !snap.data) {
        setS(DEFAULT_CSAT);
        return;
      }
      const x = snap.data as Record<string, unknown>;
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
    });
  }, [uid]);

  return s;
}