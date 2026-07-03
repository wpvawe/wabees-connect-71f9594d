/**
 * Owner-only dialog for editing an agent's weekly working hours.
 * Displays a 7-day grid; each day is a toggle + start/end time inputs.
 * Save writes to users/{owner}/agents/{agentId}.workingHours; clear removes
 * the schedule (agent is treated as always-on for routing).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WbButton } from "@/components/wb/WbButton";
import {
  DAY_LABELS,
  DEFAULT_WEEKDAY_9_TO_6,
  normalizeWorkingHours,
  saveAgentWorkingHours,
  type HoursSlot,
  type WorkingHours,
} from "@/lib/firebase/working-hours";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerUid: string;
  agentId: string;
  agentEmail: string;
  initial: WorkingHours | null;
};

type DraftDay = { enabled: boolean; slot: HoursSlot };
type Draft = { tz: string; days: Record<number, DraftDay> };

function toDraft(hours: WorkingHours | null): Draft {
  const src = hours && Object.keys(hours.days ?? {}).length > 0 ? hours : DEFAULT_WEEKDAY_9_TO_6;
  const days: Record<number, DraftDay> = {};
  for (let d = 0; d < 7; d++) {
    const slots = src.days[d as 0 | 1 | 2 | 3 | 4 | 5 | 6] ?? [];
    days[d] = {
      enabled: slots.length > 0,
      slot: slots[0] ?? { start: "09:00", end: "18:00" },
    };
  }
  return { tz: src.tz ?? "", days };
}

function fromDraft(draft: Draft): WorkingHours {
  const days: WorkingHours["days"] = {};
  for (const [k, v] of Object.entries(draft.days)) {
    if (v.enabled) days[Number(k) as 0 | 1 | 2 | 3 | 4 | 5 | 6] = [v.slot];
  }
  return normalizeWorkingHours({ tz: draft.tz.trim() || null, days });
}

export function WorkingHoursDialog({
  open,
  onOpenChange,
  ownerUid,
  agentId,
  agentEmail,
  initial,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [busy, setBusy] = useState(false);
  const detectedTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (open) setDraft(toDraft(initial));
  }, [open, initial]);

  async function save() {
    setBusy(true);
    try {
      await saveAgentWorkingHours(ownerUid, agentId, fromDraft(draft));
      toast.success("Working hours saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await saveAgentWorkingHours(ownerUid, agentId, null);
      toast.success("Schedule cleared — agent treated as always available");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clear");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Working hours</DialogTitle>
          <DialogDescription>
            {agentEmail} — auto-routing will prefer agents currently within their hours.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Timezone (IANA)
            <input
              type="text"
              value={draft.tz}
              onChange={(e) => setDraft((d) => ({ ...d, tz: e.target.value }))}
              placeholder={detectedTz}
              className="mt-1 h-9 w-full rounded border border-input bg-background px-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Leave blank to use the agent's device timezone.
            </span>
          </label>

          <div className="rounded-md border border-border">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const day = draft.days[d];
              return (
                <div
                  key={d}
                  className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <label className="flex w-24 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={day.enabled}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          days: {
                            ...prev.days,
                            [d]: { ...prev.days[d], enabled: e.target.checked },
                          },
                        }))
                      }
                    />
                    <span className="font-medium">{DAY_LABELS[d]}</span>
                  </label>
                  <input
                    type="time"
                    value={day.slot.start}
                    disabled={!day.enabled}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        days: {
                          ...prev.days,
                          [d]: {
                            ...prev.days[d],
                            slot: { ...prev.days[d].slot, start: e.target.value },
                          },
                        },
                      }))
                    }
                    className="h-9 flex-1 rounded border border-input bg-background px-2 text-sm outline-none ring-ring focus-visible:ring-2 disabled:opacity-50"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={day.slot.end}
                    disabled={!day.enabled}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        days: {
                          ...prev.days,
                          [d]: {
                            ...prev.days[d],
                            slot: { ...prev.days[d].slot, end: e.target.value },
                          },
                        },
                      }))
                    }
                    className="h-9 flex-1 rounded border border-input bg-background px-2 text-sm outline-none ring-ring focus-visible:ring-2 disabled:opacity-50"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2">
          <WbButton variant="ghost" onClick={clear} loading={busy}>
            Clear schedule
          </WbButton>
          <div className="flex gap-2">
            <WbButton variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </WbButton>
            <WbButton onClick={save} loading={busy}>
              Save
            </WbButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}