/**
 * Owner-only Workload Dashboard.
 *
 * Aggregates open conversations by assigned agent to answer the classic
 * supervisor questions: who's loaded, who's idle, whose queue is breaching
 * SLA, and how fast is each agent replying. All math runs client-side over
 * the live conversation snapshot (no extra reads / no server function) so
 * numbers update in realtime as agents work.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUsers,
  faInbox,
  faTriangleExclamation,
  faGauge,
  faCircleUser,
  faCircle,
  faUserSlash,
  faStar,
  faSmile,
} from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { useAgents } from "@/hooks/useAgents";
import { useConversations } from "@/hooks/useConversations";
import { useSlaSettings } from "@/hooks/useSlaSettings";
import { useCsatSurveys } from "@/hooks/useCsatSurveys";
import { useCan } from "@/lib/auth/permissions";
import { evaluateSla, formatDuration } from "@/lib/firebase/sla";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/workload")({
  head: () => ({
    meta: [
      { title: "Workload — Wabees" },
      {
        name: "description",
        content: "Live team workload, SLA breaches, and response-time analytics.",
      },
    ],
  }),
  component: WorkloadPage,
});

type Row = {
  key: string;
  label: string;
  email: string;
  isOnline: boolean;
  availability: "available" | "away" | "dnd" | "offline";
  isOwner: boolean;
  isUnassigned: boolean;
  open: number;
  pending: number;
  snoozed: number;
  breached: number;
  pendingSla: number;
  avgResponseMs: number | null;
  medianResponseMs: number | null;
  respondedCount: number;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function WorkloadPage() {
  const isAllowed = useCan()("team.manage");
  const { data: convs } = useConversations();
  const { data: agents } = useAgents();
  const sla = useSlaSettings();
  const { stats: csat } = useCsatSurveys(200);

  const rows = useMemo<Row[]>(() => {
    if (!convs || !agents) return [];
    const now = Date.now();
    const byKey = new Map<string, Row>();

    const ensure = (key: string, seed: Partial<Row>): Row => {
      const existing = byKey.get(key);
      if (existing) return existing;
      const row: Row = {
        key,
        label: seed.label ?? "Unknown",
        email: seed.email ?? "",
        isOnline: seed.isOnline ?? false,
        availability: seed.availability ?? "offline",
        isOwner: seed.isOwner ?? false,
        isUnassigned: seed.isUnassigned ?? false,
        open: 0,
        pending: 0,
        snoozed: 0,
        breached: 0,
        pendingSla: 0,
        avgResponseMs: null,
        medianResponseMs: null,
        respondedCount: 0,
      };
      byKey.set(key, row);
      return row;
    };

    // Seed a row per agent so idle agents still appear.
    for (const a of agents) {
      if (a.status !== "active") continue;
      ensure(a.id, {
        label: a.email || a.id.slice(0, 6),
        email: a.email,
        isOnline: a.isOnline,
        availability: a.isOnline ? a.availability : "offline",
      });
    }
    ensure("__unassigned__", { label: "Unassigned", isUnassigned: true });

    // Response-time samples per agent (from closed SLA cycles).
    const samples = new Map<string, number[]>();

    for (const c of convs) {
      if (c.isDeleted) continue;
      const state = c.state ?? "open";
      const assignee = c.assignedAgentId || "__unassigned__";
      const row = ensure(assignee, {
        label: c.assignedAgentEmail || (assignee === "__unassigned__" ? "Unassigned" : assignee.slice(0, 6)),
        email: c.assignedAgentEmail ?? "",
        isUnassigned: assignee === "__unassigned__",
      });

      if (state === "resolved") {
        // Resolved threads don't add live load — but their response times
        // are still useful signal.
      } else if (state === "snoozed") {
        row.snoozed += 1;
      } else if (state === "pending") {
        row.pending += 1;
        row.open += 1;
      } else {
        row.open += 1;
      }

      // Response-time telemetry (only when we have a completed cycle).
      if (typeof c.firstResponseMs === "number" && c.firstResponseMs >= 0) {
        const arr = samples.get(assignee) ?? [];
        arr.push(c.firstResponseMs);
        samples.set(assignee, arr);
      }

      // SLA state on currently-open conversations.
      if (state !== "resolved" && state !== "snoozed") {
        const s = evaluateSla(c, sla, now);
        if (s.kind === "breached") row.breached += 1;
        else if (s.kind === "pending") row.pendingSla += 1;
      }
    }

    for (const [key, arr] of samples) {
      const row = byKey.get(key);
      if (!row) continue;
      row.respondedCount = arr.length;
      row.avgResponseMs = arr.reduce((a, b) => a + b, 0) / arr.length;
      row.medianResponseMs = median(arr);
    }

    return Array.from(byKey.values()).sort((a, b) => {
      // Unassigned first if it has anything, then by breaches, then by load.
      if (a.isUnassigned !== b.isUnassigned) {
        if (a.isUnassigned) return a.open + a.breached > 0 ? -1 : 1;
        return b.open + b.breached > 0 ? 1 : -1;
      }
      if (b.breached !== a.breached) return b.breached - a.breached;
      if (b.open !== a.open) return b.open - a.open;
      return a.label.localeCompare(b.label);
    });
  }, [convs, agents, sla]);

  const totals = useMemo(() => {
    const t = { open: 0, unassigned: 0, breached: 0, pending: 0 };
    for (const r of rows) {
      t.open += r.open;
      t.breached += r.breached;
      t.pending += r.pendingSla;
      if (r.isUnassigned) t.unassigned += r.open;
    }
    return t;
  }, [rows]);

  if (!isAllowed) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Workload" subtitle="Owner only" />
        <div className="mx-auto max-w-3xl px-4 py-16">
          <WbEmpty
            icon={faUserSlash}
            title="Owner only"
            description="The workload dashboard is available to workspace owners."
          />
        </div>
      </div>
    );
  }

  const loading = !convs || !agents;

  return (
    <div className="min-h-screen bg-background">
      <TopBar title="Workload" subtitle="Team load & SLA" />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Team Workload</h1>
          <p className="text-sm text-muted-foreground">
            Live view of open conversations, SLA breaches, and per-agent response time.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile icon={faInbox} label="Open" value={totals.open} tone="default" />
          <SummaryTile
            icon={faUserSlash}
            label="Unassigned"
            value={totals.unassigned}
            tone={totals.unassigned > 0 ? "warn" : "default"}
          />
          <SummaryTile
            icon={faTriangleExclamation}
            label="SLA breached"
            value={totals.breached}
            tone={totals.breached > 0 ? "danger" : "default"}
          />
          <SummaryTile icon={faGauge} label="SLA pending" value={totals.pending} tone="default" />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CsatTile
            icon={faStar}
            label="Avg CSAT"
            value={csat.averageRating != null ? csat.averageRating.toFixed(2) : "—"}
            hint={csat.responded > 0 ? `${csat.responded} ratings` : "No ratings yet"}
          />
          <CsatTile
            icon={faSmile}
            label="CSAT score"
            value={csat.csatPct != null ? `${Math.round(csat.csatPct)}%` : "—"}
            hint="% rating 4★+"
            tone={csat.csatPct != null && csat.csatPct >= 70 ? "good" : csat.csatPct != null ? "bad" : "default"}
          />
          <CsatTile
            icon={faInbox}
            label="Surveys sent"
            value={String(csat.sent)}
            hint={`${csat.responded} responded`}
          />
          <CsatTile
            icon={faGauge}
            label="Response rate"
            value={csat.sent > 0 ? `${Math.round(csat.responseRate * 100)}%` : "—"}
            hint="Ratings / sent"
          />
        </div>

        <WbCard>
          <WbCardHeader
            title="Per-agent breakdown"
            subtitle={
              sla.firstResponseMinutes
                ? `First-response SLA target: ${sla.firstResponseMinutes}m`
                : "SLA target not configured — set one in Settings to enable breach tracking."
            }
          />
          <WbCardBody>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : rows.length === 0 ? (
              <WbEmpty
                icon={faUsers}
                title="No data yet"
                description="Once agents start handling conversations, their workload appears here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Agent</th>
                      <th className="px-3 py-2 text-right font-medium">Open</th>
                      <th className="px-3 py-2 text-right font-medium">Pending</th>
                      <th className="px-3 py-2 text-right font-medium">Snoozed</th>
                      <th className="px-3 py-2 text-right font-medium">SLA pending</th>
                      <th className="px-3 py-2 text-right font-medium">Breached</th>
                      <th className="px-3 py-2 text-right font-medium">Avg reply</th>
                      <th className="px-3 py-2 text-right font-medium">Median reply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.key}
                        className={cn(
                          "border-b border-border/60 last:border-0 hover:bg-muted/40",
                          r.isUnassigned && "bg-amber-50/40 dark:bg-amber-500/5",
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="relative">
                              <FontAwesomeIcon
                                icon={r.isUnassigned ? faUserSlash : faCircleUser}
                                className={cn(
                                  "h-6 w-6",
                                  r.isUnassigned ? "text-amber-500" : "text-muted-foreground",
                                )}
                              />
                              {!r.isUnassigned && (
                                <FontAwesomeIcon
                                  icon={faCircle}
                                  className={cn(
                                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background",
                                    r.availability === "available" && r.isOnline
                                      ? "text-emerald-500"
                                      : r.availability === "away"
                                        ? "text-amber-500"
                                        : r.availability === "dnd"
                                          ? "text-red-500"
                                          : "text-slate-400",
                                  )}
                                />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{r.label}</div>
                              {!r.isUnassigned && r.email && r.email !== r.label && (
                                <div className="truncate text-xs text-muted-foreground">{r.email}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.open}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {r.pending}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {r.snoozed}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {r.pendingSla}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right font-mono tabular-nums",
                            r.breached > 0 && "font-semibold text-red-600 dark:text-red-400",
                          )}
                        >
                          {r.breached}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {r.avgResponseMs != null ? formatDuration(r.avgResponseMs) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {r.medianResponseMs != null ? formatDuration(r.medianResponseMs) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </WbCardBody>
        </WbCard>
      </div>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: typeof faInbox;
  label: string;
  value: number;
  tone: "default" | "warn" | "danger";
}) {
  const toneClasses =
    tone === "danger"
      ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        : "border-border bg-card text-foreground";
  return (
    <div className={cn("rounded-xl border p-4 shadow-soft", toneClasses)}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80">
        <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CsatTile({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof faStar;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad";
}) {
  const toneClasses =
    tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
      : tone === "bad"
        ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
        : "border-border bg-card text-foreground";
  return (
    <div className={cn("rounded-xl border p-4 shadow-soft", toneClasses)}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80">
        <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs opacity-70">{hint}</div>}
    </div>
  );
}