/**
 * Availability picker shown in the TopBar. Three states:
 *   Available (green) · Away (amber) · Do Not Disturb (red)
 *
 * DND removes the current user from auto-routing without disconnecting them
 * from the inbox — they can still respond manually.
 */
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleDot, faMoon, faBanSmoking, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { useAgentAvailability, type Availability } from "@/hooks/useAgentAvailability";
import { cn } from "@/lib/utils";

const OPTIONS: {
  value: Availability;
  label: string;
  hint: string;
  icon: typeof faCircleDot;
  color: string;
}[] = [
  {
    value: "available",
    label: "Available",
    hint: "Auto-routing sends new chats to you",
    icon: faCircleDot,
    color: "text-emerald-600",
  },
  {
    value: "away",
    label: "Away",
    hint: "Still routable when nobody else is online",
    icon: faMoon,
    color: "text-amber-600",
  },
  {
    value: "dnd",
    label: "Do Not Disturb",
    hint: "Auto-routing skips you entirely",
    icon: faBanSmoking,
    color: "text-destructive",
  },
];

export function AvailabilityToggle() {
  const { status, setStatus } = useAgentAvailability();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.value === status) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Availability: ${current.label}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <FontAwesomeIcon icon={current.icon} className={cn("h-3 w-3", current.color)} />
        <span className="hidden sm:inline">{current.label}</span>
        <FontAwesomeIcon icon={faChevronDown} className="h-2.5 w-2.5 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {OPTIONS.map((o) => {
            const active = o.value === status;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setStatus(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded px-2 py-1.5 text-left text-xs hover:bg-muted",
                  active && "bg-muted",
                )}
              >
                <FontAwesomeIcon icon={o.icon} className={cn("mt-0.5 h-3 w-3", o.color)} />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{o.label}</p>
                  <p className="text-[11px] text-muted-foreground">{o.hint}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}