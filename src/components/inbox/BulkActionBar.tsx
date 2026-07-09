import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faUserPlus,
  faTag,
  faFlag,
  faCircleCheck,
  faRotateLeft,
  faMoon,
  faTrash,
  faCircleNotch,
  faBoltLightning,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { fbAuth } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useAgents } from "@/hooks/useAgents";
import { useCan } from "@/lib/auth/permissions";
import {
  addTag,
  deleteConversation,
  setPriority,
  PRIORITY_META,
  type ConvPriority,
} from "@/lib/firebase/conversations";
import {
  assignConversation,
  pickRoundRobinAgent,
  setConversationState,
  type ConversationState,
} from "@/lib/firebase/assignments";
import type { Conversation } from "@/hooks/useConversations";
import type { TagDef } from "@/lib/firebase/conversations";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ActionKey =
  | null
  | "assign"
  | "tag"
  | "priority"
  | "resolve"
  | "reopen"
  | "snooze"
  | "delete";

const SNOOZE_OPTIONS: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "3h", hours: 3 },
  { label: "Tomorrow", hours: 24 },
  { label: "Next week", hours: 24 * 7 },
];

export function BulkActionBar({
  selected,
  conversations,
  tags,
  onClear,
}: {
  selected: string[];
  conversations: Conversation[];
  tags: TagDef[];
  onClear: () => void;
}) {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const { data: agents } = useAgents();
  const can = useCan();
  const [busy, setBusy] = useState(false);
  const [popover, setPopover] = useState<ActionKey>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canAssign = can("conversation.assign");
  const canDelete = can("conversation.delete");
  const canState = can("conversation.state");

  const selectedRows = conversations.filter((c) => selected.includes(c.contactPhone));
  const count = selected.length;
  const hasResolved = selectedRows.some((c) => c.state === "resolved");
  const hasUnresolved = selectedRows.some((c) => c.state !== "resolved");

  async function runForEach<T>(fn: (phone: string) => Promise<T>, label: string, phones = selected) {
    if (!uid || !selfUid) return;
    if (phones.length === 0) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    await Promise.all(
      phones.map(async (phone) => {
        try {
          await fn(phone);
          ok += 1;
        } catch {
          fail += 1;
        }
      }),
    );
    setBusy(false);
    setPopover(null);
    if (fail === 0) {
      toast.success(`${label}: ${ok} conversation${ok === 1 ? "" : "s"}`);
      onClear();
    } else {
      toast.warning(`${label}: ${ok} ok, ${fail} failed`);
    }
  }

  async function bulkAssign(agent: { id: string; email: string | null } | null) {
    if (!selfUid) return;
    const actorEmail = fbAuth().currentUser?.email ?? null;
    await runForEach(async (phone) => {
      const prev = selectedRows.find((c) => c.contactPhone === phone)?.assignedAgentId ?? null;
      await assignConversation(
        uid!,
        phone,
        agent,
        { uid: selfUid, email: actorEmail },
        { source: "manual", previousAgentId: prev },
      );
    }, agent ? `Assigned to ${agent.email || agent.id}` : "Unassigned");
  }

  async function bulkAutoAssign() {
    if (!agents) return;
    const eligible = agents.filter((a) => a.status !== "revoked");
    const actorEmail = fbAuth().currentUser?.email ?? null;
    if (eligible.length === 0) {
      toast.error("No eligible agents");
      return;
    }
    await runForEach(async (phone) => {
      const prev = selectedRows.find((c) => c.contactPhone === phone)?.assignedAgentId ?? null;
      const next = pickRoundRobinAgent(eligible, prev);
      if (!next) throw new Error("no agent");
      await assignConversation(
        uid!,
        phone,
        { id: next.id, email: next.email ?? null },
        { uid: selfUid!, email: actorEmail },
        { source: "auto_round_robin", previousAgentId: prev },
      );
    }, "Auto-assigned");
  }

  async function bulkTag(tagName: string) {
    await runForEach((phone) => addTag(uid!, phone, tagName), `Tagged "${tagName}"`);
  }

  async function bulkPriority(p: ConvPriority) {
    await runForEach((phone) => setPriority(uid!, phone, p), `Priority: ${PRIORITY_META[p].label}`);
  }

  async function bulkState(state: ConversationState, snoozeUntil?: Date) {
    const actorEmail = fbAuth().currentUser?.email ?? null;
    const phones = selectedRows
      .filter((c) => (state === "open" ? c.state === "resolved" : c.state !== "resolved"))
      .map((c) => c.contactPhone);
    await runForEach(async (phone) => {
      const row = selectedRows.find((c) => c.contactPhone === phone);
      await setConversationState(
        uid!,
        phone,
        state,
        { uid: selfUid!, email: actorEmail },
        {
          snoozeUntil,
          assignedAgentId: row?.assignedAgentId ?? null,
          previousState: (row?.state as ConversationState) ?? "open",
        },
      );
    },
    state === "resolved"
      ? "Resolved"
      : state === "snoozed"
      ? "Snoozed"
      : "Reopened",
    phones);
  }

  async function bulkDelete() {
    setConfirmDelete(false);
    await runForEach((phone) => deleteConversation(uid!, phone), "Deleted");
  }

  return (
    <div className="border-t border-border bg-card/95 p-2 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          {busy ? (
            <FontAwesomeIcon icon={faCircleNotch} className="h-3 w-3 animate-spin text-primary" />
          ) : (
            <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
              {count}
            </span>
          )}
          selected
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted"
          title="Clear selection"
        >
          <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {canAssign && (
          <BulkChip icon={faUserPlus} label="Assign" onClick={() => setPopover(popover === "assign" ? null : "assign")} active={popover === "assign"} />
        )}
        {tags.length > 0 && (
          <BulkChip icon={faTag} label="Tag" onClick={() => setPopover(popover === "tag" ? null : "tag")} active={popover === "tag"} />
        )}
        <BulkChip icon={faFlag} label="Priority" onClick={() => setPopover(popover === "priority" ? null : "priority")} active={popover === "priority"} />
        {canState && hasUnresolved && (
          <BulkChip icon={faCircleCheck} label="Resolve" onClick={() => void bulkState("resolved")} />
        )}
        {canState && hasResolved && (
          <BulkChip icon={faRotateLeft} label="Reopen" onClick={() => void bulkState("open")} />
        )}
        {canState && (
          <BulkChip icon={faMoon} label="Snooze" onClick={() => setPopover(popover === "snooze" ? null : "snooze")} active={popover === "snooze"} />
        )}
        {canDelete && (
          <BulkChip icon={faTrash} label="Delete" onClick={() => setConfirmDelete(true)} destructive />
        )}
      </div>

      {popover === "assign" && (
        <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => void bulkAutoAssign()}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold text-primary hover:bg-primary/10"
          >
            <FontAwesomeIcon icon={faBoltLightning} className="h-3 w-3" /> Auto-assign (round-robin)
          </button>
          <button
            type="button"
            onClick={() => void bulkAssign(null)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
          >
            Unassign
          </button>
          <div className="my-1 border-t border-border" />
          {(agents ?? []).filter((a) => a.status !== "revoked").map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => void bulkAssign({ id: a.id, email: a.email || null })}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", a.isOnline ? "bg-emerald-500" : "bg-muted-foreground/40")} />
              <span className="flex-1 truncate">{a.email || a.id}</span>
              <span className="text-[10px] text-muted-foreground">{a.activeLoad || 0}</span>
            </button>
          ))}
          {(!agents || agents.length === 0) && (
            <p className="p-2 text-xs text-muted-foreground">No teammates yet.</p>
          )}
        </div>
      )}

      {popover === "tag" && (
        <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border bg-background p-1">
          {tags.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No tags yet. Create one from the filter bar.</p>
          ) : tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void bulkTag(t.name)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {popover === "priority" && (
        <div className="mt-2 grid grid-cols-4 gap-1 rounded-md border border-border bg-background p-1">
          {(Object.keys(PRIORITY_META) as ConvPriority[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void bulkPriority(p)}
              className="flex items-center justify-center gap-1 rounded px-1 py-1.5 text-[10px] font-semibold hover:bg-muted"
              style={{ color: PRIORITY_META[p].color }}
            >
              <FontAwesomeIcon icon={faFlag} className="h-2.5 w-2.5" />
              {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      )}

      {popover === "snooze" && (
        <div className="mt-2 flex flex-wrap gap-1 rounded-md border border-border bg-background p-1">
          {SNOOZE_OPTIONS.map((o) => (
            <button
              key={o.hours}
              type="button"
              onClick={() => {
                const until = new Date(Date.now() + o.hours * 3600 * 1000);
                void bulkState("snoozed", until);
              }}
              className="flex-1 rounded px-2 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} conversation{count === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected {count === 1 ? "conversation" : "conversations"} and their messages
              will be hidden from your inbox. This can&rsquo;t be undone from the workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void bulkDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BulkChip({
  icon,
  label,
  onClick,
  active,
  destructive,
}: {
  icon: import("@fortawesome/fontawesome-svg-core").IconDefinition;
  label: string;
  onClick: () => void;
  active?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        destructive
          ? "border-destructive/30 text-destructive hover:bg-destructive/10"
          : active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:bg-muted",
      )}
    >
      <FontAwesomeIcon icon={icon} className="h-3 w-3" />
      {label}
    </button>
  );
}