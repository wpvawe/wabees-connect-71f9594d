import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartLine,
  faCircleNotch,
  faPaperPlane,
  faCheckDouble,
  faCheck,
  faTriangleExclamation,
  faInbox,
  faUsers,
  faFileLines,
  faBullhorn,
  faAddressBook,
  faArrowUp,
  faArrowDown,
  faUserTie,
  faCircle,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useAnalytics, type AnalyticsRange } from "@/hooks/useAnalytics";
import { useTemplates } from "@/hooks/useTemplates";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useContacts } from "@/hooks/useContacts";
import { useAgents } from "@/hooks/useAgents";
import { useConversations } from "@/hooks/useConversations";
import { useCanManageTeam } from "@/hooks/useAgentRole";
import { useCampaignAggregate } from "@/hooks/useCampaignAggregate";
import { useProfile } from "@/hooks/useProfile";
import { useSubscription } from "@/hooks/useSubscription";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Wabees" }] }),
  component: AnalyticsPage,
});

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "month", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
];

const PIE_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const { data, loading, error, reload } = useAnalytics(range);
  const { data: templates } = useTemplates();
  const { data: campaigns } = useCampaigns();
  const { data: contacts } = useContacts();
  const { data: agents } = useAgents();
  const { data: conversations } = useConversations();
  const canSeeAgentPerf = useCanManageTeam();
  const { data: campaignAgg } = useCampaignAggregate();
  const { data: profile } = useProfile("effective");
  const { data: sub } = useSubscription();

  // Build per-agent performance from live conversations + agents.
  // Owner/Supervisor only — scoped agents don't see this section.
  type PerfRow = {
      id: string;
      email: string;
      role: string | null;
      isOnline: boolean;
      lastSeenAt: string | null;
      total: number;
      open: number;
      resolved: number;
      unread: number;
  };
  const { perfRows, unassignedOpen } = (() => {
    if (!canSeeAgentPerf || !agents || !conversations) {
      return { perfRows: [] as PerfRow[], unassignedOpen: 0 };
    }
    const byId = new Map<string, PerfRow>();
    for (const a of agents) {
      if (a.status !== "active") continue;
      byId.set(a.id, {
        id: a.id,
        email: a.email || a.id,
        role: a.role,
        isOnline: a.isOnline,
        lastSeenAt: a.lastSeenAt,
        total: 0,
        open: 0,
        resolved: 0,
        unread: 0,
      });
    }
    let unassigned = 0;
    for (const c of conversations) {
      if (!c.assignedAgentId) {
        if ((c.state ?? "open") !== "resolved") unassigned += 1;
        continue;
      }
      const row = byId.get(c.assignedAgentId);
      if (!row) continue;
      row.total += 1;
      if ((c.state ?? "open") === "resolved") row.resolved += 1;
      else row.open += 1;
      row.unread += c.unreadCount || 0;
    }
    const list = Array.from(byId.values()).sort((a, b) => b.total - a.total);
    return { perfRows: list, unassignedOpen: unassigned };
  })();

  const totalOut = data?.outgoing ?? 0;
  const delivery = data && totalOut > 0 ? Math.round((data.delivered / totalOut) * 100) : 0;
  const readRate = data && totalOut > 0 ? Math.round((data.read / totalOut) * 100) : 0;
  const failureRate = data && totalOut > 0 ? Math.round((data.failed / totalOut) * 100) : 0;

  const approvedTemplates = templates?.filter((t) => t.status?.toUpperCase() === "APPROVED").length ?? 0;
  const pendingTemplates = templates?.filter((t) => t.status?.toUpperCase() === "PENDING").length ?? 0;
  const rejectedTemplates = templates?.filter((t) => t.status?.toUpperCase() === "REJECTED").length ?? 0;

  const activeCampaigns = campaigns?.filter((c) =>
    ["running", "scheduled", "active"].includes((c.status || "").toLowerCase()),
  ).length ?? 0;
  const completedCampaigns = campaigns?.filter((c) => (c.status || "").toLowerCase() === "completed").length ?? 0;
  // Use the loaded campaign rows only; avoid aggregation reads because they
  // can exhaust Firestore quota and interfere with regular message fetching.
  // Prefer the server-side aggregate (accurate across ALL campaigns);
  // fall back to a reduce over the loaded page while it's loading.
  const campaignSent =
    campaignAgg?.sent ??
    (campaigns?.reduce((a, c) => a + (c.sentCount ?? 0), 0) ?? 0);
  const campaignDelivered =
    campaignAgg?.delivered ??
    (campaigns?.reduce((a, c) => a + (c.deliveredCount ?? 0), 0) ?? 0);
  const campaignRead =
    campaignAgg?.read ??
    (campaigns?.reduce((a, c) => a + (c.readCount ?? 0), 0) ?? 0);
  const totalCampaigns =
    campaignAgg?.totalCampaigns ??
    Math.max(sub?.campaignsUsed ?? 0, profile?.totalCampaigns ?? 0, campaigns?.length ?? 0);
  const totalTemplates = Math.max(sub?.templatesUsed ?? 0, templates?.length ?? 0);
  const totalContacts = Math.max(
    profile?.totalContacts ?? 0,
    sub?.contactsUsed ?? 0,
    contacts?.length ?? 0,
  );

  const topCampaigns = (campaigns ?? [])
    .filter((c) => (c.sentCount ?? 0) > 0)
    .sort((a, b) => (b.sentCount ?? 0) - (a.sentCount ?? 0))
    .slice(0, 5);

  return (
    <>
      <TopBar title="Analytics" subtitle="Deep insights across messages, templates & campaigns" />
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Hero header — mirrors Dashboard style */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-soft sm:p-6">
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-primary">Analytics</p>
              <h2 className="mt-1 text-2xl font-semibold text-foreground">Performance overview</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Live message delivery, template health, and campaign performance.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "h-9 rounded-md border px-3 text-sm transition-colors",
                range === r.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
          </div>
        </section>

        {error ? (
          <WbCard>
            <WbCardBody className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <WbButton size="sm" variant="secondary" onClick={reload}>
                Retry
              </WbButton>
            </WbCardBody>
          </WbCard>
        ) : loading || !data ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Sent" value={data.sent} icon={faPaperPlane} tone="blue" />
              <Stat label="Delivered" value={data.delivered} sub={`${delivery}% delivery`} icon={faCheck} tone="emerald" />
              <Stat label="Read" value={data.read} sub={`${readRate}% read rate`} icon={faCheckDouble} tone="violet" />
              <Stat label="Failed" value={data.failed} sub={`${failureRate}% failure`} icon={faTriangleExclamation} tone="red" />
              <Stat label="Incoming" value={data.incoming} icon={faInbox} tone="cyan" />
              <Stat label="Outgoing" value={data.outgoing} icon={faPaperPlane} tone="blue" />
              <Stat label="Unique contacts" value={data.uniqueContacts} icon={faUsers} tone="amber" />
              <Stat label="Pending" value={data.pending} icon={faCircleNotch} tone="slate" />
            </div>

            {/* Templates + Campaigns + Contacts overview */}
            <div className="grid gap-4 lg:grid-cols-3">
              <WbCard>
                <WbCardBody className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="grid h-8 w-8 place-items-center rounded-md bg-emerald-500/10 text-emerald-500">
                        <FontAwesomeIcon icon={faFileLines} className="h-3.5 w-3.5" />
                      </span>
                      Templates
                    </div>
                    <span className="text-2xl font-semibold text-foreground">
                      {totalTemplates}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <MiniStat label="Approved" value={approvedTemplates} tone="emerald" />
                    <MiniStat label="Pending" value={pendingTemplates} tone="amber" />
                    <MiniStat label="Rejected" value={rejectedTemplates} tone="red" />
                  </div>
                </WbCardBody>
              </WbCard>

              <WbCard>
                <WbCardBody className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="grid h-8 w-8 place-items-center rounded-md bg-violet-500/10 text-violet-500">
                        <FontAwesomeIcon icon={faBullhorn} className="h-3.5 w-3.5" />
                      </span>
                      Campaigns
                    </div>
                    <span className="text-2xl font-semibold text-foreground">
                      {totalCampaigns}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <MiniStat label="Active" value={activeCampaigns} tone="blue" />
                    <MiniStat label="Done" value={completedCampaigns} tone="emerald" />
                    <MiniStat label="Sent" value={campaignSent} tone="violet" />
                  </div>
                </WbCardBody>
              </WbCard>

              <WbCard>
                <WbCardBody className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="grid h-8 w-8 place-items-center rounded-md bg-amber-500/10 text-amber-500">
                        <FontAwesomeIcon icon={faAddressBook} className="h-3.5 w-3.5" />
                      </span>
                      Contacts
                    </div>
                    <span className="text-2xl font-semibold text-foreground">
                      {totalContacts}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <MiniStat
                      label="Outgoing"
                      value={data.outgoing}
                      tone="blue"
                      icon={faArrowUp}
                    />
                    <MiniStat
                      label="Incoming"
                      value={data.incoming}
                      tone="cyan"
                      icon={faArrowDown}
                    />
                  </div>
                </WbCardBody>
              </WbCard>
            </div>

            <WbCard>
              <WbCardBody>
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <FontAwesomeIcon icon={faChartLine} className="h-4 w-4" /> Delivery trend
                </div>
                <div className="h-72 w-full">
                  <ResponsiveContainer>
                    <AreaChart data={data.byDay}>
                      <defs>
                        <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gDel" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gRead" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                      <XAxis dataKey="date" fontSize={11} />
                      <YAxis fontSize={11} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Area type="monotone" dataKey="sent" stroke="#3b82f6" fill="url(#gSent)" />
                      <Area type="monotone" dataKey="delivered" stroke="#10b981" fill="url(#gDel)" />
                      <Area type="monotone" dataKey="read" stroke="#8b5cf6" fill="url(#gRead)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </WbCardBody>
            </WbCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <WbCard>
                <WbCardBody>
                  <div className="mb-2 text-sm text-muted-foreground">Incoming vs Failed</div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer>
                      <BarChart data={data.byDay}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                        <XAxis dataKey="date" fontSize={11} />
                        <YAxis fontSize={11} allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="incoming" fill="#06b6d4" />
                        <Bar dataKey="failed" fill="#ef4444" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </WbCardBody>
              </WbCard>

              <WbCard>
                <WbCardBody>
                  <div className="mb-2 text-sm text-muted-foreground">Message types</div>
                  {data.byType.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">No messages in range.</p>
                  ) : (
                    <div className="h-64 w-full">
                      <ResponsiveContainer>
                        <PieChart>
                          <Tooltip />
                          <Legend />
                          <Pie
                            data={data.byType}
                            dataKey="count"
                            nameKey="type"
                            innerRadius={45}
                            outerRadius={85}
                            paddingAngle={2}
                          >
                            {data.byType.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </WbCardBody>
              </WbCard>
            </div>

            {/* Campaign performance summary */}
            {totalCampaigns > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                <WbCard>
                  <WbCardBody>
                    <div className="mb-3 text-sm text-muted-foreground">Campaign performance</div>
                    <div className="grid grid-cols-3 gap-3">
                      <Stat label="Sent" value={campaignSent} icon={faPaperPlane} tone="blue" />
                      <Stat label="Delivered" value={campaignDelivered} icon={faCheck} tone="emerald" />
                      <Stat label="Read" value={campaignRead} icon={faCheckDouble} tone="violet" />
                    </div>
                  </WbCardBody>
                </WbCard>
                <WbCard>
                  <WbCardBody>
                    <div className="mb-3 text-sm text-muted-foreground">Top campaigns</div>
                    {topCampaigns.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No campaigns have been sent yet.
                      </p>
                    ) : (
                      <div className="divide-y divide-border">
                        {topCampaigns.map((c) => (
                          <div key={c.id} className="flex items-center justify-between py-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">{c.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {c.status} · {c.totalRecipients ?? 0} recipients
                              </p>
                            </div>
                            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                              {c.sentCount} sent
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </WbCardBody>
                </WbCard>
              </div>
            )}

            <WbCard>
              <WbCardBody>
                <div className="mb-3 text-sm text-muted-foreground">Top conversations</div>
                {data.topContacts.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No conversations in range.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {data.topContacts.map((c) => (
                      <div key={c.phone} className="flex items-center justify-between py-2 text-sm">
                        <div>
                          <p className="font-medium text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone}</p>
                        </div>
                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                          {c.count} msg
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </WbCardBody>
            </WbCard>

            {canSeeAgentPerf && perfRows.length > 0 && (
              <WbCard>
                <WbCardBody>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FontAwesomeIcon icon={faUserTie} className="h-4 w-4" /> Agent performance
                    </div>
                    {unassignedOpen > 0 && (
                      <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-500">
                        {unassignedOpen} unassigned open
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Agent</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 pr-3 font-medium text-right">Assigned</th>
                          <th className="py-2 pr-3 font-medium text-right">Open</th>
                          <th className="py-2 pr-3 font-medium text-right">Resolved</th>
                          <th className="py-2 pr-3 font-medium text-right">Unread</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {perfRows.map((r) => {
                          const resolveRate = r.total > 0 ? Math.round((r.resolved / r.total) * 100) : 0;
                          return (
                            <tr key={r.id}>
                              <td className="py-2 pr-3">
                                <div className="flex flex-col">
                                  <span className="font-medium text-foreground">{r.email}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {r.role === "supervisor" ? "Supervisor" : "Agent"} · {resolveRate}% resolved
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 pr-3">
                                <span className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
                                  r.isOnline
                                    ? "bg-emerald-500/10 text-emerald-500"
                                    : "bg-muted text-muted-foreground",
                                )}>
                                  <FontAwesomeIcon icon={faCircle} className="h-1.5 w-1.5" />
                                  {r.isOnline ? "Online" : "Offline"}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums text-foreground">{r.total}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-foreground">{r.open}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-foreground">{r.resolved}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-foreground">{r.unread}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </WbCardBody>
              </WbCard>
            )}
          </>
        )}
      </div>
    </>
  );
}

const TONES: Record<string, string> = {
  blue: "text-blue-500 bg-blue-500/10",
  emerald: "text-emerald-500 bg-emerald-500/10",
  violet: "text-violet-500 bg-violet-500/10",
  red: "text-red-500 bg-red-500/10",
  cyan: "text-cyan-500 bg-cyan-500/10",
  amber: "text-amber-500 bg-amber-500/10",
  slate: "text-slate-500 bg-slate-500/10",
};

function Stat({
  label,
  value,
  sub,
  icon,
  tone = "blue",
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon?: IconDefinition;
  tone?: keyof typeof TONES;
}) {
  return (
    <WbCard>
      <WbCardBody>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
            {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          {icon && (
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", TONES[tone])}>
              <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </WbCardBody>
    </WbCard>
  );
}

function MiniStat({
  label,
  value,
  tone = "blue",
  icon,
}: {
  label: string;
  value: number;
  tone?: keyof typeof TONES;
  icon?: IconDefinition;
}) {
  return (
    <div className={cn("rounded-lg px-2 py-2", TONES[tone])}>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-0.5 flex items-center justify-center gap-1 text-lg font-semibold">
        {icon && <FontAwesomeIcon icon={icon} className="h-3 w-3" />}
        {value.toLocaleString()}
      </p>
    </div>
  );
}
