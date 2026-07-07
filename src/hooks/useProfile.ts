import { useEffect, useRef, useState } from "react";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { subscribeDoc } from "@/lib/firebase/docBroker";

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
  aiBotEnabled: boolean;
  whatsappConnected: boolean;
};

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
  // P-perf — preserve object identity when the snapshot payload hasn't
  // changed. `totalMessages` increments and other tiny writes fire the
  // listener frequently, and ~15 consumers of `useProfile()` re-render
  // on every fresh object even when their read fields are unchanged.
  const lastRef = useRef<Profile | null>(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeDoc(["users", uid], (snap) => {
      setLoading(false);
      if (snap.error) {
        setError(snap.error);
        return;
      }
      if (!snap.exists || !snap.data) {
        if (lastRef.current !== null) lastRef.current = null;
        setData(null);
        return;
      }
      const d = snap.data;
      const next: Profile = {
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
          aiBotEnabled: Boolean(d.aiBotEnabled),
          whatsappConnected: d.whatsappConnected === true,
      };
      const prev = lastRef.current;
      if (prev && shallowEqualProfile(prev, next)) return;
      lastRef.current = next;
      setData(next);
    });
    return () => unsub();
  }, [uid]);

  return { data, loading, error };
}

function shallowEqualProfile(a: Profile, b: Profile): boolean {
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.businessName === b.businessName &&
    a.phoneNumber === b.phoneNumber &&
    a.profileImageUrl === b.profileImageUrl &&
    a.role === b.role &&
    a.status === b.status &&
    a.totalMessages === b.totalMessages &&
    a.totalContacts === b.totalContacts &&
    a.totalBots === b.totalBots &&
    a.totalCampaigns === b.totalCampaigns &&
    a.aiBotEnabled === b.aiBotEnabled &&
    a.whatsappConnected === b.whatsappConnected
  );
}
