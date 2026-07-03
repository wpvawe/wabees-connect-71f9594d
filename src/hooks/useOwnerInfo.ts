/**
 * When the signed-in user is an agent, look up their owner's profile so we
 * can show the owner's name/email instead of a raw UID. Returns `null` when
 * the user is the owner themselves.
 */
import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!dataOwner) {
      setInfo(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(doc(db, "users", dataOwner), (snap) => {
      if (!snap.exists()) {
        setInfo({ id: dataOwner, email: null, businessName: null, displayName: null, profileImageUrl: null });
        return;
      }
      const d = snap.data() as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      setInfo({
        id: dataOwner,
        email: s(d.email),
        businessName: s(d.businessName),
        displayName: s(d.displayName) ?? s(d.fullName) ?? s(d.name),
        profileImageUrl: s(d.profileImageUrl),
      });
    }, () => {
      setInfo({ id: dataOwner, email: null, businessName: null, displayName: null, profileImageUrl: null });
    });
    return () => unsub();
  }, [dataOwner]);

  return info;
}