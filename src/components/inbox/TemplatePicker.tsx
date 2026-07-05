/**
 * Floating picker that appears above the composer when the user types "#"
 * at the very start of the message. Same UX as the canned-response picker
 * — arrow keys navigate, Enter/Tab picks, Escape closes.
 *
 * Templates with no variables and no media header can be sent inline. Any
 * template that needs variables or a media header is flagged with a "Fill
 * on Templates page" badge and dispatch is deferred to the Templates page.
 */
import { useEffect, useRef } from "react";
import type { Template } from "@/hooks/useTemplates";

export function templateNeedsForm(t: Template): boolean {
  if (t.variables.length > 0) return true;
  const hf = (t.headerFormat ?? "").toUpperCase();
  return hf === "IMAGE" || hf === "VIDEO" || hf === "DOCUMENT";
}

export function TemplatePicker({
  matches,
  activeIndex,
  onHover,
  onPick,
}: {
  matches: Template[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (t: Template) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (matches.length === 0) return null;

  const active = matches[activeIndex] ?? matches[0];

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-4 right-4 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg z-40"
      role="listbox"
      aria-label="Templates"
    >
      <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Templates · ↑↓ navigate · ↵ send · Esc cancel
      </div>
      {matches.map((t, i) => {
        const needsForm = templateNeedsForm(t);
        return (
          <button
            key={t.id}
            data-idx={i}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(t);
            }}
            className={`block w-full cursor-pointer border-b border-border/40 px-3 py-2 text-left last:border-b-0 ${
              i === activeIndex ? "bg-primary/10" : "hover:bg-muted/60"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-mono font-semibold text-primary">
                #{t.name}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t.category}
              </span>
              {needsForm && (
                <span
                  className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                  title="Open the Templates page to fill variables / attach header media"
                >
                  Needs form
                </span>
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {t.body}
            </p>
          </button>
        );
      })}
      {active && (
        <div className="sticky bottom-0 border-t border-border/60 bg-muted/40 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Preview · {active.languageCode}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              {active.status}
            </span>
          </div>
          {active.header && (
            <p className="mb-1 line-clamp-1 text-[11px] font-semibold text-foreground">
              {active.header}
            </p>
          )}
          <p className="line-clamp-3 whitespace-pre-wrap text-xs text-foreground">
            {active.body}
          </p>
          {active.footer && (
            <p className="mt-1 text-[10px] italic text-muted-foreground">
              {active.footer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}