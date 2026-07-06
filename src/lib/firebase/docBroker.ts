/**
 * Shared onSnapshot broker for individual Firestore documents.
 *
 * Many hooks read the same document (e.g. `users/{uid}` is read by
 * `useFirebaseSession`, `useProfile("self")`, `useProfile("effective")`,
 * `AccountStatusGate`, `SideRail` …). Each mount previously opened its
 * own onSnapshot on the exact same doc — every write billed N reads.
 *
 * The broker keeps ONE listener per doc path, ref-counted across
 * subscribers. Late subscribers get the last cached snapshot
 * immediately, then updates as they arrive.
 */
import { doc, onSnapshot, type DocumentData } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";

export type DocSnapshot = {
  exists: boolean;
  data: DocumentData | null;
  error: string | null;
};

type Listener = (snap: DocSnapshot) => void;

type Registration = {
  unsub: () => void;
  listeners: Set<Listener>;
  last: DocSnapshot | null;
};

const REGISTRY = new Map<string, Registration>();

export function subscribeDoc(pathSegments: string[], cb: Listener): () => void {
  const key = pathSegments.join("/");
  let reg = REGISTRY.get(key);
  if (!reg) {
    const db = fbDbOrNull();
    if (!db) return () => {};
    if (pathSegments.length < 1) return () => {};
    const [first, ...rest] = pathSegments;
    const ref = doc(db, first, ...rest);
    const registration: Registration = {
      listeners: new Set(),
      last: null,
      unsub: () => {},
    };
    registration.unsub = onSnapshot(
      ref,
      (snap) => {
        const next: DocSnapshot = {
          exists: snap.exists(),
          data: snap.exists() ? (snap.data() as DocumentData) : null,
          error: null,
        };
        registration.last = next;
        for (const l of registration.listeners) {
          try {
            l(next);
          } catch {
            /* subscriber errors should not break siblings */
          }
        }
      },
      (err) => {
        const next: DocSnapshot = { exists: false, data: null, error: err.message };
        registration.last = next;
        for (const l of registration.listeners) {
          try {
            l(next);
          } catch {
            /* ignore */
          }
        }
      },
    );
    reg = registration;
    REGISTRY.set(key, reg);
  }
  reg.listeners.add(cb);
  if (reg.last) cb(reg.last);
  return () => {
    const r = REGISTRY.get(key);
    if (!r) return;
    r.listeners.delete(cb);
    if (r.listeners.size === 0) {
      r.unsub();
      REGISTRY.delete(key);
    }
  };
}