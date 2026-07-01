import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { toIso } from "@/lib/firebase/normalizers";
import type { TagDef } from "@/lib/firebase/conversations";

/**
 * Realtime tag catalog subscribed at users/{uid}/tags. Mirrors the Flutter
 * app's tag collection so the same colored labels appear on web + mobile.
 */
export function useConvTags(): { data: TagDef[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<TagDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, `users/${uid}/tags`),
      (snap) => {
        const rows: TagDef[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: typeof x.name === "string" ? x.name : "",
            color: typeof x.color === "string" ? x.color : "#64748b",
            createdAt: toIso(x.createdAt) ?? undefined,
          };
        });
        setData(rows.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}