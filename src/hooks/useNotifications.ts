import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string | null;
  targetAgentId: string | null;
};

// P-perf — shared broker per uid so TopBar (unread badge) and the
// notifications page reuse ONE Firestore listener instead of opening two
// live streams over the same 100-doc collection.
type Snapshot = { data: AppNotification[] | null; error: string | null };
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
    const q = query(
      collection(db, `users/${uid}/notifications`),
      orderBy("createdAt", "desc"),
      // Audit §1.3 — 100-doc live window re-billed 100 reads per new
      // notification. 25 is what the UI actually renders in the dropdown;
      // "load more" can grow via a one-shot getDocs later if needed.
      limit(25),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const HIDE_TYPES = new Set(["new_message", "bot_triggered"]);
        const list = snap.docs
          .map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              title: str(x.title),
              body: str(x.body),
              type: str(x.type, "system"),
              data:
                x.data && typeof x.data === "object"
                  ? (x.data as Record<string, unknown>)
                  : {},
              read: Boolean(x.read),
              createdAt: toIso(x.createdAt),
              targetAgentId:
                typeof x.targetAgentId === "string" ? (x.targetAgentId as string) : null,
            } as AppNotification;
          })
          .filter((n) => !HIDE_TYPES.has(n.type));
        emit({ data: list, error: null });
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

export function useNotifications(): {
  data: AppNotification[] | null;
  unread: number;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const [snap, setSnap] = useState<Snapshot>({ data: null, error: null });

  useEffect(() => {
    if (!uid || !selfUid) return;
    return subscribeShared(uid, setSnap);
  }, [uid, selfUid]);

  // Owner (uid == selfUid) sees everything; agents only see items targeted
  // at them or with no target (broadcast). Filter here (per-consumer) so the
  // broker cache stays owner-scoped and shareable across TopBar + page.
  const raw = snap.data;
  const data =
    raw && uid && selfUid
      ? uid === selfUid
        ? raw
        : raw.filter((n) => n.targetAgentId === null || n.targetAgentId === selfUid)
      : raw;
  const unread = data ? data.filter((n) => !n.read).length : 0;
  return { data, unread, error: snap.error };
}
