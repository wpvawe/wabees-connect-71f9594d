import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Row = { keys: string[]; label: string; scope: "List" | "Chat" | "Global" };

const ROWS: Row[] = [
  { keys: ["j"], label: "Next conversation", scope: "List" },
  { keys: ["k"], label: "Previous conversation", scope: "List" },
  { keys: ["/"], label: "Focus search", scope: "List" },
  { keys: ["Esc"], label: "Clear search / close panel", scope: "List" },
  { keys: ["e"], label: "Resolve / reopen", scope: "Chat" },
  { keys: ["s"], label: "Snooze menu", scope: "Chat" },
  { keys: ["a"], label: "Assign to agent", scope: "Chat" },
  { keys: ["n"], label: "Internal notes", scope: "Chat" },
  { keys: ["i"], label: "Contact details", scope: "Chat" },
  { keys: ["t"], label: "Activity timeline", scope: "Chat" },
  { keys: ["/"], label: "Search inside chat", scope: "Chat" },
  { keys: ["?"], label: "Show this help", scope: "Global" },
];

const SCOPE_COLOR: Record<Row["scope"], string> = {
  List: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  Chat: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  Global: "bg-muted text-muted-foreground",
};

export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are ignored while typing in inputs, the composer, or notes.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border/60">
          {ROWS.map((r, i) => (
            <div
              key={`${r.scope}-${r.keys.join("+")}-${i}`}
              className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase ${SCOPE_COLOR[r.scope]}`}
                >
                  {r.scope}
                </span>
                <span className="truncate text-foreground">{r.label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {r.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}