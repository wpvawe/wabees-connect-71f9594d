import { limitLabel } from "@/lib/plans/pricing";

/**
 * Compact usage progress bar used in the "Current plan" summary on /plans.
 * `max <= 0` = Unlimited (no bar rendered, just the count).
 */
export function UsageBar({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const unlimited = max <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  const warn = pct >= 80 && pct < 100;
  const danger = pct >= 100;
  const barColor = danger
    ? "bg-destructive"
    : warn
      ? "bg-amber-500"
      : "bg-primary";
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xs font-semibold text-foreground tabular-nums">
          {used.toLocaleString()}
          <span className="font-normal text-muted-foreground">
            {" / "}
            {limitLabel(max)}
          </span>
        </p>
      </div>
      {!unlimited && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
          />
        </div>
      )}
      {unlimited && (
        <p className="mt-1 text-[10px] font-medium text-primary">Unlimited</p>
      )}
    </div>
  );
}