import { useEffect, useRef } from "react";

type Handler = (event: KeyboardEvent) => void;

/**
 * Global keyboard shortcut hook.
 *
 * - Ignores events fired while the user is typing in an input, textarea,
 *   select, or any contentEditable region (WhatsApp-style: shortcuts never
 *   steal keystrokes from the composer or search boxes).
 * - Skips when a modifier (⌘/Ctrl/Alt) is held so it never collides with
 *   browser or app-level chords.
 * - Keys are matched case-insensitively; use "?" (with shift) directly.
 * - Handlers receive the raw event so callers can `preventDefault()` or
 *   inspect modifiers themselves when needed.
 */
export function useHotkeys(
  map: Record<string, Handler | undefined>,
  deps: ReadonlyArray<unknown> = [],
  enabled: boolean = true,
) {
  // High-sev fix: keep the handler map in a ref so hotkeys always call
  // the latest closure. Previously, callers who omitted `deps` (most
  // callers) got a stale map captured on mount — pressing a shortcut
  // fired the old handler and referenced stale state.
  const mapRef = useRef(map);
  mapRef.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
        if (target.closest?.("[data-shortcut-ignore]")) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key === "?" ? "?" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const handler = mapRef.current[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}