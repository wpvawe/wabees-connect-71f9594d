import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

export type WhatsAppConfig = {
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone: string | null;
  business_name: string | null;
  quality_rating: string | null;
  connected: boolean;
  method: "embedded_signup" | "manual";
};

/** Live WhatsApp connection status, sourced from `users/{uid}`. */
export function useWhatsAppConfig(): { data: WhatsAppConfig | null; loading: boolean; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    // Mirror the Flutter app: source of truth is `whatsapp_config/config`.
    // Also watch the top-level user doc for legacy fields written by older
    // website builds (whatsappPhoneNumberId, whatsappConnected, etc.).
    let userDoc: Record<string, unknown> | null = null;
    let subDoc: Record<string, unknown> | null = null;
    let userReady = false;
    let subReady = false;
    function merge() {
      if (!userReady || !subReady) return;
      setLoading(false);
      const sub = subDoc ?? {};
      const usr = userDoc ?? {};
      const phone_number_id =
        (sub.phoneNumberId as string | undefined) ??
        (usr.whatsappPhoneNumberId as string | undefined) ??
        null;
      const connected =
        Boolean(phone_number_id) &&
        (Boolean(sub.isConnected) || Boolean(usr.whatsappConnected));
      if (!connected) {
        setData(null);
        return;
      }
      setData({
        phone_number_id,
        waba_id:
          (sub.businessAccountId as string | undefined) ??
          (usr.whatsappBusinessAccountId as string | undefined) ??
          null,
        display_phone:
          (sub.displayPhoneNumber as string | undefined) ??
          (usr.whatsappDisplayPhone as string | undefined) ??
          null,
        business_name:
          (sub.businessName as string | undefined) ??
          (usr.businessName as string | undefined) ??
          null,
        quality_rating:
          (sub.qualityRating as string | undefined) ??
          (usr.whatsappQualityRating as string | undefined) ??
          null,
        connected: true,
        method: (sub.connectedVia === "embedded_signup" ? "embedded_signup" : "manual"),
      });
    }
    const unsubUser = onSnapshot(
      doc(fbDb(), "users", uid),
      (snap) => {
        userReady = true;
        userDoc = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        merge();
      },
      (err) => { setLoading(false); setError(err.message); },
    );
    const unsubSub = onSnapshot(
      doc(fbDb(), "users", uid, "whatsapp_config", "config"),
      (snap) => {
        subReady = true;
        subDoc = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        merge();
      },
      (err) => { setLoading(false); setError(err.message); },
    );
    return () => { unsubUser(); unsubSub(); };
  }, [uid]);

  return { data, loading, error };
}