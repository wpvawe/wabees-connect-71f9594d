import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCrown,
  faFire,
  faHourglassHalf,
  faBolt,
  faStar,
} from "@fortawesome/free-solid-svg-icons";
import type { Plan } from "@/hooks/usePlans";
import { WbButton } from "@/components/wb/WbButton";
import {
  billingCycleLabel,
  formatEndsIn,
  limitLabel,
  perCycleSuffix,
  pricePeriodSuffix,
  resolvePricing,
} from "@/lib/plans/pricing";

function validityLabel(plan: import("@/hooks/usePlans").Plan): string {
  const t = (plan.expiryType || "").toLowerCase();
  if (t === "lifetime") return "Lifetime access — never expires";
  if (t === "monthly") return "Valid for 30 days";
  if (t === "quarterly") return "Valid for 90 days";
  if (t === "yearly") return "Valid for 365 days";
  if (plan.expiryDays > 0) return `Valid for ${plan.expiryDays} days`;
  return "";
}

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
  const shellClass = active
    ? "border-primary ring-2 ring-primary/30"
    : isPendingThis
      ? "border-amber-500 ring-2 ring-amber-500/25"
      : plan.isPopular
        ? "border-primary/60 ring-1 ring-primary/25 shadow-lg shadow-primary/5"
        : priced.offerActive
          ? "border-primary/40 ring-1 ring-primary/15"
          : "border-border";
  const featureList = plan.features.length > 0 ? plan.features : deriveFeatures(plan);
  return (
    <article
      aria-current={active ? "true" : undefined}
      className={`relative flex h-full flex-col rounded-2xl border bg-card p-5 shadow-soft transition-transform hover:-translate-y-0.5 ${shellClass}`}
    >
      {plan.isPopular && !active && !isPendingThis && (
        <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-gradient-to-r from-primary to-primary/80 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-md">
          <FontAwesomeIcon icon={faStar} className="h-2.5 w-2.5" />
          Most Popular
        </div>
      )}
      {priced.offerActive && plan.offer && (
        <div className="absolute -top-2 right-4 flex items-center gap-1 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-soft">
          <FontAwesomeIcon icon={faFire} className="h-2.5 w-2.5" />
          {plan.offer.label}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold tracking-tight text-foreground">{plan.name}</h3>
          {plan.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{plan.description}</p>
          )}
        </div>
        {isPendingThis ? (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Pending
          </span>
        ) : active ? (
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
            Current
          </span>
        ) : null}
      </div>
      <div className="mt-5">
        {priced.effectivePrice === 0 ? (
          <p className="text-4xl font-black tracking-tight text-foreground">
            Free
            <span className="ml-1 align-top text-sm font-normal text-muted-foreground">
              {plan.expiryType === "lifetime" ? "forever" : billingCycleLabel(plan)}
            </span>
          </p>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="translate-y-[-0.4em] text-sm font-semibold text-muted-foreground">
              {plan.currency}
            </span>
            <span className="text-4xl font-black tracking-tight text-foreground tabular-nums">
              {priced.effectivePrice.toLocaleString()}
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {pricePeriodSuffix(plan)}
            </span>
          </div>
        )}
        {priced.effectivePrice > 0 && plan.expiryType !== "monthly" && (
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Billed {billingCycleLabel(plan)}
          </p>
        )}
        {priced.offerActive && priced.effectivePrice < plan.priceMonthly && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-muted-foreground line-through tabular-nums">
              {plan.currency} {plan.priceMonthly.toLocaleString()}
            </span>
            {priced.discountPct != null && (
              <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                SAVE {priced.discountPct}%
              </span>
            )}
          </div>
        )}
      </div>
      {priced.offerActive && plan.offer?.endsAt && (
        <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-orange-600 dark:text-orange-400">
          <FontAwesomeIcon icon={faHourglassHalf} className="h-3 w-3" />
          {formatEndsIn(plan.offer.endsAt)}
        </p>
      )}
      <p className="mt-3 rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
        {validityLabel(plan)}
      </p>
      {plan.expiryType !== "yearly" &&
        plan.expiryType !== "lifetime" &&
        plan.priceYearly != null &&
        plan.priceYearly > 0 &&
        plan.priceMonthly > 0 && (
          <p className="mt-2 rounded-md bg-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-primary">
            Save {Math.max(
              0,
              Math.round(
                ((plan.priceMonthly * 12 - plan.priceYearly) / (plan.priceMonthly * 12)) * 100,
              ),
            )}
            % with yearly billing — {plan.currency} {plan.priceYearly.toLocaleString()}/year
          </p>
        )}
      <div className="mt-5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <PlanStat label="Messages" value={limitLabel(plan.maxMessages)} />
        <PlanStat label="Contacts" value={limitLabel(plan.maxContacts)} />
        <PlanStat label="Campaigns" value={limitLabel(plan.maxCampaigns)} />
        <PlanStat label="Bots" value={limitLabel(plan.maxBots)} />
        <PlanStat label="Templates" value={limitLabel(plan.maxTemplates)} />
        <PlanStat label="AI replies" value={limitLabel(plan.maxAiMessages)} />
        <PlanStat label="Agents" value={limitLabel(plan.maxAgents)} />
      </div>
      <ul className="mt-5 flex-1 space-y-2 text-xs text-muted-foreground">
        {featureList.slice(0, 7).map((f) => (
          <li key={f} className="flex gap-2">
            <FontAwesomeIcon icon={faCheck} className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {plan.isWelcomePlan && (
        <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-primary">
          <FontAwesomeIcon icon={faCrown} className="h-3 w-3" />
          Welcome plan
        </p>
      )}
      {!plan.isWelcomePlan && plan.hasPrioritySupport && (
        <p className="mt-4 flex items-center gap-2 text-[11px] font-medium text-primary">
          <FontAwesomeIcon icon={faBolt} className="h-3 w-3" />
          Priority support included
        </p>
      )}
      <WbButton
        className="mt-5 w-full"
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
              : priced.effectivePrice === 0
                ? "Get started free"
                : "Request subscription"}
      </WbButton>
    </article>
  );
}

function deriveFeatures(plan: Plan): string[] {
  // Fallback when admin hasn't set features[] — auto-generate from limits.
  const out: string[] = [];
  const per = perCycleSuffix(plan);
  out.push(`${limitLabel(plan.maxMessages)} messages ${per}`.trim());
  out.push(`${limitLabel(plan.maxContacts)} contacts`);
  out.push(`${limitLabel(plan.maxCampaigns)} broadcast campaigns ${per}`.trim());
  if (plan.maxBots > 0) out.push(`${limitLabel(plan.maxBots)} chatbots`);
  if (plan.maxTemplates > 0) out.push(`${limitLabel(plan.maxTemplates)} message templates`);
  if (plan.maxAiMessages > 0)
    out.push(`${limitLabel(plan.maxAiMessages)} AI replies ${per}`.trim());
  if (plan.maxAgents > 0) out.push(`${limitLabel(plan.maxAgents)} team members`);
  if (plan.hasAnalytics) out.push("Analytics dashboard");
  if (plan.hasPrioritySupport) out.push("Priority support");
  if (plan.hasApiAccess) out.push("Developer API access");
  return out;
}

export function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
