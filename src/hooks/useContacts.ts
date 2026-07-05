import { useEffect, useState } from "react";
import { collection, onSnapshot, query, limit } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { listOfStrings, normalizePhone, str, strOrNull, toIso } from "@/lib/firebase/normalizers";

export type Contact = {
  id: string;
  phone: string;
  name: string;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  tags: string[];
  group?: string | null;
  profileImageUrl?: string | null;
  totalMessages: number;
  lastMessageAt: string | null;
  createdAt: string | null;
};

// P2 fix — was: each `useContacts()` call site (Composer, ConversationList,
// ContactDetailsDrawer, CampaignForm, CampaignDetail) opened its OWN
// Firestore listener on the 2000-doc contacts collection. On a busy
// account this was 5× the reads on every write. Now we share ONE
// listener per uid with reference counting — all consumers get the same
// snapshot but Firestore only sees a single WebSocket channel.
type Snapshot = { data: Contact[] | null; error: string | null };
type Sub = (s: Snapshot) => void;
type Registration = {
  unsub: () => void;
  subs: Set<Sub>;
  last: Snapshot;
};
const REGISTRY = new Map<string, Registration>();

function subscribeShared(uid: string, cb: Sub): () => void {
  let reg = REGISTRY.get(uid);
  if (!reg) {
    const db = fbDbOrNull();
    if (!db) {
      const noop: Sub = () => {};
      cb({ data: null, error: null });
      return () => void noop;
    }
    const subs = new Set<Sub>();
    const registration: Registration = {
      subs,
      last: { data: null, error: null },
      unsub: () => {},
    };
    const emit = (next: Snapshot) => {
      registration.last = next;
      subs.forEach((s) => s(next));
    };
    registration.unsub = onSnapshot(
      query(collection(db, `users/${uid}/contacts`), limit(2000)),
      (snap) => {
        const rows: Contact[] = snap.docs
          .map((d) => {
            const x = d.data() as Record<string, unknown>;
            const phone = str(x.phone, d.id);
            return {
              id: d.id,
              phone: phone ? normalizePhone(phone) : "",
              name: str(x.name, phone || d.id),
              email: strOrNull(x.email),
              company: strOrNull(x.company),
              notes: strOrNull(x.notes),
              tags: listOfStrings(x.tags),
              group: strOrNull(x.group),
              profileImageUrl: strOrNull(x.profileImageUrl),
              totalMessages:
                typeof x.totalMessages === "number" ? x.totalMessages : 0,
              lastMessageAt: toIso(x.lastMessageAt),
              createdAt: toIso(x.createdAt),
            };
          })
          .sort((a, b) =>
            (a.name || a.phone).localeCompare(b.name || b.phone),
          );
        emit({ data: rows, error: null });
      },
      (err) => emit({ data: null, error: err.message }),
    );
    reg = registration;
    REGISTRY.set(uid, reg);
  }
  reg.subs.add(cb);
  // Prime the new subscriber with the latest snapshot immediately.
  cb(reg.last);
  return () => {
    const r = REGISTRY.get(uid);
    if (!r) return;
    r.subs.delete(cb);
    if (r.subs.size === 0) {
      r.unsub();
      REGISTRY.delete(uid);
    }
  };
}

export function useContacts(): { data: Contact[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [snap, setSnap] = useState<Snapshot>({ data: null, error: null });

  useEffect(() => {
    if (!uid) {
      setSnap({ data: null, error: null });
      return;
    }
    return subscribeShared(uid, setSnap);
  }, [uid]);

  return snap;
}
