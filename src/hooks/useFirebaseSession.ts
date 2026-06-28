/**
 * Firebase auth state hook. Subscribes once at the app shell and exposes the
 * current Firebase user to downstream Firestore hooks. With Firebase Auth as
 * the only auth system (mirroring the Flutter app), "ready" simply means a
 * signed-in user exists.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { fbAuth, fbDb } from "@/integrations/firebase/client";

type State =
  | { status: "loading" }
  | { status: "no_uid" }
  | { status: "ready"; uid: string; effectiveUid: string; dataOwner: string | null; user: User };

const Ctx = createContext<State>({ status: "loading" });

export function FirebaseSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    const unsub = onAuthStateChanged(fbAuth(), (u) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (!u) { setState({ status: "no_uid" }); return; }
      // Initial ready with self as effective owner; update as soon as the
      // profile doc reveals a `dataOwner` (agent under another account).
      setState({ status: "ready", uid: u.uid, effectiveUid: u.uid, dataOwner: null, user: u });
      unsubProfile = onSnapshot(doc(fbDb(), "users", u.uid), (snap) => {
        const dataOwner = (snap.exists() ? (snap.data().dataOwner as string | null | undefined) : null) ?? null;
        setState({
          status: "ready",
          uid: u.uid,
          effectiveUid: dataOwner ?? u.uid,
          dataOwner,
          user: u,
        });
      });
    });
    return () => {
      unsub();
      if (unsubProfile) unsubProfile();
    };
  }, []);
  return createElement(Ctx.Provider, { value: state }, children);
}

export function useFirebaseSession(): State {
  return useContext(Ctx);
}

/** Convenience: returns the signed-in user's own uid. */
export function useFirebaseUid(): string | null {
  const s = useFirebaseSession();
  return s.status === "ready" ? s.uid : null;
}

/**
 * Returns the UID whose subcollections this user should READ/WRITE — i.e.
 * `users/{uid}.dataOwner ?? uid`. When the signed-in user is an agent under
 * another account, this points at the owner's UID. Mirrors the Flutter app's
 * `dataOwnerIdProvider` so messages/contacts/templates/campaigns stay shared.
 */
export function useEffectiveUid(): string | null {
  const s = useFirebaseSession();
  return s.status === "ready" ? s.effectiveUid : null;
}