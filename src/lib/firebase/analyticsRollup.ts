/**
 * Daily analytics rollup cache for `useAnalytics`.
 *
 * Strategy: keep raw `users/{uid}/messages` untouched, but cache one
 * pre-aggregated doc per calendar day at
 * `users/{uid}/analytics_daily/{YYYY-MM-DD}`. Past days are computed once
 * and reused forever; today's doc is always recomputed on load.
 *
 * Firestore client SDK only — no admin, no cloud functions. Writes land
 * under `users/{uid}/…` which is already covered by per-user rules.
 */
import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

export type DayAggregate = {
  date: string; // YYYY-MM-DD
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  incoming: number;
  outgoing: number;
  byType: Record<string, number>;
  contacts: Record<string, { name: string; count: number }>;
};

export const ROLLUP_SOURCE = "client-rollup-v1";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayId(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayIdsForRange(start: Date, end: Date): string[] {
  const ids: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    ids.push(dayId(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return ids;
}

function parseDayId(id: string): Date {
  const [y, m, d] = id.split("-").map((x) => Number(x));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "object" && v && "seconds" in (v as Record<string, unknown>)) {
    return new Date((v as { seconds: number }).seconds * 1000);
  }
  return null;
}

/** Batched `documentId() in [...]` fetch (10 per query — Firestore limit). */
export async function fetchCachedDays(
  db: Firestore,
  uid: string,
  ids: string[],
): Promise<Map<string, DayAggregate>> {
  const out = new Map<string, DayAggregate>();
  if (ids.length === 0) return out;
  const col = collection(db, `users/${uid}/analytics_daily`);
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const q = query(col, where(documentId(), "in", chunk));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const x = d.data() as Partial<DayAggregate>;
      out.set(d.id, {
        date: d.id,
        sent: Number(x.sent ?? 0),
        delivered: Number(x.delivered ?? 0),
        read: Number(x.read ?? 0),
        failed: Number(x.failed ?? 0),
        pending: Number(x.pending ?? 0),
        incoming: Number(x.incoming ?? 0),
        outgoing: Number(x.outgoing ?? 0),
        byType: (x.byType as Record<string, number>) ?? {},
        contacts:
          (x.contacts as Record<string, { name: string; count: number }>) ?? {},
      });
    }
  }
  return out;
}

type RawMsg = {
  direction: "incoming" | "outgoing";
  status: string;
  type: string;
  createdAt: Date;
  contactPhone: string;
  contactName: string;
  deliveredAt: Date | null;
  readAt: Date | null;
};

/**
 * Fetches messages in `[start, endExclusive)` and buckets into per-day
 * aggregates. Capped by `hardLimit` — days at the tail may be under-counted
 * on very chatty accounts, matching the previous hook's behaviour.
 */
export async function computeDaysFromMessages(
  db: Firestore,
  uid: string,
  start: Date,
  endExclusive: Date,
  hardLimit = 5000,
): Promise<Map<string, DayAggregate>> {
  const q = query(
    collection(db, `users/${uid}/messages`),
    where("createdAt", ">=", Timestamp.fromDate(start)),
    where("createdAt", "<", Timestamp.fromDate(endExclusive)),
  );
  const snap = await getDocs(q);
  const rows: RawMsg[] = [];
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const created = toDate(x.createdAt);
    if (!created) continue;
    rows.push({
      direction:
        (x.direction as string) === "outgoing" ? "outgoing" : "incoming",
      status: String(x.status ?? "sent"),
      type: String(x.type ?? "text"),
      createdAt: created,
      contactPhone: String(x.contactPhone ?? ""),
      contactName: String(x.contactName ?? x.contactPhone ?? ""),
      deliveredAt: toDate(x.deliveredAt),
      readAt: toDate(x.readAt),
    });
    if (rows.length >= hardLimit) break;
  }

  const days = new Map<string, DayAggregate>();
  const blank = (date: string): DayAggregate => ({
    date,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    pending: 0,
    incoming: 0,
    outgoing: 0,
    byType: {},
    contacts: {},
  });

  for (const r of rows) {
    const id = dayId(r.createdAt);
    const day = days.get(id) ?? blank(id);
    day.byType[r.type] = (day.byType[r.type] ?? 0) + 1;
    const key = r.contactPhone || "unknown";
    const c = day.contacts[key] ?? { name: r.contactName || key, count: 0 };
    c.count += 1;
    day.contacts[key] = c;
    if (r.direction === "incoming") {
      day.incoming += 1;
    } else {
      day.outgoing += 1;
      const s = r.status.toLowerCase();
      if (s === "failed" || s === "error") {
        day.failed += 1;
      } else if (s === "pending" || s === "queued" || s === "sending") {
        day.pending += 1;
      } else {
        day.sent += 1;
        if (r.deliveredAt || s === "delivered" || s === "read") day.delivered += 1;
        if (r.readAt || s === "read") day.read += 1;
      }
    }
    days.set(id, day);
  }
  return days;
}

/** Cap contacts map to top-N by count to bound doc size. */
function capContacts(
  contacts: Record<string, { name: string; count: number }>,
  cap = 200,
): Record<string, { name: string; count: number }> {
  const entries = Object.entries(contacts);
  if (entries.length <= cap) return contacts;
  entries.sort((a, b) => b[1].count - a[1].count);
  const out: Record<string, { name: string; count: number }> = {};
  for (const [k, v] of entries.slice(0, cap)) out[k] = v;
  return out;
}

/**
 * Writes computed day aggregates. Skips future days. Uses a single batched
 * write per 400 docs to keep write count low.
 */
export async function writeDayAggregates(
  db: Firestore,
  uid: string,
  days: Map<string, DayAggregate>,
): Promise<void> {
  if (days.size === 0) return;
  const todayId = dayId(new Date());
  const items = Array.from(days.values()).filter((d) => d.date <= todayId);
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db);
    for (const day of items.slice(i, i + 400)) {
      const ref = doc(db, `users/${uid}/analytics_daily/${day.date}`);
      batch.set(ref, {
        ...day,
        contacts: capContacts(day.contacts),
        computedAt: Timestamp.now(),
        source: ROLLUP_SOURCE,
      });
    }
    await batch.commit();
  }
}

/**
 * Convenience: given the requested range, returns aggregates for every day
 * in the range, using the cache where possible and recomputing today.
 * Days that fall in the future (or before any messages exist) are returned
 * as zero-filled placeholders — callers should treat missing days as zero.
 */
export async function loadRangeAggregates(
  db: Firestore,
  uid: string,
  start: Date,
  end: Date,
): Promise<Map<string, DayAggregate>> {
  const ids = dayIdsForRange(start, end);
  if (ids.length === 0) return new Map();

  const todayId = dayId(new Date());
  const cached = await fetchCachedDays(db, uid, ids);

  // Recompute today (stale) + any missing past days.
  const needIds = ids.filter((id) => id === todayId || !cached.has(id));

  if (needIds.length > 0) {
    const earliest = parseDayId(needIds[0]);
    const latest = parseDayId(needIds[needIds.length - 1]);
    const endExclusive = new Date(
      latest.getFullYear(),
      latest.getMonth(),
      latest.getDate() + 1,
    );
    const fresh = await computeDaysFromMessages(db, uid, earliest, endExclusive);
    // Ensure every needed day exists (zeros for days with no messages) so
    // we cache the fact that the day was computed.
    for (const id of needIds) {
      if (!fresh.has(id)) {
        fresh.set(id, {
          date: id,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          pending: 0,
          incoming: 0,
          outgoing: 0,
          byType: {},
          contacts: {},
        });
      }
    }
    // Persist (fire-and-forget error handling — reads still work).
    void writeDayAggregates(db, uid, fresh).catch(() => {});
    for (const [id, day] of fresh) cached.set(id, day);
  }

  return cached;
}