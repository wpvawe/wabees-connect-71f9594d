/**
 * Batch F10 — Conversation Activity/Audit Timeline.
 *
 * Slide-over drawer that streams the `assign_log` subcollection of the
 * active conversation and renders it as a colour-coded timeline. Every
 * assign / unassign / state change already writes here, so the drawer is
 * pure UI over data we've been persisting since Batch A.
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faUserPlus,
  faUserSlash,
  faCheckDouble,
  faRotateLeft,
  faMoon,
  faHourglassHalf,
  faRobot,
  faShuffle,
  faXmark,
  faClockRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import { formatDistanceToNow, format } from "date-fns";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { useAssignLog, type AssignLogEntry } from "@/hooks/useAssignLog";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

type Visual = { icon: IconDefinition; color: string; label: string };

function visualFor(entry: AssignLogEntry): Visual {
  const a = entry.action;
  if (a === "assign") {
    return {
      icon: faUserPlus,
      color: "#0ea5e9",
      label: entry.agentEmail ? `Assigned to ${entry.agentEmail}` : "Assigned",
    };
  }
  if (a === "unassign") {
    return { icon: faUserSlash, color: "#64748b", label: "Unassigned" };
  }
  if (a.startsWith("state:")) {
    const s = entry.state ?? a.slice(6);
    if (s === "resolved") return { icon: faCheckDouble, color: "#10b981", label: "Marked resolved" };
    if (s === "open") return { icon: faRotateLeft, color: "#0ea5e9", label: "Reopened" };
    if (s === "snoozed") return { icon: faMoon, color: "#f59e0b", label: "Snoozed" };
    if (s === "pending") return { icon: faHourglassHalf, color: "#f59e0b", label: "Marked pending" };
    return { icon: faClockRotateLeft, color: "#64748b", label: `State: ${s}` };
  }
  return { icon: faClockRotateLeft, color: "#64748b", label: a };
}

function sourceBadge(source: string | null | undefined): { label: string; icon: IconDefinition } | null {
  if (!source || source === "manual") return null;
  if (source === "auto_reply") return { label: "Auto (reply window)", icon: faRobot };
  if (source === "auto_round_robin") return { label: "Auto (round-robin)", icon: faShuffle };
  return { label: source, icon: faRobot };
}

function friendlyTime(iso: string | null): { rel: string; abs: string } {
  if (!iso) return { rel: "just now", abs: "" };
  const d = new Date(iso);
  return {
    rel: formatDistanceToNow(d, { addSuffix: true }),
    abs: format(d, "PPp"),
  };
}

export function ActivityDrawer({
  open,
  onClose,
  phone,
  contactName,
}: {
  open: boolean;
  onClose: () => void;
  phone: string;
  contactName?: string | null;
}) {
  const { data, error } = useAssignLog(open ? phone : null);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Panel */}
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FontAwesomeIcon icon={faClockRotateLeft} className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold leading-tight">Conversation activity</h2>
            <p className="truncate text-xs text-muted-foreground">
              {contactName || phone}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Close activity"
          >
            <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : data === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : data.length === 0 ? (
            <WbEmpty
              icon={faClockRotateLeft}
              title="No activity yet"
              description="Assignments, resolutions and snoozes will show up here as they happen."
            />
          ) : (
            <ol className="relative ml-3 border-l border-border pl-5">
              {data.map((entry) => {
                const v = visualFor(entry);
                const t = friendlyTime(entry.at);
                const src = sourceBadge(entry.source);
                return (
                  <li key={entry.id} className="relative pb-5 last:pb-0">
                    <span
                      className="absolute -left-[27px] top-0 grid h-5 w-5 place-items-center rounded-full border border-border bg-card"
                      style={{ color: v.color }}
                    >
                      <FontAwesomeIcon icon={v.icon} className="h-2.5 w-2.5" />
                    </span>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{v.label}</span>
                      {src && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <FontAwesomeIcon icon={src.icon} className="h-2.5 w-2.5" />
                          {src.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground" title={t.abs}>
                      {t.rel}
                      {entry.actorEmail ? <> · by {entry.actorEmail}</> : null}
                    </p>
                    {entry.reason && (
                      <p className="mt-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs italic text-foreground">
                        “{entry.reason}”
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}