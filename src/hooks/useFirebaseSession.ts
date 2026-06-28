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
import { fbAuth } from "@/integrations/firebase/client";

type State =
  | { status: "loading" }
  | { status: "no_uid" } // signed out — auth gate redirects, but hooks may render once
  | { status: "ready"; uid: string; user: User };

const Ctx = createContext<State>({ status: "loading" });

export function FirebaseSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const unsub = onAuthStateChanged(fbAuth(), (u) => {
      if (u) setState({ status: "ready", uid: u.uid, user: u });
      else setState({ status: "no_uid" });
    });
    return () => unsub();
  }, []);
  return createElement(Ctx.Provider, { value: state }, children);
}

export function useFirebaseSession(): State {
  return useContext(Ctx);
}

/** Convenience: returns uid when signed in, else null. */
export function useFirebaseUid(): string | null {
  const s = useFirebaseSession();
  return s.status === "ready" ? s.uid : null;
}