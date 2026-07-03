import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCircleNotch,
  faCrown,
  faFire,
  faHourglassHalf,
} from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { usePlans, type Plan, type PlanOffer } from "@/hooks/usePlans";
import { useSubscription } from "@/hooks/useSubscription";
import { usePendingSubscription } from "@/hooks/usePendingSubscription";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useProfile } from "@/hooks/useProfile";
import { useContacts } from "@/hooks/useContacts";
import { requestSubscription } from "@/lib/firebase/subscriptions";
import { WbButton } from "@/components/wb/WbButton";
import { toast } from "sonner";
import { RequireCapability } from "@/components/auth/RequireCapability";

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
  const uid = useFirebaseUid();
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
                    toast.success("Request sent — waiting for admin approval");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Request failed");
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PlanCard({
  plan,
  active,
  pendingPlanId,
  hasPending,
  onRequest,
}: {
  plan: Plan;
  active: boolean;
  pendingPlanId: string | null;
  hasPending: boolean;
  onRequest: () => Promise<void>;
}) {
  const isPendingThis = pendingPlanId === plan.id;
  const disableOther = hasPending && !isPendingThis && !active;
  const priced = resolvePricing(plan);
  return (
    <article
      className={
        active
          ? "rounded-xl border border-primary bg-card p-5 shadow-soft"
          : isPendingThis
            ? "rounded-xl border border-amber-500 bg-card p-5 shadow-soft"
            : priced.offerActive
              ? "relative rounded-xl border border-primary/60 bg-card p-5 shadow-soft ring-1 ring-primary/20"
              : "rounded-xl border border-border bg-card p-5 shadow-soft"
      }
    >
      {priced.offerActive && plan.offer && (
        <div className="absolute -top-2 left-4 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow-soft">
          <FontAwesomeIcon icon={faFire} className="h-2.5 w-2.5" />
          {plan.offer.label}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{plan.description}</p>
        </div>
        {isPendingThis ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Pending
          </span>
        ) : active ? (
          <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-medium text-primary">
            Current
          </span>
        ) : plan.isPopular ? (
          <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-medium text-primary">
            Popular
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <p className="text-2xl font-semibold text-foreground">
          {priced.effectivePrice === 0
            ? "Free"
            : `${plan.currency} ${priced.effectivePrice}`}
          {priced.effectivePrice > 0 && (
            <span className="text-sm font-normal text-muted-foreground">/mo</span>
          )}
        </p>
        {priced.offerActive && priced.effectivePrice < plan.priceMonthly && (
          <span className="text-sm font-normal text-muted-foreground line-through">
            {plan.currency} {plan.priceMonthly}
          </span>
        )}
        {priced.offerActive && priced.discountPct != null && (
          <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            -{priced.discountPct}%
          </span>
        )}
      </div>
      {priced.offerActive && plan.offer?.endsAt && (
        <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
          <FontAwesomeIcon icon={faHourglassHalf} className="h-3 w-3" />
          {formatEndsIn(plan.offer.endsAt)}
        </p>
      )}
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
      <WbButton
        className="mt-4 w-full"
        variant={active || isPendingThis ? "secondary" : "primary"}
        disabled={active || isPendingThis || disableOther}
        onClick={() => void onRequest()}
      >
        {active
          ? "Current plan"
          : isPendingThis
            ? "Pending approval"
            : disableOther
              ? "Another request pending"
              : "Request subscription"}
      </WbButton>
    </article>
  );
}

function resolvePricing(plan: Plan): {
  effectivePrice: number;
  offerActive: boolean;
  discountPct: number | null;
} {
  const offer = plan.offer;
  if (!offer || !offer.active || !isOfferLive(offer)) {
    return { effectivePrice: plan.priceMonthly, offerActive: false, discountPct: null };
  }
  let price = plan.priceMonthly;
  if (offer.priceOverride != null && offer.priceOverride >= 0) {
    price = offer.priceOverride;
  } else if (offer.discountPct != null && offer.discountPct > 0) {
    price = Math.max(0, Math.round(plan.priceMonthly * (1 - offer.discountPct / 100)));
  }
  return { effectivePrice: price, offerActive: true, discountPct: offer.discountPct };
}

function isOfferLive(offer: PlanOffer): boolean {
  if (!offer.endsAt) return true;
  const ends = new Date(offer.endsAt).getTime();
  return Number.isFinite(ends) && ends > Date.now();
}

function formatEndsIn(iso: string): string {
  const ends = new Date(iso).getTime();
  if (!Number.isFinite(ends)) return "";
  const diffMs = ends - Date.now();
  if (diffMs <= 0) return "Offer ended";
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 2) return `Ends in ${days} days`;
  if (days === 1) return "Ends tomorrow";
  const hours = Math.max(1, Math.floor(diffMs / 3_600_000));
  return `Ends in ${hours}h`;
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
