import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

export type UsageCounts = {
  messages: number;
  contacts: number;
  campaigns: number;
  bots: number;
};

const emptyCounts: UsageCounts = {
  messages: 0,
  contacts: 0,
  campaigns: 0,
  bots: 0,
};

export function useUsageCounts(): { data: UsageCounts; loading: boolean; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<UsageCounts>(emptyCounts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setData(emptyCounts);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    let alive = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [messages, contacts, campaigns, bots] = await Promise.all([
          getCountFromServer(collection(db, `users/${uid}/messages`)),
          getCountFromServer(collection(db, `users/${uid}/contacts`)),
          getCountFromServer(collection(db, `users/${uid}/campaigns`)),
          getCountFromServer(collection(db, `users/${uid}/bots`)),
        ]);
        if (!alive) return;
        setData({
          messages: messages.data().count,
          contacts: contacts.data().count,
          campaigns: campaigns.data().count,
          bots: bots.data().count,
        });
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load usage counts");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid]);

  return { data, loading, error };
}