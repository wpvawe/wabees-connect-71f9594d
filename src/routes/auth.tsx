import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { PENDING_INVITE_KEY } from "@/lib/firebase/agent-invites";

function waitForFirebaseUser(): Promise<User | null> {
  const auth = fbAuth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise<User | null>((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u);
    });
  });
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthLayoutRoute,
});

function AuthLayoutRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    void waitForFirebaseUser().then((user) => {
      if (!mounted || !user) return;
      let pending: string | null = null;
      try {
        pending = window.sessionStorage.getItem(PENDING_INVITE_KEY);
      } catch {
        pending = null;
      }
      if (pending) {
        try {
          window.sessionStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          /* ignore */
        }
        navigate({ to: "/join/$code", params: { code: pending } });
      } else {
        navigate({ to: "/dashboard" });
      }
    });
    return () => {
      mounted = false;
    };
  }, [navigate]);

  return <Outlet />;
}