import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { str } from "@/lib/firebase/normalizers";

export type AiBotConfig = {
  enabled: boolean;
  businessName: string;
  businessType: string;
  services: string;
  timings: string;
  location: string;
  contacts: string;
  customInfo: string;
  faq: string;
  customInstructions: string;
  tone: string;
  greeting: string;
  handoffKeywords: string;
  leadFields: string;
  afterHoursMessage: string;
};

export const EMPTY_AI_CONFIG: AiBotConfig = {
  enabled: false,
  businessName: "",
  businessType: "",
  services: "",
  timings: "",
  location: "",
  contacts: "",
  customInfo: "",
  faq: "[]",
  customInstructions: "",
  tone: "professional and friendly",
  greeting: "",
  handoffKeywords: "",
  leadFields: "",
  afterHoursMessage: "",
};

export function useAiBotConfig(): { data: AiBotConfig | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<AiBotConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      doc(db, `users/${uid}/bot_config/settings`),
      (snap) => {
        if (!snap.exists()) { setData({ ...EMPTY_AI_CONFIG }); return; }
        const x = snap.data() as Record<string, unknown>;
        setData({
          enabled: Boolean(x.enabled),
          businessName: str(x.businessName),
          businessType: str(x.businessType),
          services: str(x.services),
          timings: str(x.timings),
          location: str(x.location),
          contacts: str(x.contacts),
          customInfo: str(x.customInfo),
          faq: str(x.faq, "[]"),
          customInstructions: str(x.customInstructions),
          tone: str(x.tone, "professional and friendly"),
          greeting: str(x.greeting),
          handoffKeywords: str(x.handoffKeywords),
          leadFields: str(x.leadFields),
          afterHoursMessage: str(x.afterHoursMessage),
        });
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}