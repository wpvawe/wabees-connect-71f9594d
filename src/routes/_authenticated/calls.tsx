import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPhone,
  faPhoneVolume,
  faPhoneSlash,
  faArrowRight,
  faArrowLeft,
  faCircleNotch,
} from "@fortawesome/free-solid-svg-icons";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useCallLogs } from "@/hooks/useCallLogs";
import { terminateCall, rejectCall } from "@/lib/wabees/calls";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({
    meta: [
      { title: "Calls · Wabees" },
      {
        name: "description",
        content: "WhatsApp Business call history and live incoming call handling.",
      },
    ],
  }),
  component: CallsPage,
});

function fmtDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusPill(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    ringing: { label: "Ringing", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    initiated: { label: "Dialing", cls: "bg-primary/15 text-primary" },
    connected: { label: "Connected", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    ended: { label: "Ended", cls: "bg-muted text-muted-foreground" },
    terminated: { label: "Ended", cls: "bg-muted text-muted-foreground" },
    rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive" },
    missed: { label: "Missed", cls: "bg-destructive/15 text-destructive" },
    not_answered: { label: "No answer", cls: "bg-destructive/15 text-destructive" },
  };
  const s = map[status] ?? { label: status || "—", cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function CallsPage() {
  const { data, loading, error } = useCallLogs(150);
  const wa = useWhatsAppConfig("effective");
  const [busy, setBusy] = useState<string | null>(null);

  const groups = useMemo(() => {
    const list = data ?? [];
    return {
      active: list.filter((c) =>
        ["ringing", "connected", "initiated"].includes(c.status),
      ),
      history: list.filter(
        (c) => !["ringing", "connected", "initiated"].includes(c.status),
      ),
    };
  }, [data]);

  async function onEnd(callId: string) {
    setBusy(callId);
    const res = await terminateCall({ call_id: callId });
    setBusy(null);
    if (!res.success) toast.error(res.message || "Couldn't end call");
    else toast.success("Call ended");
  }
  async function onReject(callId: string) {
    setBusy(callId);
    const res = await rejectCall({ call_id: callId });
    setBusy(null);
    if (!res.success) toast.error(res.message || "Couldn't reject call");
    else toast.success("Call rejected");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <FontAwesomeIcon icon={faPhoneVolume} className="h-5 w-5 text-primary" />
            Calls
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Live and historical WhatsApp Business calls. Incoming calls appear here the moment
            Meta rings your number. Audio is handled by your WhatsApp Business app or desktop.
          </p>
        </div>
      </header>

      {/* Setup / capability panel — honest about what works without a media gateway. */}
      <div className="mb-6 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2">
        <div>
          <div className="mb-1 text-sm font-semibold">What works right now</div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Incoming calls: live banner + ring + Firestore log</li>
            <li>• Reject incoming call from browser</li>
            <li>• End (terminate) an active call</li>
            <li>• Full call history: missed / rejected / duration</li>
            <li>• Answer audio on WhatsApp Business app or Desktop</li>
          </ul>
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold">Needs SIP / WebRTC gateway</div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Making outbound calls from the browser</li>
            <li>• Answering calls directly in the browser</li>
            <li>
              Configure in <span className="font-medium">Meta → WhatsApp → Phone number →
              Call settings → Use SIP</span>. Until then, calls ring on the WhatsApp app.
            </li>
          </ul>
          {!wa.data?.connected ? (
            <p className="mt-2 text-xs text-destructive">
              WhatsApp is not connected — connect a number first.
            </p>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FontAwesomeIcon icon={faCircleNotch} className="h-4 w-4 animate-spin" />
          Loading calls…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          {groups.active.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Active
              </h2>
              <div className="space-y-2">
                {groups.active.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
                  >
                    <FontAwesomeIcon
                      icon={c.type === "incoming" ? faArrowLeft : faArrowRight}
                      className="h-4 w-4 text-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {c.callerName || c.from || c.to}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.from || c.to} · {c.callType}
                      </div>
                    </div>
                    {statusPill(c.status)}
                    {c.status === "ringing" && c.type === "incoming" ? (
                      <button
                        type="button"
                        disabled={busy === c.callId}
                        onClick={() => onReject(c.callId)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                      >
                        <FontAwesomeIcon icon={faPhoneSlash} className="h-3 w-3" />
                        Reject
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === c.callId}
                        onClick={() => onEnd(c.callId)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        End
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              History
            </h2>
            {groups.history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No calls yet. Incoming and outgoing calls will show up here.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Direction</th>
                      <th className="px-3 py-2 text-left">Contact</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Duration</th>
                      <th className="px-3 py-2 text-left">When</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.history.map((c) => {
                      const other = c.type === "incoming" ? c.from : c.to || c.from;
                      return (
                        <tr key={c.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <FontAwesomeIcon
                              icon={c.type === "incoming" ? faArrowLeft : faArrowRight}
                              className={`h-3 w-3 ${
                                c.status === "missed" || c.status === "not_answered" || c.status === "rejected"
                                  ? "text-destructive"
                                  : "text-emerald-600"
                              }`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{c.callerName || other || "Unknown"}</div>
                            {other && c.callerName ? (
                              <div className="text-xs text-muted-foreground">{other}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{statusPill(c.status)}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {fmtDuration(c.duration)}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {c.createdAt
                              ? formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {other ? (
                              <Link
                                to="/inbox/$phone"
                                params={{ phone: other }}
                                className="text-xs text-primary hover:underline"
                              >
                                Open chat
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}