import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgents } from "@/hooks/useAgents";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { fbAuth } from "@/integrations/firebase/client";
import { assignConversation, pickRoundRobinAgent } from "@/lib/firebase/assignments";
import { WbButton } from "@/components/wb/WbButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserCheck, faUserXmark, faBoltLightning } from "@fortawesome/free-solid-svg-icons";

export function AssignAgentDialog({
  phone,
  currentAgentId,
  open,
  onOpenChange,
}: {
  phone: string;
  currentAgentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const { data: agents } = useAgents();
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function pick(agent: { id: string; email: string | null } | null) {
    if (!uid || !selfUid) return;
    setBusy(agent?.id ?? "clear");
    try {
      const actorEmail = fbAuth().currentUser?.email ?? null;
      await assignConversation(
        uid,
        phone,
        agent,
        { uid: selfUid, email: actorEmail },
        {
          reason: reason.trim() || undefined,
          source: "manual",
          previousAgentId: currentAgentId,
        },
      );
      toast.success(agent ? `Assigned to ${agent.email || agent.id}` : "Unassigned");
      setReason("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setBusy(null);
    }
  }

  async function autoAssign() {
    if (!uid || !selfUid || !agents) return;
    const eligible = agents.filter((a) => a.status !== "revoked");
    const next = pickRoundRobinAgent(eligible, currentAgentId);
    if (!next) {
      toast.error("No eligible agent available");
      return;
    }
    setBusy("auto");
    try {
      const actorEmail = fbAuth().currentUser?.email ?? null;
      await assignConversation(
        uid,
        phone,
        { id: next.id, email: next.email ?? null },
        { uid: selfUid, email: actorEmail },
        {
          reason: reason.trim() || undefined,
          source: "auto_round_robin",
          previousAgentId: currentAgentId,
        },
      );
      toast.success(
        `Auto-assigned to ${next.email || next.id}${next.isOnline ? " (online)" : ""}`,
      );
      setReason("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-assign failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign conversation</DialogTitle>
          <DialogDescription>
            Route this thread to a specific agent on your team.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {agents === null ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : agents.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No agents yet. Add teammates in Settings → Agents.
            </p>
          ) : (
            agents.map((a) => {
              const active = currentAgentId === a.id;
              const revoked = a.status === "revoked";
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={busy !== null || revoked}
                  onClick={() => pick({ id: a.id, email: a.email || null })}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${
                    active ? "border border-primary bg-primary/5" : ""
                  } ${revoked ? "opacity-50" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        title={a.isOnline ? "Online" : "Offline"}
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          a.isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
                        }`}
                      />
                      <p className="truncate font-medium">{a.email || a.id}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {(a.role ?? "agent")}
                      {a.activeLoad ? ` · ${a.activeLoad} active` : ""}
                      {revoked ? " · revoked" : ""}
                    </p>
                  </div>
                  {active && (
                    <FontAwesomeIcon icon={faUserCheck} className="h-3.5 w-3.5 text-primary" />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          <label htmlFor="assign-reason" className="text-xs font-medium text-muted-foreground">
            Reason / note (optional)
          </label>
          <textarea
            id="assign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. escalation to senior, out-of-office cover, follow-up owner…"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs outline-none ring-ring focus-visible:ring-2"
          />
        </div>

        <DialogFooter className="gap-2">
          <WbButton
            variant="secondary"
            onClick={autoAssign}
            loading={busy === "auto"}
            disabled={!agents || agents.length === 0}
          >
            <FontAwesomeIcon icon={faBoltLightning} className="mr-1.5 h-3.5 w-3.5" />
            Auto-assign
          </WbButton>
          {currentAgentId && (
            <WbButton
              variant="ghost"
              onClick={() => pick(null)}
              loading={busy === "clear"}
            >
              <FontAwesomeIcon icon={faUserXmark} className="mr-1.5 h-3.5 w-3.5" />
              Unassign
            </WbButton>
          )}
          <WbButton variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </WbButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}