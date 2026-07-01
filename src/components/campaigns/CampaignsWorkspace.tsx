import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBullhorn,
  faCircleNotch,
  faPlus,
  faMagnifyingGlass,
  faPlay,
  faPause,
  faStop,
  faTrash,
  faClone,
  faRotate,
  faPaperPlane,
  faCheckDouble,
  faTriangleExclamation,
  faUsers,
  faClock,
  faChartLine,
  faEye,
} from "@fortawesome/free-solid-svg-icons";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useCampaignLogs } from "@/hooks/useCampaignLogs";
import {
  runCampaign,
  deleteCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  restartCampaign,
  duplicateCampaign,
} from "@/lib/firebase/campaigns";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { WbButton } from "@/components/wb/WbButton";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "draft" | "running" | "paused" | "completed" | "failed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "running", label: "Running" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  completed: "bg-primary/15 text-primary",
  failed: "bg-destructive/15 text-destructive",
  scheduled: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

export function CampaignsWorkspace() {
  const { data, error } = useCampaigns();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((c) => {
      if (filter !== "all" && c.status !== filter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.messageBody.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
  }, [data, filter, search]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, active: 0, sent: 0, delivered: 0, failed: 0 };
    return data.reduce(
      (acc, c) => ({
        total: acc.total + 1,
        active: acc.active + (c.status === "running" || c.status === "paused" ? 1 : 0),
        sent: acc.sent + c.sentCount,
        delivered: acc.delivered + c.deliveredCount,
        failed: acc.failed + c.failedCount,
      }),
      { total: 0, active: 0, sent: 0, delivered: 0, failed: 0 },
    );
  }, [data]);

  const selected = useMemo(
    () => (data && selectedId ? (data.find((c) => c.id === selectedId) ?? null) : null),
    [data, selectedId],
  );

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Kpi icon={faBullhorn} label="Campaigns" value={stats.total} tone="primary" />
        <Kpi icon={faChartLine} label="Active" value={stats.active} tone="success" />
        <Kpi icon={faPaperPlane} label="Messages sent" value={stats.sent} />
        <Kpi icon={faTriangleExclamation} label="Failed" value={stats.failed} tone="danger" />
      </div>

      {/* Filter + search bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-card p-1">
          {FILTERS.map((f) => {
            const count =
              f.key === "all"
                ? (data?.length ?? 0)
                : (data?.filter((c) => c.status === f.key).length ?? 0);
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px]",
                    filter === f.key ? "bg-primary-foreground/20" : "bg-muted",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Two-column workspace */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        {/* LEFT — list */}
        <div className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">
              {filtered.length} campaign{filtered.length === 1 ? "" : "s"}
            </p>
            <Link to="/campaigns/new">
              <WbButton size="sm">
                <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                New
              </WbButton>
            </Link>
          </div>
          {data === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <WbEmpty
                icon={faBullhorn}
                title="No campaigns found"
                description="Create your first broadcast to reach many contacts at once."
                action={
                  <Link to="/campaigns/new">
                    <WbButton size="sm">
                      <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                      New campaign
                    </WbButton>
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-border/60 overflow-y-auto">
              {filtered.map((c) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  active={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* RIGHT — detail */}
        <div className="rounded-2xl border border-border bg-card">
          {selected ? (
            <CampaignDetailPanel campaign={selected} onDeleted={() => setSelectedId(null)} />
          ) : (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-8 text-center text-muted-foreground">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <FontAwesomeIcon icon={faBullhorn} className="h-6 w-6" />
              </div>
              <h4 className="mt-4 text-base font-semibold text-foreground">
                Select a campaign
              </h4>
              <p className="mt-1 max-w-xs text-sm">
                Choose a campaign from the list to view analytics, message preview, and send logs.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- LIST ROW ------------------------------- */

function CampaignRow({
  campaign,
  active,
  onSelect,
}: {
  campaign: Campaign;
  active: boolean;
  onSelect: () => void;
}) {
  const total = campaign.totalRecipients || 1;
  const done = campaign.sentCount + campaign.failedCount;
  const pct = Math.min(100, Math.round((done / total) * 100));
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40",
          active && "bg-primary/5",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{campaign.name}</p>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {campaign.messageBody || "No message"}
            </p>
          </div>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FontAwesomeIcon icon={faUsers} className="h-3 w-3" />
            {campaign.totalRecipients}
          </span>
          <span className="inline-flex items-center gap-1">
            <FontAwesomeIcon icon={faPaperPlane} className="h-3 w-3" />
            {campaign.sentCount}
          </span>
          {campaign.failedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
              {campaign.failedCount}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <FontAwesomeIcon icon={faClock} className="h-3 w-3" />
            {campaign.createdAt ? formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true }) : "—"}
          </span>
        </div>
        {campaign.status !== "draft" && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                campaign.status === "failed" ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </button>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

/* ------------------------------- DETAIL ------------------------------- */

function CampaignDetailPanel({
  campaign,
  onDeleted,
}: {
  campaign: Campaign;
  onDeleted: () => void;
}) {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const navigate = useNavigate();
  const { data: logs } = useCampaignLogs(campaign.id);
  const [busy, setBusy] = useState<null | string>(null);

  const total = campaign.totalRecipients || 1;
  const done = campaign.sentCount + campaign.failedCount;
  const pct = Math.min(100, Math.round((done / total) * 100));
  const deliveryRate =
    campaign.sentCount > 0 ? Math.round((campaign.deliveredCount / campaign.sentCount) * 100) : 0;
  const readRate =
    campaign.deliveredCount > 0
      ? Math.round((campaign.readCount / campaign.deliveredCount) * 100)
      : 0;

  async function withBusy<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${key} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!uid || !selfUid) return;
    if (!confirm(`Send to ${campaign.totalRecipients} recipients?`)) return;
    await withBusy("start", async () => {
      const r = await runCampaign(
        uid,
        selfUid,
        campaign.id,
        campaign.audiencePhones ?? [],
        campaign.messageBody,
      );
      toast.success(`Sent ${r.sent}, failed ${r.failed}`);
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-5 py-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge status={campaign.status} />
              <span className="text-[11px] text-muted-foreground">
                Created{" "}
                {campaign.createdAt
                  ? format(new Date(campaign.createdAt), "MMM d, yyyy 'at' p")
                  : "—"}
              </span>
            </div>
            <h3 className="mt-1.5 truncate text-lg font-semibold text-foreground">
              {campaign.name}
            </h3>
            {campaign.description && (
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                {campaign.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <IconBtn
              icon={faEye}
              label="Open"
              onClick={() => navigate({ to: "/campaigns/$id", params: { id: campaign.id } })}
            />
            <IconBtn
              icon={faClone}
              label="Duplicate"
              loading={busy === "dup"}
              onClick={() =>
                withBusy("dup", async () => {
                  if (!uid) return;
                  const r = await duplicateCampaign(uid, campaign.id);
                  toast.success("Duplicated");
                  navigate({ to: "/campaigns/$id", params: { id: r.id } });
                })
              }
            />
            <IconBtn
              icon={faTrash}
              label="Delete"
              tone="danger"
              loading={busy === "del"}
              onClick={() =>
                withBusy("del", async () => {
                  if (!uid) return;
                  if (!confirm("Delete this campaign?")) return;
                  await deleteCampaign(uid, campaign.id);
                  toast.success("Deleted");
                  onDeleted();
                })
              }
            />
          </div>
        </div>

        {/* Action bar */}
        <div className="mt-4 flex flex-wrap gap-2">
          {campaign.status === "draft" && (
            <WbButton size="sm" onClick={() => void start()} loading={busy === "start"}>
              <FontAwesomeIcon icon={faPlay} className="h-3 w-3" />
              Start sending
            </WbButton>
          )}
          {campaign.status === "running" && (
            <>
              <WbButton
                size="sm"
                variant="secondary"
                loading={busy === "pause"}
                onClick={() =>
                  withBusy("pause", async () => {
                    if (!uid) return;
                    await pauseCampaign(uid, campaign.id);
                    toast.success("Paused");
                  })
                }
              >
                <FontAwesomeIcon icon={faPause} className="h-3 w-3" />
                Pause
              </WbButton>
              <WbButton
                size="sm"
                variant="danger"
                loading={busy === "cancel"}
                onClick={() =>
                  withBusy("cancel", async () => {
                    if (!uid) return;
                    if (!confirm("Stop this campaign?")) return;
                    await cancelCampaign(uid, campaign.id);
                    toast.success("Stopped");
                  })
                }
              >
                <FontAwesomeIcon icon={faStop} className="h-3 w-3" />
                Stop
              </WbButton>
            </>
          )}
          {campaign.status === "paused" && (
            <WbButton
              size="sm"
              loading={busy === "resume"}
              onClick={() =>
                withBusy("resume", async () => {
                  if (!uid) return;
                  await resumeCampaign(uid, campaign.id);
                  toast.success("Resumed");
                })
              }
            >
              <FontAwesomeIcon icon={faPlay} className="h-3 w-3" />
              Resume
            </WbButton>
          )}
          {(campaign.status === "completed" || campaign.status === "failed") && (
            <WbButton
              size="sm"
              variant="secondary"
              loading={busy === "restart"}
              onClick={() =>
                withBusy("restart", async () => {
                  if (!uid) return;
                  if (!confirm("Reset counts and set back to draft?")) return;
                  await restartCampaign(uid, campaign.id);
                  toast.success("Reset to draft");
                })
              }
            >
              <FontAwesomeIcon icon={faRotate} className="h-3 w-3" />
              Restart
            </WbButton>
          )}
        </div>
      </div>

      {/* Progress + stats */}
      <div className="border-b border-border px-5 py-4 space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="font-medium text-foreground">
              {done} / {campaign.totalRecipients} · {pct}%
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                campaign.status === "failed" ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat icon={faUsers} label="Recipients" value={campaign.totalRecipients} />
          <MiniStat
            icon={faPaperPlane}
            label="Sent"
            value={campaign.sentCount}
            tone="primary"
          />
          <MiniStat
            icon={faCheckDouble}
            label="Delivered"
            value={`${campaign.deliveredCount}${deliveryRate ? ` · ${deliveryRate}%` : ""}`}
            tone="success"
          />
          <MiniStat
            icon={faEye}
            label="Read"
            value={`${campaign.readCount}${readRate ? ` · ${readRate}%` : ""}`}
          />
        </div>
      </div>

      {/* Message preview */}
      <div className="border-b border-border px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Message
        </p>
        <div className="mt-2 rounded-xl bg-emerald-500/5 p-3 text-sm text-foreground shadow-inner ring-1 ring-emerald-500/10">
          <p className="whitespace-pre-wrap break-words">
            {campaign.messageBody || <span className="italic text-muted-foreground">Empty</span>}
          </p>
        </div>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <p className="text-sm font-semibold">Send log</p>
          <p className="text-[11px] text-muted-foreground">
            {logs?.length ?? 0} entr{(logs?.length ?? 0) === 1 ? "y" : "ies"}
          </p>
        </div>
        <div className="max-h-[280px] overflow-y-auto border-t border-border">
          {logs === null ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : logs.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-muted-foreground">
              No sends yet. Start the campaign to see live delivery logs here.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {logs.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-5 py-2 text-xs">
                  <span
                    className={cn(
                      "grid h-6 w-6 place-items-center rounded-full text-[10px]",
                      l.status === "sent"
                        ? "bg-primary/15 text-primary"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    <FontAwesomeIcon
                      icon={l.status === "sent" ? faPaperPlane : faTriangleExclamation}
                      className="h-2.5 w-2.5"
                    />
                  </span>
                  <span className="flex-1 truncate font-mono text-foreground">{l.phone}</span>
                  {l.error && (
                    <span className="truncate text-destructive" title={l.error}>
                      {l.error}
                    </span>
                  )}
                  <span className="shrink-0 text-muted-foreground">
                    {l.sentAt ? format(new Date(l.sentAt), "p") : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- BITS ------------------------------- */

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: typeof faBullhorn;
  label: string;
  value: number | string;
  tone?: "primary" | "success" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : tone === "danger"
        ? "bg-destructive/15 text-destructive"
        : tone === "primary"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className={cn("grid h-10 w-10 place-items-center rounded-xl", toneCls)}>
          <FontAwesomeIcon icon={icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: typeof faBullhorn;
  label: string;
  value: number | string;
  tone?: "primary" | "success";
}) {
  const cls =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "primary"
        ? "text-primary"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <FontAwesomeIcon icon={icon} className="h-3 w-3" />
        {label}
      </p>
      <p className={cn("mt-1 text-base font-semibold", cls)}>{value}</p>
    </div>
  );
}

function IconBtn({
  icon,
  label,
  onClick,
  tone,
  loading,
}: {
  icon: typeof faTrash;
  label: string;
  onClick: () => void;
  tone?: "danger";
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
        tone === "danger" && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      <FontAwesomeIcon icon={loading ? faCircleNotch : icon} className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
    </button>
  );
}
