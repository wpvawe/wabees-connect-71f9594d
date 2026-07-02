import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";

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
    if (user) throw redirect({ to: "/dashboard" });
  },
  component: AuthLayoutRoute,
});

function AuthLayoutRoute() {
  return <Outlet />;
}