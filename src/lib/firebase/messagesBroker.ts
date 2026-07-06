/**
 * Shared broker over the owner's inbound-messages tail.
 *
 * Previously `useIncomingMessageAlerts`, `useAutoTriage`, and
 * `useCsatCapture` each opened their own `onSnapshot` on
 * `users/{uid}/messages` (limit 20), and `useCsatCapture` additionally
 * fanned out one listener per pending phone (up to 50). That was 3-53
 * concurrent live listeners all watching the exact same collection.
 *
 * The broker collapses that to a SINGLE Firestore listener per uid,
 * reference-counted across subscribers. Each subscriber gets the newly
 * added (change.type !== 'removed') incoming message docs decoded once.
 * Skips initial backfill so consumers only see truly new messages.
 */
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";

export type IncomingMessage = {
  id: string;
  data: Record<string, unknown>;
  createdAtMs: number;
};

type Listener = (msg: IncomingMessage) => void;

type Registration = {
  unsub: () => void;
  listeners: Set<Listener>;
  seen: Set<string>;
  first: boolean;
  subscribedAt: number;
};

const REGISTRY = new Map<string, Registration>();
const SEEN_CAP = 500;

function remember(reg: Registration, id: string) {
  if (reg.seen.size >= SEEN_CAP) {
    const first = reg.seen.values().next().value;
    if (first) reg.seen.delete(first);
  }
  reg.seen.add(id);
}

export function subscribeIncomingMessages(uid: string, cb: Listener): () => void {
  let reg = REGISTRY.get(uid);
  if (!reg) {
    const db = fbDbOrNull();
    if (!db) return () => {};
    const registration: Registration = {
      listeners: new Set(),
      seen: new Set(),
      first: true,
      subscribedAt: Date.now(),
      unsub: () => {},
    };
    const q = query(
      collection(db, `users/${uid}/messages`),
      where("direction", "==", "incoming"),
      orderBy("createdAt", "desc"),
      limit(20),
    );
    registration.unsub = onSnapshot(
      q,
      (snap) => {
        if (registration.first) {
          for (const d of snap.docs) remember(registration, d.id);
          registration.first = false;
          return;
        }
        for (const change of snap.docChanges()) {
          if (change.type === "removed") continue;
          const d = change.doc;
          if (registration.seen.has(d.id)) continue;
          remember(registration, d.id);
          const data = d.data() as Record<string, unknown>;
          const created = (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
          const createdAtMs = created ? created.getTime() : Date.now();
          const msg: IncomingMessage = { id: d.id, data, createdAtMs };
          for (const l of registration.listeners) {
            try {
              l(msg);
            } catch {
              /* subscriber errors shouldn't break siblings */
            }
          }
        }
      },
      () => {},
    );
    reg = registration;
    REGISTRY.set(uid, reg);
  }
  reg.listeners.add(cb);
  return () => {
    const r = REGISTRY.get(uid);
    if (!r) return;
    r.listeners.delete(cb);
    if (r.listeners.size === 0) {
      r.unsub();
      REGISTRY.delete(uid);
    }
  };
}

/** Timestamp when a uid's broker was first attached (for backfill guards). */
export function brokerSubscribedAt(uid: string): number {
  return REGISTRY.get(uid)?.subscribedAt ?? Date.now();
}