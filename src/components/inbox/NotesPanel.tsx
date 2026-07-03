import { useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faNoteSticky,
  faTrash,
  faXmark,
  faPlus,
  faThumbtack,
  faPen,
  faCheck,
  faRobot,
  faRightLeft,
} from "@fortawesome/free-solid-svg-icons";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConvNotes } from "@/hooks/useConvNotes";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { fbAuth } from "@/integrations/firebase/client";
import {
  addNote,
  deleteNote,
  updateNote,
  pinNote,
  parseMentions,
  writeMentionNotifications,
} from "@/lib/firebase/notes";
import { useAgents } from "@/hooks/useAgents";

export function NotesPanel({
  phone,
  open,
  onOpenChange,
}: {
  phone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const { data, error } = useConvNotes(phone);
  const { data: agents } = useAgents();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const mentionMatches = useMemo(() => {
    if (!mentionOpen || !agents) return [];
    const q = mentionQuery.toLowerCase();
    return agents
      .filter((a) => a.status !== "revoked")
      .filter((a) => !q || a.email.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionOpen, mentionQuery, agents]);

  function onComposerChange(next: string) {
    setText(next);
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(before[at - 1] ?? " "))) {
      const token = before.slice(at + 1);
      if (!/\s/.test(token)) {
        setMentionOpen(true);
        setMentionQuery(token);
        return;
      }
    }
    setMentionOpen(false);
    setMentionQuery("");
  }

  function insertMention(email: string) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) return;
    const next = `${text.slice(0, at)}@${email} ${text.slice(caret)}`;
    setText(next);
    setMentionOpen(false);
    setMentionQuery("");
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + email.length + 2;
      el?.setSelectionRange(pos, pos);
    });
  }

  async function submit() {
    const body = text.trim();
    if (!body || !uid || !selfUid) return;
    setBusy(true);
    try {
      const email = fbAuth().currentUser?.email ?? null;
      const mentions = parseMentions(body);
      await addNote(uid, phone, body, { uid: selfUid, email }, { mentions });
      if (mentions.length > 0 && agents) {
        await writeMentionNotifications(
          uid,
          phone,
          mentions,
          agents.map((a) => ({ id: a.id, email: a.email })),
          { uid: selfUid, email },
          body,
        );
      }
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add note");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!uid) return;
    if (!confirm("Delete this note?")) return;
    try {
      await deleteNote(uid, phone, id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function saveEdit(id: string) {
    if (!uid) return;
    const body = editText.trim();
    if (!body) return;
    try {
      await updateNote(uid, phone, id, body);
      setEditingId(null);
      setEditText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    if (!uid) return;
    try {
      await pinNote(uid, phone, id, !pinned);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pin failed");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col p-0">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="flex items-center gap-2">
            <FontAwesomeIcon icon={faNoteSticky} className="h-4 w-4 text-primary" />
            Internal notes
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            Private to your team — never sent to WhatsApp.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : data.length === 0 ? (
            <div className="grid place-items-center py-10 text-center text-muted-foreground">
              <FontAwesomeIcon icon={faNoteSticky} className="mb-2 h-6 w-6 opacity-30" />
              <p className="text-sm">No notes yet</p>
            </div>
          ) : (
            data.map((n) => (
              <div
                key={n.id}
                className={`group rounded-lg border p-3 shadow-soft ${
                  n.pinned
                    ? "border-primary/40 bg-primary/5"
                    : n.kind === "handoff"
                      ? "border-amber-500/40 bg-amber-500/5"
                      : n.kind === "system"
                        ? "border-muted-foreground/20 bg-muted/40"
                        : "border-border bg-card"
                }`}
              >
                {n.pinned && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    <FontAwesomeIcon icon={faThumbtack} className="h-2.5 w-2.5" /> Pinned
                  </div>
                )}
                {n.kind !== "user" && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <FontAwesomeIcon
                      icon={n.kind === "handoff" ? faRightLeft : faRobot}
                      className="h-2.5 w-2.5"
                    />
                    {n.kind === "handoff" ? "Handoff" : "System"}
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  {editingId === n.id ? (
                    <textarea
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={2}
                      className="flex-1 resize-none rounded-md border border-input bg-background p-2 text-sm outline-none ring-ring focus-visible:ring-2"
                    />
                  ) : (
                    <p className="flex-1 whitespace-pre-wrap break-words text-sm text-foreground">
                      {renderNoteBody(n.body)}
                    </p>
                  )}
                  <div
                    className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 ${
                      n.kind !== "user" ? "hidden" : ""
                    }`}
                  >
                    {editingId === n.id ? (
                      <button
                        type="button"
                        onClick={() => saveEdit(n.id)}
                        className="grid h-7 w-7 place-items-center rounded-full text-primary hover:bg-primary/10"
                        aria-label="Save note"
                      >
                        <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => togglePin(n.id, n.pinned)}
                          className={`grid h-7 w-7 place-items-center rounded-full hover:bg-primary/10 ${n.pinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                          aria-label={n.pinned ? "Unpin note" : "Pin note"}
                        >
                          <FontAwesomeIcon icon={faThumbtack} className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(n.id); setEditText(n.body); }}
                          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Edit note"
                        >
                          <FontAwesomeIcon icon={faPen} className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(n.id)}
                          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete note"
                        >
                          <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {n.authorEmail || n.authorUid} ·{" "}
                  {formatNoteTime(n.createdAt)}
                  {n.updatedAt && n.createdAt && n.updatedAt !== n.createdAt && (
                    <span className="ml-1 italic">(edited)</span>
                  )}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border bg-card p-3">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => onComposerChange(e.target.value)}
              rows={2}
              placeholder="Add an internal note… use @ to mention a teammate"
              className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
            {mentionOpen && mentionMatches.length > 0 && (
              <div className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                {mentionMatches.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(a.email);
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        a.isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                    />
                    <span className="truncate">{a.email}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {a.role ?? "agent"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <FontAwesomeIcon icon={faXmark} className="mr-1 h-3 w-3" /> Close
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !text.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faPlus} className="mr-1 h-3 w-3" /> Add note
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function formatNoteTime(value: string | null): string {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return `${formatDistanceToNow(date)} ago`;
}