import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { Plan } from "@/hooks/usePlans";
import {
  billingCycleLabel,
  limitLabel,
  pricePeriodSuffix,
  resolvePricing,
} from "@/lib/plans/pricing";

type Row = {
  label: string;
  render: (p: Plan) => React.ReactNode;
};

const ROWS: Row[] = [
  { label: "Price", render: (p) => priceCell(p) },
  { label: "Billing cycle", render: (p) => <span className="capitalize">{billingCycleLabel(p)}</span> },
  { label: "Messages", render: (p) => limitLabel(p.maxMessages) },
  { label: "Contacts", render: (p) => limitLabel(p.maxContacts) },
  { label: "Broadcast campaigns", render: (p) => limitLabel(p.maxCampaigns) },
  { label: "Chatbots", render: (p) => limitLabel(p.maxBots) },
  { label: "Message templates", render: (p) => limitLabel(p.maxTemplates) },
  { label: "AI replies", render: (p) => limitLabel(p.maxAiMessages) },
  { label: "Analytics dashboard", render: (p) => yesNo(p.hasAnalytics) },
  { label: "Priority support", render: (p) => yesNo(p.hasPrioritySupport) },
  { label: "Developer API access", render: (p) => yesNo(p.hasApiAccess) },
];

function priceCell(p: Plan) {
  const priced = resolvePricing(p);
  if (priced.effectivePrice === 0) return <span className="font-semibold text-primary">Free</span>;
  return (
    <span className="font-semibold text-foreground tabular-nums">
      {p.currency} {priced.effectivePrice.toLocaleString()}
      <span className="font-normal text-muted-foreground"> {pricePeriodSuffix(p)}</span>
    </span>
  );
}

function yesNo(v: boolean) {
  return v ? (
    <FontAwesomeIcon icon={faCheck} className="h-3.5 w-3.5 text-primary" aria-label="Included" />
  ) : (
    <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5 text-muted-foreground/50" aria-label="Not included" />
  );
}

/**
 * Side-by-side feature comparison table shown below the plan grid on /plans.
 * Highlights popular + active plan columns. Horizontal-scroll on mobile.
 */
export function PlanCompareTable({
  plans,
  activePlanId,
}: {
  plans: Plan[];
  activePlanId: string | null;
}) {
  if (plans.length < 2) return null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="p-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Compare plans
            </th>
            {plans.map((p) => {
              const active = p.id === activePlanId;
              return (
                <th
                  key={p.id}
                  className={`p-4 text-center align-bottom ${
                    active
                      ? "bg-primary/10"
                      : p.isPopular
                        ? "bg-primary/5"
                        : ""
                  }`}
                >
                  <div className="text-sm font-bold text-foreground">{p.name}</div>
                  {active && (
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Current
                    </div>
                  )}
                  {!active && p.isPopular && (
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Popular
                    </div>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, i) => (
            <tr key={row.label} className={i % 2 ? "bg-muted/30" : ""}>
              <td className="p-4 text-xs font-medium text-muted-foreground">{row.label}</td>
              {plans.map((p) => {
                const active = p.id === activePlanId;
                return (
                  <td
                    key={p.id}
                    className={`p-4 text-center text-sm text-foreground ${
                      active ? "bg-primary/5" : p.isPopular ? "bg-primary/[0.03]" : ""
                    }`}
                  >
                    {row.render(p)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}