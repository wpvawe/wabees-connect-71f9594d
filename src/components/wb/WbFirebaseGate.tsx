import type { ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faTriangleExclamation, faPlug } from "@fortawesome/free-solid-svg-icons";
import { Link } from "@tanstack/react-router";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";

/**
 * Wrap any realtime feature with this gate. Shows loading / connect prompt
 * / config error state, and only renders children once Firebase is ready.
 */
export function WbFirebaseGate({ children }: { children: ReactNode }) {
  const s = useFirebaseSession();
  if (s.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground">
        <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
        Connecting realtime…
      </div>
    );
  }
  if (s.status === "no_uid") {
    return (
      <div className="p-6">
        <WbEmpty
          icon={faPlug}
          title="Connect WhatsApp first"
          description="Realtime inbox needs a linked Firebase account. Connect to start."
          action={<Link to="/connect"><WbButton>Connect WhatsApp</WbButton></Link>}
        />
      </div>
    );
  }
  if (s.status === "not_configured" || s.status === "error") {
    return (
      <div className="p-6">
        <WbEmpty
          icon={faTriangleExclamation}
          title="Realtime unavailable"
          description={s.status === "error" ? s.message : "Firebase web config missing on server."}
        />
      </div>
    );
  }
  return <>{children}</>;
}