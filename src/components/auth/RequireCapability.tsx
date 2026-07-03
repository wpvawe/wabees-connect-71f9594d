import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAgentRole } from "@/hooks/useAgentRole";
import { can, type Capability } from "@/lib/auth/permissions";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";

/**
 * Route body guard — redirects agents/supervisors away from an owner-only
 * page after the role resolves. Renders a lightweight "restricted" card
 * for the split second before navigation completes.
 *
 * We can't gate this in `beforeLoad` because `dataOwner` resolves from a
 * live Firestore snapshot on the client, not from router context.
 */
export function RequireCapability({
  capability,
  redirectTo = "/dashboard",
  children,
}: {
  capability: Capability;
  redirectTo?: string;
  children: ReactNode;
}) {
  const role = useAgentRole();
  const navigate = useNavigate();
  const allowed = role === null ? null : can(role, capability);

  useEffect(() => {
    if (allowed === false) {
      toast.error("This page is only available to the account owner.");
      navigate({ to: redirectTo, replace: true });
    }
  }, [allowed, navigate, redirectTo]);

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <WbCard>
          <WbCardBody>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <FontAwesomeIcon icon={faLock} className="h-4 w-4" />
              <span>Restricted — redirecting…</span>
            </div>
          </WbCardBody>
        </WbCard>
      </div>
    );
  }
  return <>{children}</>;
}