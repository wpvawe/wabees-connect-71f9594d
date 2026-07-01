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
} from "@fortawesome/free-solid-svg-icons";
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

  const totalOut = data?.outgoing ?? 0;
  const delivery = data && totalOut > 0 ? Math.round((data.delivered / totalOut) * 100) : 0;
  const readRate = data && totalOut > 0 ? Math.round((data.read / totalOut) * 100) : 0;
  const failureRate = data && totalOut > 0 ? Math.round((data.failed / totalOut) * 100) : 0;

  return (
    <>
      <TopBar title="Analytics" subtitle="WhatsApp message insights from Meta" />
      <div className="space-y-5 px-4 py-6 sm:px-6">
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
  icon?: typeof faPaperPlane;
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
