import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WbButton } from "@/components/wb/WbButton";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  cancelScheduledMessage,
  createScheduledMessage,
  deleteScheduledMessage,
} from "@/lib/firebase/scheduled";
import { useScheduledMessages } from "@/hooks/useScheduledMessages";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock, faTrash, faBan } from "@fortawesome/free-solid-svg-icons";

export function ScheduleDialog({
  phone,
  open,
  onOpenChange,
}: {
  phone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uid = useEffectiveUid();
  const { data } = useScheduledMessages(phone);
  const [body, setBody] = useState("");
  const defaultWhen = useMemo(() => {
    const d = new Date(Date.now() + 15 * 60 * 1000);
    d.setSeconds(0, 0);
    return toLocalDatetimeInput(d);
  }, []);
  const [when, setWhen] = useState(defaultWhen);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!uid) return;
    const text = body.trim();
    if (!text) {
      toast.error("Message is empty");
      return;
    }
    const scheduledFor = new Date(when);
    if (Number.isNaN(scheduledFor.getTime())) {
      toast.error("Pick a valid time");
      return;
    }
    if (scheduledFor.getTime() < Date.now() + 30_000) {
      toast.error("Pick a time at least 30 seconds in the future");
      return;
    }
    setBusy(true);
    try {
      await createScheduledMessage(uid, { phone, body: text, scheduledFor });
      setBody("");
      toast.success(`Scheduled for ${format(scheduledFor, "PPp")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Schedule failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FontAwesomeIcon icon={faClock} className="h-4 w-4 text-primary" />
            Schedule a message
          </DialogTitle>
          <DialogDescription>
            Delivery runs in-browser — keep a Wabees tab open around the scheduled time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Type the WhatsApp message…"
              className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              Send at
            </label>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
          </div>
        </div>

        {data && data.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-2">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Upcoming & recent
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {data.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-card"
                >
                  <div className="min-w-0">
                    <p className="truncate">{s.body}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.scheduledFor
                        ? `${format(new Date(s.scheduledFor), "PPp")} · ${statusLabel(s.status, s.scheduledFor)}`
                        : statusLabel(s.status, null)}
                      {s.errorReason ? ` · ${s.errorReason}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {s.status === "pending" && uid && (
                      <button
                        type="button"
                        onClick={() => void cancelScheduledMessage(uid, s.id)}
                        title="Cancel"
                        className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                      >
                        <FontAwesomeIcon icon={faBan} className="h-3 w-3" />
                      </button>
                    )}
                    {uid && (
                      <button
                        type="button"
                        onClick={() => void deleteScheduledMessage(uid, s.id)}
                        title="Remove"
                        className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <WbButton variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </WbButton>
          <WbButton onClick={submit} loading={busy}>
            <FontAwesomeIcon icon={faClock} className="mr-1.5 h-3.5 w-3.5" />
            Schedule
          </WbButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function statusLabel(status: string, iso: string | null): string {
  if (status === "pending" && iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms > 0) return `in ${formatDistanceToNow(new Date(iso))}`;
    return "sending soon…";
  }
  return status;
}

function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}