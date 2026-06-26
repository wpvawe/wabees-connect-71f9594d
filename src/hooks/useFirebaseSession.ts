/**
 * Bootstraps a Firebase Web SDK session for the signed-in Supabase user.
 * Idempotent: safe to call from multiple components (singleton init).
 */
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { initFirebase, getFb } from "@/integrations/firebase/client";
import { getFirebaseSession } from "@/lib/firebase/session.functions";

type State =
  | { status: "loading" }
  | { status: "no_uid" }
  | { status: "not_configured" }
  | { status: "error"; message: string }
  | { status: "ready"; uid: string };

const Ctx = createContext<State>({ status: "loading" });

export function FirebaseSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const fn = useServerFn(getFirebaseSession);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fn({ data: undefined });
        if (cancelled) return;
        if (!res.ready) {
          setState(
            res.reason === "no_firebase_uid"
              ? { status: "no_uid" }
              : { status: "not_configured" },
          );
          return;
        }
        initFirebase(res.config);
        const { auth } = getFb();
        await signInWithCustomToken(auth, res.token);
        // Confirm via onAuthStateChanged (fires once immediately).
        const unsub = onAuthStateChanged(auth, (u) => {
          if (u) setState({ status: "ready", uid: u.uid });
          unsub();
        });
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Firebase sign-in failed";
          setState({ status: "error", message: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fn]);

  return createElement(Ctx.Provider, { value: state }, children);
}

export function useFirebaseSession(): State {
  return useContext(Ctx);
}

/** Convenience: returns uid when ready, else null. */
export function useFirebaseUid(): string | null {
  const s = useFirebaseSession();
  return s.status === "ready" ? s.uid : null;
}