import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCreditCard, faCircleCheck, faCircleXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { usePendingSubscriptions } from "@/hooks/admin/useAdminData";
import { activatePendingSubscription, rejectPendingSubscription } from "@/lib/admin/mutations";

export function PendingSubsSection() {
  const { data } = usePendingSubscriptions();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, label: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      const res = await fn();
      const planName =
        res && typeof res === "object" && "planName" in res
          ? String((res as { planName: unknown }).planName ?? "")
          : "";
      toast.success(planName ? `${label}: ${planName}` : label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Pending subscriptions"
        subtitle={`${data?.length ?? 0} requests waiting for admin action`}
      />
      <WbCardBody>
        {!data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No pending subscriptions 🎉
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <FontAwesomeIcon icon={faCreditCard} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {p.userName || p.userEmail || p.userId}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.userEmail}
                      {p.userPhone ? ` · ${p.userPhone}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs">
                      <span className="font-semibold text-primary">{p.planName}</span>
                      {p.requestedAt && (
                        <span className="ml-2 text-muted-foreground">
                          · {formatDistanceToNow(new Date(p.requestedAt), { addSuffix: true })}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 sm:shrink-0">
                  <WbButton
                    size="sm"
                    loading={busy === p.id}
                    onClick={() =>
                      void run(p.id, "Activated", () => activatePendingSubscription(p.userId))
                    }
                  >
                    <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3" /> Activate
                  </WbButton>
                  <WbButton
                    size="sm"
                    variant="secondary"
                    loading={busy === p.id}
                    onClick={() => {
                      if (!window.confirm(`Reject ${p.planName} request?`)) return;
                      void run(p.id, "Rejected", () => rejectPendingSubscription(p.userId));
                    }}
                  >
                    <FontAwesomeIcon icon={faCircleXmark} className="h-3 w-3" /> Reject
                  </WbButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </WbCardBody>
    </WbCard>
  );
}