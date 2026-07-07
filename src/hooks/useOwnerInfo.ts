/**
 * When the signed-in user is an agent, look up their owner's profile so we
 * can show the owner's name/email instead of a raw UID. Returns `null` when
 * the user is the owner themselves.
 */
import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";

export type OwnerInfo = {
  id: string;
  email: string | null;
  businessName: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
};

export function useOwnerInfo(): OwnerInfo | null {
  const session = useFirebaseSession();
  const dataOwner = session.status === "ready" ? session.dataOwner : null;
  const [info, setInfo] = useState<OwnerInfo | null>(null);
  // P-perf — preserve object identity when owner doc listener fires
  // with an unchanged payload so consumers don't re-render needlessly.
  const lastRef = useRef<OwnerInfo | null>(null);
  const apply = (next: OwnerInfo | null) => {
    const prev = lastRef.current;
    if (prev === next) return;
    if (prev && next && shallowEqualOwner(prev, next)) return;
    lastRef.current = next;
    setInfo(next);
  };

  useEffect(() => {
    if (!dataOwner) {
      apply(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(doc(db, "users", dataOwner), (snap) => {
      if (!snap.exists()) {
        apply({ id: dataOwner, email: null, businessName: null, displayName: null, profileImageUrl: null });
        return;
      }
      const d = snap.data() as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      apply({
        id: dataOwner,
        email: s(d.email),
        businessName: s(d.businessName),
        displayName: s(d.displayName) ?? s(d.fullName) ?? s(d.name),
        profileImageUrl: s(d.profileImageUrl),
      });
    }, () => {
      apply({ id: dataOwner, email: null, businessName: null, displayName: null, profileImageUrl: null });
    });
    return () => unsub();
  }, [dataOwner]);

  return info;
}

function shallowEqualOwner(a: OwnerInfo, b: OwnerInfo): boolean {
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.businessName === b.businessName &&
    a.displayName === b.displayName &&
    a.profileImageUrl === b.profileImageUrl
  );
}