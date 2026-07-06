/**
 * Tiny pub/sub used to trigger one-shot hook refetches after a local
 * mutation. Replaces the previous per-hook `onSnapshot` listeners on
 * rarely-changing collections (templates, plans, canned, agents) so the
 * app doesn't burn Firestore read quota on continuous streams.
 *
 * Contract: hooks call `subscribe(key, refetch)` in their effect and
 * mutation helpers call `bumpRefetch(key)` after a successful write.
 */

export type RefetchKey =
  | "templates"
  | "plans"
  | "canned"
  | "agents"
  | "contacts"
  | "bots"
  | "leads"
  | "campaigns"
  | "pendingSubs"
  | "adminNotifications"
  | "supportChats"
  | "userSub"
  | "configDoc"
  | "adminUsers"
  | "csatSurveys";

type Listener = () => void;

const listeners = new Map<RefetchKey, Set<Listener>>();

export function subscribeRefetch(key: RefetchKey, cb: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

export function bumpRefetch(key: RefetchKey): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of set) {
    try {
      cb();
    } catch {
      /* listener errors shouldn't break the caller */
    }
  }
}