import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBullseye,
  faSearch,
  faFire,
  faSnowflake,
  faSun,
  faDownload,
  faTrash,
  faPhone,
  faEnvelope,
  faIdCard,
  faComments,
  faXmark,
  faCircleNotch,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { useLeads, updateLead, deleteLead, type Lead, type LeadScore } from "@/hooks/useLeads";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { normalizePhone } from "@/lib/firebase/normalizers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Wabees" },
      {
        name: "description",
        content:
          "AI-captured leads from WhatsApp conversations — hot/warm/cold scoring, quick filters, export.",
      },
    ],
  }),
  component: LeadsPage,
});

type ScoreFilter = "all" | LeadScore;
type StatusFilter = "all" | NonNullable<Lead["status"]>;

const SCORE_META: Record<LeadScore, { label: string; className: string; icon: typeof faFire }> = {
  hot: {
    label: "Hot",
    className: "bg-red-500/15 text-red-500 border-red-500/30",
    icon: faFire,
  },
  warm: {
    label: "Warm",
    className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    icon: faSun,
  },
  cold: {
    label: "Cold",
    className: "bg-sky-500/15 text-sky-500 border-sky-500/30",
    icon: faSnowflake,
  },
};

const STATUS_OPTIONS: NonNullable<Lead["status"]>[] = [
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
];

function LeadsPage() {
  return (
    <>
      <TopBar
        title="Leads"
        subtitle="AI-captured leads from your WhatsApp conversations"
      />
      <WbFirebaseGate>
        <LeadsWorkspace />
      </WbFirebaseGate>
    </>
  );
}

function LeadsWorkspace() {
  const uid = useFirebaseUid();
  const { data, error } = useLeads();
  const [q, setQ] = useState("");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();
    return data.filter((l) => {
      if (scoreFilter !== "all" && l.score !== scoreFilter) return false;
      if (statusFilter !== "all" && (l.status || "new") !== statusFilter) return false;
      if (!needle) return true;
      return (
        l.name.toLowerCase().includes(needle) ||
        l.phone.toLowerCase().includes(needle) ||
        l.altPhone.toLowerCase().includes(needle) ||
        l.email.toLowerCase().includes(needle) ||
        l.cnic.toLowerCase().includes(needle) ||
        l.details.toLowerCase().includes(needle)
      );
    });
  }, [data, q, scoreFilter, statusFilter]);

  const counts = useMemo(() => {
    const c = { total: 0, hot: 0, warm: 0, cold: 0 };
    for (const l of data ?? []) {
      c.total += 1;
      c[l.score] += 1;
    }
    return c;
  }, [data]);

  const selected = useMemo(
    () => (selectedId ? (data ?? []).find((l) => l.id === selectedId) : null),
    [selectedId, data],
  );

  function exportCsv() {
    if (!filtered || filtered.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const header = [
      "Name",
      "Phone",
      "Alt Phone",
      "Email",
      "CNIC",
      "Score",
      "Status",
      "Messages",
      "First Contact",
      "Last Contact",
      "Details",
    ];
    const escape = (s: string) => `"${(s || "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
    const rows = filtered.map((l) =>
      [
        l.name,
        l.phone,
        l.altPhone,
        l.email,
        l.cnic,
        l.score,
        l.status || "new",
        String(l.messageCount),
        l.firstContactAt || "",
        l.lastContactAt || "",
        l.details,
      ]
        .map(escape)
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wabees-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} leads`);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total leads" value={counts.total} tone="default" />
        <StatCard label="Hot" value={counts.hot} tone="hot" />
        <StatCard label="Warm" value={counts.warm} tone="warm" />
        <StatCard label="Cold" value={counts.cold} tone="cold" />
      </div>

      {/* Toolbar */}
      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 md:max-w-sm">
            <FontAwesomeIcon
              icon={faSearch}
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <WbInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, email…"
              className="pl-9"
            />
          </div>
          <FilterChip
            active={scoreFilter === "all"}
            onClick={() => setScoreFilter("all")}
            label="All"
          />
          {(["hot", "warm", "cold"] as LeadScore[]).map((s) => (
            <FilterChip
              key={s}
              active={scoreFilter === s}
              onClick={() => setScoreFilter(s)}
              label={SCORE_META[s].label}
              icon={SCORE_META[s].icon}
              tone={s}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {labelForStatus(s)}
              </option>
            ))}
          </select>
          <WbButton variant="secondary" size="sm" onClick={exportCsv}>
            <FontAwesomeIcon icon={faDownload} className="h-3.5 w-3.5" /> Export CSV
          </WbButton>
        </div>
      </div>

      {/* Body */}
      <div className="mt-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : filtered === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <WbEmpty
            icon={faBullseye}
            title={data && data.length > 0 ? "No leads match your filters" : "No leads yet"}
            description={
              data && data.length > 0
                ? "Try clearing the search or score filter."
                : "When your AI bot captures a phone, email or CNIC from a chat, the lead will appear here."
            }
          />
        ) : (
          <LeadsTable rows={filtered} onOpen={setSelectedId} />
        )}
      </div>

      {selected && uid && (
        <LeadDrawer uid={uid} lead={selected} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | LeadScore;
}) {
  const toneClass =
    tone === "hot"
      ? "text-red-500"
      : tone === "warm"
        ? "text-amber-500"
        : tone === "cold"
          ? "text-sky-500"
          : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", toneClass)}>{value}</p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: typeof faFire;
  tone?: LeadScore;
}) {
  const activeTone =
    tone && active
      ? SCORE_META[tone].className
      : active
        ? "bg-primary text-primary-foreground border-primary"
        : "border-border text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
        activeTone,
      )}
    >
      {icon && <FontAwesomeIcon icon={icon} className="h-3 w-3" />}
      {label}
    </button>
  );
}

function LeadsTable({ rows, onOpen }: { rows: Lead[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="hidden grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.7fr_0.6fr] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
        <div>Lead</div>
        <div>Contact</div>
        <div>Score</div>
        <div>Status</div>
        <div>Last activity</div>
        <div className="text-right">Actions</div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((l) => {
          const meta = SCORE_META[l.score];
          return (
            <li
              key={l.id}
              className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-muted/30 md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.7fr_0.6fr] md:items-center"
            >
              <button
                onClick={() => onOpen(l.id)}
                className="text-left"
              >
                <p className="truncate font-medium text-foreground">
                  {l.name || l.phone || "Unknown"}
                </p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {l.details || `${l.messageCount} message${l.messageCount === 1 ? "" : "s"}`}
                </p>
              </button>
              <div className="flex flex-col gap-0.5 text-xs">
                {l.phone && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <FontAwesomeIcon icon={faPhone} className="h-3 w-3" /> {l.phone}
                  </span>
                )}
                {l.email && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <FontAwesomeIcon icon={faEnvelope} className="h-3 w-3" /> {l.email}
                  </span>
                )}
                {l.cnic && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <FontAwesomeIcon icon={faIdCard} className="h-3 w-3" /> {l.cnic}
                  </span>
                )}
              </div>
              <div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    meta.className,
                  )}
                >
                  <FontAwesomeIcon icon={meta.icon} className="h-2.5 w-2.5" />
                  {meta.label}
                </span>
              </div>
              <div className="text-xs capitalize text-muted-foreground">{l.status || "new"}</div>
              <div className="text-xs text-muted-foreground">
                {l.lastContactAt
                  ? formatDistanceToNowStrict(new Date(l.lastContactAt), { addSuffix: true })
                  : "—"}
              </div>
              <div className="flex justify-start md:justify-end">
                {l.phone && (
                  <Link
                    to="/inbox/$phone"
                    params={{ phone: normalizePhone(l.phone) }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-foreground hover:bg-muted"
                  >
                    <FontAwesomeIcon icon={faComments} className="h-3 w-3" /> Open
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LeadDrawer({
  uid,
  lead,
  onClose,
}: {
  uid: string;
  lead: Lead;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(lead.notes || "");
  const [status, setStatus] = useState<NonNullable<Lead["status"]>>(lead.status || "new");
  const [score, setScore] = useState<LeadScore>(lead.score);

  async function save() {
    setSaving(true);
    try {
      await updateLead(uid, lead.id, { notes, status, score });
      toast.success("Lead updated");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this lead permanently?")) return;
    try {
      await deleteLead(uid, lead.id);
      toast.success("Lead deleted");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const meta = SCORE_META[lead.score];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                <FontAwesomeIcon icon={faUser} className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  {lead.name || lead.phone || "Unknown"}
                </p>
                <span
                  className={cn(
                    "mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    meta.className,
                  )}
                >
                  <FontAwesomeIcon icon={meta.icon} className="h-2.5 w-2.5" />
                  {meta.label} lead · {lead.messageCount} msg
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <section>
            <h5 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Contact details
            </h5>
            <dl className="mt-2 space-y-1.5 text-sm">
              <Row icon={faPhone} label="WhatsApp" value={lead.phone} />
              {lead.altPhone && (
                <Row icon={faPhone} label="Callback" value={lead.altPhone} />
              )}
              {lead.email && <Row icon={faEnvelope} label="Email" value={lead.email} />}
              {lead.cnic && <Row icon={faIdCard} label="CNIC" value={lead.cnic} />}
            </dl>
          </section>

          <section>
            <h5 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Score
            </h5>
            <div className="mt-2 flex gap-2">
              {(["hot", "warm", "cold"] as LeadScore[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScore(s)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium capitalize",
                    score === s
                      ? SCORE_META[s].className
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <FontAwesomeIcon icon={SCORE_META[s].icon} className="mr-1 h-3 w-3" />
                  {s}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h5 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </h5>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] capitalize",
                    status === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h5 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Conversation notes (auto)
            </h5>
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
              {lead.details || "No auto-captured notes yet."}
            </pre>
          </section>

          <section>
            <h5 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Team notes
            </h5>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add internal notes — next-step, quote sent, follow-up date…"
              rows={4}
              className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
            />
          </section>

          <section className="text-xs text-muted-foreground">
            First seen{" "}
            {lead.firstContactAt
              ? formatDistanceToNowStrict(new Date(lead.firstContactAt), { addSuffix: true })
              : "—"}
            {" · Last "}
            {lead.lastContactAt
              ? formatDistanceToNowStrict(new Date(lead.lastContactAt), { addSuffix: true })
              : "—"}
          </section>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-4">
          <WbButton variant="ghost" size="sm" onClick={remove}>
            <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" /> Delete
          </WbButton>
          <div className="flex items-center gap-2">
            {lead.phone && (
              <Link
                to="/inbox/$phone"
                params={{ phone: normalizePhone(lead.phone) }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted"
              >
                <FontAwesomeIcon icon={faComments} className="h-3.5 w-3.5" /> Open chat
              </Link>
            )}
            <WbButton onClick={save} disabled={saving} size="sm">
              {saving ? "Saving…" : "Save changes"}
            </WbButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: typeof faPhone;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
      <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function labelForStatus(s: NonNullable<Lead["status"]>): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}