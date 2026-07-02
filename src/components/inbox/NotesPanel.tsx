import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faNoteSticky, faTrash, faXmark, faPlus, faThumbtack, faPen, faCheck } from "@fortawesome/free-solid-svg-icons";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConvNotes } from "@/hooks/useConvNotes";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { fbAuth } from "@/integrations/firebase/client";
import { addNote, deleteNote, updateNote, pinNote } from "@/lib/firebase/notes";

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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function submit() {
    const body = text.trim();
    if (!body || !uid || !selfUid) return;
    setBusy(true);
    try {
      const email = fbAuth().currentUser?.email ?? null;
      await addNote(uid, phone, body, { uid: selfUid, email });
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
                className={`group rounded-lg border p-3 shadow-soft ${n.pinned ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}
              >
                {n.pinned && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    <FontAwesomeIcon icon={faThumbtack} className="h-2.5 w-2.5" /> Pinned
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
                      {n.body}
                    </p>
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
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
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Add an internal note…"
            className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm outline-none ring-ring focus-visible:ring-2"
          />
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