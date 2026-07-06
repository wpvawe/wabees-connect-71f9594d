import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { SideRail } from "@/components/shell/SideRail";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { FirebaseSessionProvider } from "@/hooks/useFirebaseSession";
import { useFcm } from "@/hooks/useFcm";
import { useIncomingMessageAlerts } from "@/hooks/useIncomingMessageAlerts";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useAutoTriage } from "@/hooks/useAutoTriage";
import { useCsatCapture } from "@/hooks/useCsatCapture";
import { useUnreadTitle } from "@/hooks/useUnreadTitle";
import { useEffect, useMemo, useState } from "react";
import { installAutoplayUnlocker } from "@/lib/notification-sound";
import { AccountStatusGate } from "@/components/shell/AccountStatusGate";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBullhorn, faXmark } from "@fortawesome/free-solid-svg-icons";

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
      <AccountStatusGate>
        <AuthenticatedShell />
      </AccountStatusGate>
    </FirebaseSessionProvider>
  );
}

function AuthenticatedShell() {
  useFcm();
  useIncomingMessageAlerts();
  useAgentPresence();
  // Mirror the current user's availability preference to their agent doc so
  // the routing picker (round-robin / skills) can skip DND teammates.
  useAgentAvailability();
  // Owner-only AI auto-triage of new inbound messages. No-op unless the
  // signed-in user is the owner and has enabled it in settings.
  useAutoTriage();
  // Owner-only listener that turns inbound CSAT list-replies into ratings.
  useCsatCapture();
  // U1: mirror unread conversation count into the browser tab title so
  // agents notice new messages when the inbox tab is backgrounded.
  // Gate behind /inbox* — otherwise `useConversations()` mounts a
  // 200-doc live listener on every page (dashboard, settings, admin, ...)
  // just to compute one number that nobody sees.
  const onInbox = useRouterState({
    select: (s) => s.location.pathname.startsWith("/inbox"),
  });
  if (onInbox) {
    // Hooks-in-conditional is fine here because pathname is stable per render
    // and unmounts the child hook when the user leaves /inbox.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useUnreadTitle();
  }
  useEffect(() => {
    installAutoplayUnlocker();
  }, []);
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <SideRail />
      <main className="flex min-h-screen min-w-0 flex-1 flex-col pb-14 md:pb-0">
        <AnnouncementBanner />
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}

function AnnouncementBanner() {
  const ann = useAnnouncement();
  const key = useMemo(
    () => (ann ? `${ann.startsAt ?? ""}|${ann.endsAt ?? ""}|${ann.message}` : ""),
    [ann],
  );
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("wabees-dismissed-announcement");
  });
  if (!ann || dismissedKey === key) return null;
  const dismiss = () => {
    setDismissedKey(key);
    window.localStorage.setItem("wabees-dismissed-announcement", key);
  };
  return (
    <div className="flex items-start gap-3 border-b border-primary/20 bg-primary/10 px-4 py-2.5 text-xs text-foreground sm:px-6">
      <FontAwesomeIcon icon={faBullhorn} className="mt-0.5 h-3.5 w-3.5 text-primary" />
      <p className="flex-1 whitespace-pre-wrap">{ann.message}</p>
      <button
        type="button"
        aria-label="Dismiss announcement"
        title="Dismiss"
        onClick={dismiss}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
      >
        <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
      </button>
    </div>
  );
}
