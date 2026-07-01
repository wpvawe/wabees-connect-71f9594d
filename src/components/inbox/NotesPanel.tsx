import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faNoteSticky, faTrash, faXmark, faPlus } from "@fortawesome/free-solid-svg-icons";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConvNotes } from "@/hooks/useConvNotes";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { fbAuth } from "@/integrations/firebase/client";
import { addNote, deleteNote } from "@/lib/firebase/notes";

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
                className="group rounded-lg border border-border bg-card p-3 shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                    {n.body}
                  </p>
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    aria-label="Delete note"
                  >
                    <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {n.authorEmail || n.authorUid} ·{" "}
                  {formatNoteTime(n.createdAt)}
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