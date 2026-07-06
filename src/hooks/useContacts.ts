import { useEffect, useState } from "react";
import { collection, getDocs, query, limit } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { listOfStrings, normalizePhone, str, strOrNull, toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

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

// Shared getDocs cache per uid. Previously this hook opened a live
// onSnapshot on the 2000-doc contacts collection — every remote write
// re-billed all docs. Contacts change rarely; a one-shot load + refetch
// on local mutations (via refetchBus) or window focus is enough.
type Snapshot = { data: Contact[] | null; error: string | null };
type Sub = (s: Snapshot) => void;
type Registration = {
  cleanup: () => void;
  subs: Set<Sub>;
  last: Snapshot;
  loading: boolean;
};
const REGISTRY = new Map<string, Registration>();

async function fetchContacts(uid: string): Promise<Snapshot> {
  const db = fbDbOrNull();
  if (!db) return { data: null, error: null };
  try {
    const snap = await getDocs(
      query(collection(db, `users/${uid}/contacts`), limit(2000)),
    );
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
      .sort((a, b) => (a.name || a.phone).localeCompare(b.name || b.phone));
    return { data: rows, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

function subscribeShared(uid: string, cb: Sub): () => void {
  let reg = REGISTRY.get(uid);
  if (!reg) {
    const subs = new Set<Sub>();
    const registration: Registration = {
      subs,
      last: { data: null, error: null },
      cleanup: () => {},
      loading: false,
    };
    const emit = (next: Snapshot) => {
      registration.last = next;
      subs.forEach((s) => s(next));
    };
    const load = async () => {
      if (registration.loading) return;
      registration.loading = true;
      const next = await fetchContacts(uid);
      registration.loading = false;
      emit(next);
    };
    void load();
    const unsubBus = subscribeRefetch("contacts", () => void load());
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    registration.cleanup = () => {
      unsubBus();
      document.removeEventListener("visibilitychange", onVis);
    };
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
