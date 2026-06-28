import type { ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";

/**
 * Renders children only after the Firebase auth state has been resolved.
 * The `_authenticated` route gate handles redirecting unauthenticated users,
 * so we just show a spinner while auth hydrates.
 */
export function WbFirebaseGate({ children }: { children: ReactNode }) {
  const s = useFirebaseSession();
  if (s.status !== "ready") {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground">
        <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }
  return <>{children}</>;
}