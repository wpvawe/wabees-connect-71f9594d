/**
 * Live SLA badge for a conversation. Ticks every 30s so pending countdowns
 * stay fresh without hammering React.
 */
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faClock,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import {
  evaluateSla,
  formatDuration,
  type SlaSettings,
} from "@/lib/firebase/sla";

export function SlaBadge({
  conv,
  settings,
  compact = false,
}: {
  conv: {
    lastIncomingMessageAt?: string | null;
    firstResponseAt?: string | null;
    firstResponseMs?: number | null;
  };
  settings: SlaSettings | null;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const status = evaluateSla(conv, settings, now);
  if (status.kind === "none") return null;

  const base =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold";

  if (status.kind === "met") {
    return (
      <span
        title={`First response in ${formatDuration(status.ms)}`}
        className={`${base} bg-emerald-500/10 text-emerald-600`}
      >
        <FontAwesomeIcon icon={faCircleCheck} className="h-2.5 w-2.5" />
        {compact ? "SLA" : `SLA ${formatDuration(status.ms)}`}
      </span>
    );
  }

  if (status.kind === "breached") {
    return (
      <span
        title={`Overdue by ${formatDuration(status.overdueMs)}`}
        className={`${base} bg-rose-500/10 text-rose-600`}
      >
        <FontAwesomeIcon icon={faTriangleExclamation} className="h-2.5 w-2.5" />
        {compact
          ? "Breached"
          : `SLA breached +${formatDuration(status.overdueMs)}`}
      </span>
    );
  }

  const soon = status.remainingMs < 5 * 60 * 1000;
  return (
    <span
      title={`${formatDuration(status.remainingMs)} until SLA breach`}
      className={`${base} ${
        soon
          ? "bg-amber-500/10 text-amber-600"
          : "bg-sky-500/10 text-sky-600"
      }`}
    >
      <FontAwesomeIcon icon={faClock} className="h-2.5 w-2.5" />
      {compact ? formatDuration(status.remainingMs) : `SLA in ${formatDuration(status.remainingMs)}`}
    </span>
  );
}