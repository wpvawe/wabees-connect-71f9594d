/**
 * Right-side drawer listing every starred message in the current thread.
 * Clicking a row scrolls the thread to that message (via CustomEvent that
 * the parent listens for) and closes the drawer.
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faXmark } from "@fortawesome/free-solid-svg-icons";
import { format } from "date-fns";
import type { Message } from "@/hooks/useMessages";

export function StarredDrawer({
  open,
  onClose,
  messages,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  messages: Message[];
  onJump: (messageId: string) => void;
}) {
  if (!open) return null;
  const starred = messages.filter((m) => m.starred);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-sm flex-col bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FontAwesomeIcon icon={faStar} className="h-4 w-4 text-amber-500" />
          <h2 className="flex-1 text-sm font-semibold">
            Starred messages · {starred.length}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
          </button>
        </header>
        {starred.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <FontAwesomeIcon icon={faStar} className="h-8 w-8 opacity-30" />
            <p className="text-sm">No starred messages yet.</p>
            <p className="text-xs opacity-70">
              Long-press any message, or use the ⋮ menu, and pick <b>Star</b>.
            </p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto divide-y divide-border/60">
            {starred.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onJump(m.id);
                    onClose();
                  }}
                  className="block w-full px-4 py-3 text-left hover:bg-muted/50"
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium">
                      {m.direction === "outgoing" ? "You" : m.contactName}
                    </span>
                    <span className="opacity-70">·</span>
                    <span>
                      {m.createdAt ? format(new Date(m.createdAt), "PP p") : ""}
                    </span>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm">
                    {m.body || m.caption || `[${m.type}]`}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}