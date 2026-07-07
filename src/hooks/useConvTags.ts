import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { toIso } from "@/lib/firebase/normalizers";
import type { TagDef } from "@/lib/firebase/conversations";

// P-perf — shared broker per uid. ConversationList (list view) and
// ContactDetailsDrawer (thread view) both mount this hook, and every
// row that renders a colored chip re-derives the same catalog. Coalesce
// into ONE onSnapshot listener over `users/{uid}/tags`.
type Snapshot = { data: TagDef[] | null; error: string | null };
type Sub = (s: Snapshot) => void;
type Registration = { subs: Set<Sub>; last: Snapshot; cleanup: () => void };
const REGISTRY = new Map<string, Registration>();

function subscribeShared(uid: string, cb: Sub): () => void {
  let reg = REGISTRY.get(uid);
  if (!reg) {
    const db = fbDbOrNull();
    if (!db) return () => {};
    const subs = new Set<Sub>();
    const registration: Registration = {
      subs,
      last: { data: null, error: null },
      cleanup: () => {},
    };
    const emit = (next: Snapshot) => {
      registration.last = next;
      subs.forEach((s) => s(next));
    };
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
        emit({ data: rows.sort((a, b) => a.name.localeCompare(b.name)), error: null });
      },
      (err) => emit({ data: registration.last.data, error: err.message }),
    );
    registration.cleanup = () => unsub();
    reg = registration;
    REGISTRY.set(uid, reg);
  }
  reg.subs.add(cb);
  cb(reg.last);
  return () => {
    const r = REGISTRY.get(uid);
    if (!r) return;
    r.subs.delete(cb);
    if (r.subs.size === 0) {
      r.cleanup();
      REGISTRY.delete(uid);
    }
  };
}

/**
 * Realtime tag catalog subscribed at users/{uid}/tags. Mirrors the Flutter
 * app's tag collection so the same colored labels appear on web + mobile.
 */
export function useConvTags(): { data: TagDef[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [snap, setSnap] = useState<Snapshot>({ data: null, error: null });

  useEffect(() => {
    if (!uid) return;
    return subscribeShared(uid, setSnap);
  }, [uid]);

  return snap;
}