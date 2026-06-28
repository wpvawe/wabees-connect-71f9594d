import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

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
  const uid = useFirebaseUid();
  const [data, setData] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(fbDb(), "users", uid),
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setData(null);
          return;
        }
        const d = snap.data();
        const phone_number_id = (d.whatsappPhoneNumberId as string | null) ?? null;
        const connected = Boolean(d.whatsappConnected) && Boolean(phone_number_id);
        setData(
          connected
            ? {
                phone_number_id,
                waba_id: (d.whatsappBusinessAccountId as string | null) ?? null,
                display_phone: (d.whatsappDisplayPhone as string | null) ?? null,
                business_name: (d.businessName as string | null) ?? null,
                quality_rating: (d.whatsappQualityRating as string | null) ?? null,
                connected: true,
                method: "manual",
              }
            : null,
        );
      },
      (err) => {
        setLoading(false);
        setError(err.message);
      },
    );
    return () => unsub();
  }, [uid]);

  return { data, loading, error };
}