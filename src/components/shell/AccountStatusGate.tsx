import { useNavigate } from "@tanstack/react-router";
import { signOut as fbSignOut } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faHourglassHalf,
  faTriangleExclamation,
  faRightFromBracket,
  faArrowRotateRight,
  faEnvelope,
} from "@fortawesome/free-solid-svg-icons";
import { useProfile } from "@/hooks/useProfile";
import type { ReactNode } from "react";

/**
 * Gate the authenticated shell so users with `status !== "active"` see a
 * premium approval / suspended screen instead of the full app. Owners land
 * here right after signup (status="pending") and unblock only once the
 * platform admin approves them from `/admin`.
 *
 * Admins (role="admin") and agents (role="agent") always bypass — admins
 * need to review users, and agents are activated when their invite is
 * accepted separately.
 */
export function AccountStatusGate({ children }: { children: ReactNode }) {
  const { data, loading } = useProfile("self");
  const navigate = useNavigate();

  if (loading || !data) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <FontAwesomeIcon icon={faCircleNotch} className="h-4 w-4 animate-spin" />
          Loading your account…
        </div>
      </div>
    );
  }

  const status = (data.status || "active").toLowerCase();
  const role = (data.role || "user").toLowerCase();
  if (role === "admin" || role === "agent" || status === "active") {
    return <>{children}</>;
  }

  const suspended = status === "suspended" || status === "blocked";

  const handleSignOut = async () => {
    try {
      await fbSignOut(fbAuth());
    } finally {
      void navigate({ to: "/auth" });
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/5 px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.25),transparent_45%),radial-gradient(circle_at_80%_80%,hsl(var(--primary)/0.18),transparent_50%)]"
      />
      <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card/95 p-8 text-center shadow-2xl backdrop-blur">
        <div
          className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${
            suspended
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-600"
          }`}
        >
          <FontAwesomeIcon
            icon={suspended ? faTriangleExclamation : faHourglassHalf}
            className="h-7 w-7"
          />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
          {suspended ? "Account suspended" : "Waiting for approval"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {suspended
            ? "Your account has been suspended by the platform admin. Please contact support to restore access."
            : "Thanks for signing up! Your account is pending review by the platform owner. You’ll get access as soon as it’s approved."}
        </p>

        <div className="mt-6 rounded-2xl border border-border/60 bg-muted/40 p-4 text-left text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <FontAwesomeIcon icon={faEnvelope} className="h-3.5 w-3.5" />
            Signed in as
          </div>
          <p className="mt-1 truncate">{data.email || "—"}</p>
          {data.businessName && (
            <p className="mt-0.5 truncate">Business: {data.businessName}</p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <FontAwesomeIcon icon={faArrowRotateRight} className="h-3.5 w-3.5" />
            Check again
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-medium text-foreground transition hover:bg-muted"
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}