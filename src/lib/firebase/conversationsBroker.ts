/**
 * Shared onSnapshot broker for `users/{uid}/conversations`.
 *
 * `useConversations` is mounted from many places at once (inbox list,
 * inbox detail, dashboard, analytics, workload, `useUnreadTitle`). Each
 * mount previously opened its own onSnapshot on the exact same query —
 * one write billed N reads. The broker keeps ONE listener per uid,
 * ref-counted across subscribers, and dynamically re-subscribes to the
 * MAX pageLimit any subscriber currently wants so "Show more" in one
 * component still works without penalising others.
 */
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";

export type RawConvDoc = { id: string; data: Record<string, unknown> };

export type ConvSnapshot =
  | { docs: RawConvDoc[]; error: null }
  | { docs: null; error: string };

type Subscriber = { desired: number; cb: (snap: ConvSnapshot) => void };

type Registration = {
  unsub: () => void;
  currentLimit: number;
  subscribers: Set<Subscriber>;
  last: ConvSnapshot | null;
};

const REGISTRY = new Map<string, Registration>();

function toRaw(docs: QueryDocumentSnapshot[]): RawConvDoc[] {
  return docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
}

function openListener(uid: string, reg: Registration, pageLimit: number): void {
  const db = fbDbOrNull();
  if (!db) return;
  if (reg.unsub) reg.unsub();
  reg.currentLimit = pageLimit;
  reg.unsub = onSnapshot(
    query(
      collection(db, `users/${uid}/conversations`),
      orderBy("lastMessageAt", "desc"),
      limit(pageLimit),
    ),
    (snap) => {
      const next: ConvSnapshot = { docs: toRaw(snap.docs), error: null };
      reg.last = next;
      for (const s of reg.subscribers) s.cb(next);
    },
    (err) => {
      const next: ConvSnapshot = { docs: null, error: err.message };
      reg.last = next;
      for (const s of reg.subscribers) s.cb(next);
    },
  );
}

function maxDesired(reg: Registration): number {
  let m = 0;
  for (const s of reg.subscribers) if (s.desired > m) m = s.desired;
  return m;
}

export function subscribeConversations(
  uid: string,
  pageLimit: number,
  cb: (snap: ConvSnapshot) => void,
): () => void {
  let reg = REGISTRY.get(uid);
  if (!reg) {
    reg = {
      unsub: () => {},
      currentLimit: 0,
      subscribers: new Set(),
      last: null,
    };
    REGISTRY.set(uid, reg);
  }
  const sub: Subscriber = { desired: pageLimit, cb };
  reg.subscribers.add(sub);
  if (pageLimit > reg.currentLimit) {
    openListener(uid, reg, pageLimit);
  } else if (reg.last) {
    cb(reg.last);
  }
  return () => {
    const r = REGISTRY.get(uid);
    if (!r) return;
    r.subscribers.delete(sub);
    if (r.subscribers.size === 0) {
      r.unsub();
      REGISTRY.delete(uid);
      return;
    }
    const nextMax = maxDesired(r);
    if (nextMax < r.currentLimit) {
      // Downsize listener so a component holding "Show more" doesn't
      // permanently pin a huge window after it unmounts.
      openListener(uid, r, nextMax);
    }
  };
}