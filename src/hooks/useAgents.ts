import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { str, strOrNull, toIso } from "@/lib/firebase/normalizers";

export type Agent = {
  id: string;
  email: string;
  joinedAt: string | null;
  role: string | null;
  status: string;
  revokedAt: string | null;
};

export function useAgents(): { data: Agent[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, `users/${uid}/agents`),
      (snap) => {
        setData(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              email: str(x.email),
              joinedAt: toIso(x.joinedAt),
              role: strOrNull(x.role),
              status: (typeof x.status === "string" && x.status) ? x.status : "active",
              revokedAt: toIso(x.revokedAt),
            };
          }),
        );
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}
