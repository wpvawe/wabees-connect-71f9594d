import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";

export type Profile = {
  id: string;
  email: string;
  businessName: string;
  phoneNumber: string;
  profileImageUrl: string | null;
  role: string;
  status: string;
  totalMessages: number;
  totalContacts: number;
  totalBots: number;
  totalCampaigns: number;
};

export type ProfileWithFlags = Profile & { aiBotEnabled: boolean };

export function useProfile(scope: "self" | "effective" = "self"): {
  data: Profile | null;
  loading: boolean;
  error: string | null;
} {
  const selfUid = useFirebaseUid();
  const effectiveUid = useEffectiveUid();
  const uid = scope === "effective" ? effectiveUid : selfUid;
  const [data, setData] = useState<Profile | null>(null);
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
        setData({
          id: uid,
          email: (d.email as string) ?? "",
          businessName: (d.businessName as string) ?? "",
          phoneNumber: (d.phoneNumber as string) ?? "",
          profileImageUrl: (d.profileImageUrl as string | null) ?? null,
          role: (d.role as string) ?? "user",
          status: (d.status as string) ?? "active",
          totalMessages: (d.totalMessages as number) ?? 0,
          totalContacts: (d.totalContacts as number) ?? 0,
          totalBots: (d.totalBots as number) ?? 0,
          totalCampaigns: (d.totalCampaigns as number) ?? 0,
        });
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
