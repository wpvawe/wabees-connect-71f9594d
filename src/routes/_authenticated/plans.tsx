import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCircleNotch, faCrown } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { usePlans, type Plan } from "@/hooks/usePlans";
import { useSubscription } from "@/hooks/useSubscription";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({ meta: [{ title: "Plans — Wabees" }] }),
  component: PlansPage,
});

function PlansPage() {
  const { data: plans, error } = usePlans();
  const { data: sub, loading } = useSubscription();
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
                <PlanStat label="Messages" value={`${sub.messagesUsed}/${limitLabel(sub.maxMessages)}`} />
                <PlanStat label="Contacts" value={`${sub.contactsUsed}/${limitLabel(sub.maxContacts)}`} />
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
              <PlanCard key={plan.id} plan={plan} active={sub?.planId === plan.id} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PlanCard({ plan, active }: { plan: Plan; active: boolean }) {
  return (
    <article className={active ? "rounded-xl border border-primary bg-card p-5 shadow-soft" : "rounded-xl border border-border bg-card p-5 shadow-soft"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{plan.description}</p>
        </div>
        {(active || plan.isPopular) && (
          <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-medium text-primary">
            {active ? "Current" : "Popular"}
          </span>
        )}
      </div>
      <p className="mt-4 text-2xl font-semibold text-foreground">
        {plan.priceMonthly === 0 ? "Free" : `${plan.currency} ${plan.priceMonthly}`}
        {plan.priceMonthly > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <PlanStat label="Messages" value={limitLabel(plan.maxMessages)} />
        <PlanStat label="Contacts" value={limitLabel(plan.maxContacts)} />
        <PlanStat label="Campaigns" value={limitLabel(plan.maxCampaigns)} />
        <PlanStat label="Bots" value={limitLabel(plan.maxBots)} />
      </div>
      {plan.features.length > 0 && (
        <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
          {plan.features.slice(0, 6).map((f) => (
            <li key={f} className="flex gap-2">
              <FontAwesomeIcon icon={faCheck} className="mt-0.5 h-3 w-3 text-primary" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.isWelcomePlan && (
        <p className="mt-4 flex items-center gap-2 text-xs font-medium text-primary">
          <FontAwesomeIcon icon={faCrown} className="h-3 w-3" />
          Welcome plan
        </p>
      )}
    </article>
  );
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function limitLabel(value: number): string {
  return value <= 0 ? "Unlimited" : String(value);
}