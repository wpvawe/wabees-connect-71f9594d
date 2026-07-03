import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { usePlans } from "@/hooks/usePlans";
import { useSubscription } from "@/hooks/useSubscription";
import { usePendingSubscription } from "@/hooks/usePendingSubscription";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useProfile } from "@/hooks/useProfile";
import { useContacts } from "@/hooks/useContacts";
import { useSubscriptionMessages } from "@/hooks/useSubscriptionMessages";
import {
  requestSubscription,
  postSubscriptionRequestToSupport,
} from "@/lib/firebase/subscriptions";
import { toast } from "sonner";
import { RequireCapability } from "@/components/auth/RequireCapability";
import { PlanCard, PlanStat } from "@/components/plans/PlanCard";
import { SubscriptionRequestDialog } from "@/components/plans/SubscriptionRequestDialog";
import type { Plan } from "@/hooks/usePlans";
import { limitLabel } from "@/lib/plans/pricing";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({ meta: [{ title: "Plans — Wabees" }] }),
  component: () => (
    <RequireCapability capability="billing.manage">
      <PlansPage />
    </RequireCapability>
  ),
});

function PlansPage() {
  const { data: plans, error } = usePlans();
  const { data: sub, loading } = useSubscription();
  const { data: pending } = usePendingSubscription();
  const { data: profile } = useProfile("effective");
  const { data: contacts } = useContacts();
  const messages = useSubscriptionMessages();
  const uid = useFirebaseUid();
  const [dialogPlan, setDialogPlan] = useState<Plan | null>(null);
  // Subscription counters can lag behind profile totals (PHP webhook updates
  // both, but websites may render before sub doc is touched). Fall back to
  // profile counters when subscription shows 0 so users see real usage.
  const usage = {
    messages: sub?.messagesUsed || profile?.totalMessages || 0,
    contacts:
      sub?.contactsUsed || profile?.totalContacts || (contacts ? contacts.length : 0),
  };
  return (
    <>
      <TopBar title="Plans" subtitle="Your current plan and active packages" />
      <div className="space-y-6 px-4 py-6 sm:px-6">
        <WbCard>
          <WbCardBody>
            {loading ? (
              <div className="flex items-center text-sm text-muted-foreground">
                <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : sub ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <PlanStat label="Current" value={sub.planName || sub.planId || "Active"} />
                <PlanStat label="Status" value={sub.status} />
                <PlanStat
                  label="Messages"
                  value={`${usage.messages}/${limitLabel(sub.maxMessages)}`}
                />
                <PlanStat
                  label="Contacts"
                  value={`${usage.contacts}/${limitLabel(sub.maxContacts)}`}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active subscription found.</p>
            )}
          </WbCardBody>
        </WbCard>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : plans === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                active={sub?.planId === plan.id}
                pendingPlanId={pending?.planId ?? null}
                hasPending={Boolean(pending)}
                onRequest={async () => {
                  if (!uid) return;
                  try {
                    await requestSubscription(uid, plan);
                    await postSubscriptionRequestToSupport(uid, plan, messages, {
                      name: profile?.businessName || "",
                      email: profile?.email || "",
                      phone: profile?.phoneNumber || "",
                    }).catch(() => undefined);
                    toast.success("Request sent — waiting for admin approval");
                    setDialogPlan(plan);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Request failed");
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
      <SubscriptionRequestDialog
        open={dialogPlan !== null}
        onClose={() => setDialogPlan(null)}
        plan={dialogPlan}
        messages={messages}
        user={{
          name: profile?.businessName || "",
          email: profile?.email || "",
          phone: profile?.phoneNumber || "",
        }}
      />
    </>
  );
}
