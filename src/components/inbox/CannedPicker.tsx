/**
 * Floating picker that appears above the composer when the user types "/"
 * at the very start of the message. Arrow keys navigate, Enter/Tab inserts.
 * Escape closes. The parent Composer owns the trigger detection.
 */
import { useEffect, useRef } from "react";
import {
  expandCanned,
  findUnresolvedVars,
  type CannedContext,
  type CannedResponse,
} from "@/lib/firebase/canned";

export function CannedPicker({
  matches,
  activeIndex,
  onHover,
  onPick,
  ctx,
}: {
  matches: CannedResponse[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (item: CannedResponse) => void;
  ctx: CannedContext;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the highlighted row in view as the user arrows through matches.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (matches.length === 0) return null;

  const active = matches[activeIndex] ?? matches[0];
  const preview = active ? expandCanned(active.body, ctx) : "";
  const missing = active ? findUnresolvedVars(active.body, ctx) : [];

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-4 right-4 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg z-40"
      role="listbox"
      aria-label="Quick replies"
    >
      <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Quick replies · ↑↓ navigate · ↵ insert · Esc cancel
      </div>
      {matches.map((c, i) => (
        <button
          key={c.id}
          data-idx={i}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            // mousedown so click fires before the textarea blur closes us
            e.preventDefault();
            onPick(c);
          }}
          className={`block w-full cursor-pointer border-b border-border/40 px-3 py-2 text-left last:border-b-0 ${
            i === activeIndex ? "bg-primary/10" : "hover:bg-muted/60"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-mono font-semibold text-primary">
              /{c.shortcut}
            </span>
            <span className="truncate text-sm font-medium text-foreground">
              {c.title || c.shortcut}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {c.body}
          </p>
        </button>
      ))}
      {active && (
        <div className="sticky bottom-0 border-t border-border/60 bg-muted/40 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </span>
            {missing.length > 0 && (
              <span
                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                title={`Placeholders still empty: ${missing.join(", ")}`}
              >
                {missing.length} to fill
              </span>
            )}
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap text-xs text-foreground">
            {preview}
          </p>
        </div>
      )}
    </div>
  );
}