import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

export type PendingSubscription = {
  planId: string;
  planName: string;
  status: string; // "pending" | "approved" | "rejected"
};

/**
 * Live listener on `pending_subscriptions/{uid}`. Returns the pending
 * request while `status === "pending"`, otherwise null. Admin flips this
 * doc to `approved` / `rejected` from the admin panel.
 */
export function usePendingSubscription(): {
  data: PendingSubscription | null;
  loading: boolean;
} {
  const uid = useFirebaseUid();
  const [data, setData] = useState<PendingSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      setData(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "pending_subscriptions", uid),
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setData(null);
          return;
        }
        const x = snap.data() as Record<string, unknown>;
        const status = String(x.status ?? "");
        if (status !== "pending") {
          setData(null);
          return;
        }
        setData({
          planId: String(x.planId ?? ""),
          planName: String(x.planName ?? ""),
          status,
        });
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [uid]);

  return { data, loading };
}