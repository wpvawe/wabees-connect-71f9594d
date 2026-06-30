import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { SideRail } from "@/components/shell/SideRail";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { FirebaseSessionProvider } from "@/hooks/useFirebaseSession";
import { useFcm } from "@/hooks/useFcm";
import { useIncomingMessageAlerts } from "@/hooks/useIncomingMessageAlerts";
import { useEffect } from "react";
import { installAutoplayUnlocker } from "@/lib/notification-sound";

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

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const user = await waitForFirebaseUser();
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: AppShell,
});

function AppShell() {
  return (
    <FirebaseSessionProvider>
      <AuthenticatedShell />
    </FirebaseSessionProvider>
  );
}

function AuthenticatedShell() {
  useFcm();
  useIncomingMessageAlerts();
  useEffect(() => {
    installAutoplayUnlocker();
  }, []);
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <SideRail />
      <main className="flex min-h-screen min-w-0 flex-1 flex-col pb-14 md:pb-0">
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}
