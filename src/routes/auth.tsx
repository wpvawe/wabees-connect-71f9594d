import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
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
  beforeLoad: async () => {
    const user = await waitForFirebaseUser();
    if (user) {
      // If there's a pending agent invite (captured before sign-in),
      // send the user back to accept it instead of the dashboard.
      let pending: string | null = null;
      try {
        pending = window.sessionStorage.getItem(PENDING_INVITE_KEY);
      } catch {
        pending = null;
      }
      if (pending) {
        throw redirect({ to: "/join/$code", params: { code: pending } });
      }
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AuthLayoutRoute,
});

function AuthLayoutRoute() {
  return <Outlet />;
}