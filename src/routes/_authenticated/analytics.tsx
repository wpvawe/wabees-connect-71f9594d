import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faCircleNotch, faPlug } from "@fortawesome/free-solid-svg-icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { useAnalytics } from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Wabees" }] }),
  component: AnalyticsPage,
});

const RANGES: { id: "7d" | "30d" | "month" | "lastMonth"; label: string }[] = [
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "month", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
];

function AnalyticsPage() {
  const [range, setRange] = useState<"7d" | "30d" | "month" | "lastMonth">("7d");
  const { data, loading, error, reload, hasConfig } = useAnalytics(range);

  if (!hasConfig) {
    return (
      <>
        <TopBar title="Analytics" subtitle="WhatsApp message insights" />
        <div className="px-4 py-6 sm:px-6">
          <WbEmpty
            icon={faPlug}
            title="Connect WhatsApp first"
            description="Insights are fetched from Meta for your connected number."
            action={
              <Link to="/connect">
                <WbButton>Connect WhatsApp</WbButton>
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const delivery = data && data.sent > 0 ? Math.round((data.delivered / data.sent) * 100) : 0;
  const readRate = data && data.sent > 0 ? Math.round((data.read / data.sent) * 100) : 0;

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
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Sent" value={data.sent} />
              <Stat label="Delivered" value={data.delivered} />
              <Stat label="Read" value={data.read} />
              <Stat label="Failed" value={data.failed} />
              <Stat label="Delivery rate" value={`${delivery}%`} />
              <Stat label="Read rate" value={`${readRate}%`} />
            </div>

            <WbCard>
              <WbCardBody>
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <FontAwesomeIcon icon={faChartLine} className="h-4 w-4" /> Daily breakdown
                </div>
                <div className="h-72 w-full">
                  <ResponsiveContainer>
                    <BarChart data={data.byDay}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                      <XAxis dataKey="date" fontSize={11} />
                      <YAxis fontSize={11} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="sent" fill="#3b82f6" />
                      <Bar dataKey="delivered" fill="#10b981" />
                      <Bar dataKey="read" fill="#8b5cf6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </WbCardBody>
            </WbCard>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <WbCard>
      <WbCardBody>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      </WbCardBody>
    </WbCard>
  );
}
