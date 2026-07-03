import type { ReactNode } from "react";
import { useCan, type Capability } from "@/lib/auth/permissions";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";

/**
 * Renders `children` only if the current session has the given capability.
 * Optionally shows a friendly "restricted" card when blocked (`showFallback`).
 */
export function Gated({
  capability,
  children,
  fallback = null,
  showFallback = false,
  reason,
}: {
  capability: Capability;
  children: ReactNode;
  fallback?: ReactNode;
  showFallback?: boolean;
  reason?: string;
}) {
  const can = useCan();
  if (can(capability)) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  if (!showFallback) return null;
  return (
    <WbCard>
      <WbCardBody>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <FontAwesomeIcon icon={faLock} className="h-4 w-4" />
          <span>{reason ?? "This section is only available to the account owner."}</span>
        </div>
      </WbCardBody>
    </WbCard>
  );
}

/** Convenience — owner-only wrapper. */
export function OwnerOnly({ children, ...rest }: { children: ReactNode } & Omit<Parameters<typeof Gated>[0], "capability" | "children">) {
  return (
    <Gated capability="billing.manage" {...rest}>
      {children}
    </Gated>
  );
}