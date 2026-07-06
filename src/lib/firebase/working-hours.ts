/**
 * Batch F6 — Per-agent Working Hours & auto-away routing.
 *
 * Owner sets a weekly schedule on each agent doc; the round-robin/skills
 * picker prefers agents currently within their window so off-hours teammates
 * don't get auto-assigned. Manual assignment is unaffected — owners can
 * always override.
 *
 * Schedule shape (stored at users/{owner}/agents/{agentId}.workingHours):
 *   {
 *     tz: "Asia/Karachi",     // IANA zone; null → treat as always on
 *     days: {                 // 0=Sun … 6=Sat
 *       1: [{ start: "09:00", end: "18:00" }],
 *       2: [{ start: "09:00", end: "18:00" }],
 *       ...
 *     }
 *   }
 *
 * A missing entry for a weekday means "off that day".
 */
import { doc, setDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

export type HoursSlot = { start: string; end: string }; // "HH:mm"
export type WorkingHours = {
  tz: string | null;
  days: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, HoursSlot[]>>;
};

export const DAY_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export const DEFAULT_WEEKDAY_9_TO_6: WorkingHours = {
  tz: null,
  days: {
    1: [{ start: "09:00", end: "18:00" }],
    2: [{ start: "09:00", end: "18:00" }],
    3: [{ start: "09:00", end: "18:00" }],
    4: [{ start: "09:00", end: "18:00" }],
    5: [{ start: "09:00", end: "18:00" }],
  },
};

function minutesFromTime(t: string): number {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

/**
 * Convert `now` into (weekday, minutesSinceMidnight) inside `tz`.
 * Falls back to the runtime zone when tz is null/invalid.
 */
function localizeNow(now: Date, tz: string | null): { day: number; mins: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz ?? undefined,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { day: map[wd] ?? now.getDay(), mins: hh * 60 + (Number.isFinite(mm) ? mm : 0) };
  } catch {
    return { day: now.getDay(), mins: now.getHours() * 60 + now.getMinutes() };
  }
}

/** True when `now` falls inside any slot of the schedule. Null/empty → true (always on). */
export function isWithinWorkingHours(hours: WorkingHours | null | undefined, now: Date = new Date()): boolean {
  if (!hours || !hours.days || Object.keys(hours.days).length === 0) return true;
  const { day, mins } = localizeNow(now, hours.tz);
  const slots = hours.days[day as 0 | 1 | 2 | 3 | 4 | 5 | 6];
  if (!slots || slots.length === 0) return false;
  return slots.some((s) => {
    const a = minutesFromTime(s.start);
    const b = minutesFromTime(s.end);
    if (a < 0 || b < 0) return false;
    // Handle overnight spans (e.g. 22:00 → 02:00) by wrapping.
    if (b >= a) return mins >= a && mins < b;
    return mins >= a || mins < b;
  });
}

/** Owner-only write. */
export async function saveAgentWorkingHours(
  ownerUid: string,
  agentId: string,
  hours: WorkingHours | null,
): Promise<void> {
  await setDoc(
    doc(fbDb(), `users/${ownerUid}/agents/${agentId}`),
    { workingHours: hours },
    { merge: true },
  );
  const { bumpRefetch } = await import("./refetchBus");
  bumpRefetch("agents");
}

/** Sanitize an incoming schedule (drop invalid slots, sort, dedupe). */
export function normalizeWorkingHours(input: WorkingHours): WorkingHours {
  const days: WorkingHours["days"] = {};
  for (const key of Object.keys(input.days ?? {})) {
    const d = Number(key) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    if (d < 0 || d > 6) continue;
    const raw = input.days[d] ?? [];
    const cleaned = raw
      .map((s) => ({ start: (s.start || "").slice(0, 5), end: (s.end || "").slice(0, 5) }))
      .filter((s) => minutesFromTime(s.start) >= 0 && minutesFromTime(s.end) >= 0);
    if (cleaned.length > 0) days[d] = cleaned;
  }
  return { tz: input.tz?.trim() || null, days };
}