import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCrown,
  faFire,
  faHourglassHalf,
} from "@fortawesome/free-solid-svg-icons";
import type { Plan } from "@/hooks/usePlans";
import { WbButton } from "@/components/wb/WbButton";
import { formatEndsIn, limitLabel, resolvePricing } from "@/lib/plans/pricing";

export function PlanCard({
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
          {priced.effectivePrice === 0 ? "Free" : `${plan.currency} ${priced.effectivePrice}`}
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

export function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}