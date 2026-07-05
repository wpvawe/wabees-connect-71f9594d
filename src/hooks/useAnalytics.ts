import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

export type AnalyticsRange = "7d" | "30d" | "month" | "lastMonth";

export type AnalyticsData = {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  incoming: number;
  outgoing: number;
  uniqueContacts: number;
  byDay: Array<{
    date: string;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    incoming: number;
  }>;
  byType: Array<{ type: string; count: number }>;
  topContacts: Array<{ phone: string; name: string; count: number }>;
};

type Row = {
  direction: "incoming" | "outgoing";
  status: string;
  type: string;
  createdAt: Date | null;
  contactPhone: string;
  contactName: string;
  deliveredAt: Date | null;
  readAt: Date | null;
};

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "object" && v && "seconds" in (v as Record<string, unknown>)) {
    const s = (v as { seconds: number }).seconds;
    return new Date(s * 1000);
  }
  return null;
}

export function computeRange(range: AnalyticsRange): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  if (range === "7d") return { start: new Date(now.getTime() - 7 * 86400_000), end };
  if (range === "30d") return { start: new Date(now.getTime() - 30 * 86400_000), end };
  if (range === "month") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
  }
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { start: firstLast, end: firstThis };
}

export function useAnalytics(range: AnalyticsRange): {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const uid = useEffectiveUid();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const { start, end } = useMemo(() => computeRange(range), [range]);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    setRows(null);
    setError(null);
    // P1 fix — was always scanning 90 days regardless of `range`; now push
    // the actual selected window into Firestore so "7d" only reads 7 days.
    let cancelled = false;
    const q = query(
      collection(db, `users/${uid}/messages`),
      where("createdAt", ">=", Timestamp.fromDate(start)),
    );
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const list: Row[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            direction:
              (x.direction as string) === "outgoing" ? "outgoing" : "incoming",
            status: String(x.status ?? "sent"),
            type: String(x.type ?? "text"),
            createdAt: toDate(x.createdAt),
            contactPhone: String(x.contactPhone ?? ""),
            contactName: String(x.contactName ?? x.contactPhone ?? ""),
            deliveredAt: toDate(x.deliveredAt),
            readAt: toDate(x.readAt),
          };
        });
        setRows(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, nonce, start.getTime()]);

  const data = useMemo<AnalyticsData | null>(() => {
    if (!rows) return null;
    const inRange = rows.filter((r) => {
      if (!r.createdAt) return false;
      return r.createdAt >= start && r.createdAt <= end;
    });
    const totals = { sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, incoming: 0, outgoing: 0 };
    const byDayMap = new Map<
      string,
      { sent: number; delivered: number; read: number; failed: number; incoming: number }
    >();
    const typeMap = new Map<string, number>();
    const contactMap = new Map<string, { name: string; count: number }>();

    for (const r of inRange) {
      const date = (r.createdAt as Date).toISOString().slice(0, 10);
      const day = byDayMap.get(date) ?? { sent: 0, delivered: 0, read: 0, failed: 0, incoming: 0 };
      typeMap.set(r.type, (typeMap.get(r.type) ?? 0) + 1);
      const key = r.contactPhone || "unknown";
      const c = contactMap.get(key) ?? { name: r.contactName || key, count: 0 };
      c.count += 1;
      contactMap.set(key, c);

      if (r.direction === "incoming") {
        totals.incoming += 1;
        day.incoming += 1;
      } else {
        totals.outgoing += 1;
        // status ladder — count highest reached
        const s = r.status.toLowerCase();
        if (s === "failed" || s === "error") {
          totals.failed += 1;
          day.failed += 1;
        } else if (s === "pending" || s === "queued" || s === "sending") {
          totals.pending += 1;
        } else {
          totals.sent += 1;
          day.sent += 1;
          if (r.deliveredAt || s === "delivered" || s === "read") {
            totals.delivered += 1;
            day.delivered += 1;
          }
          if (r.readAt || s === "read") {
            totals.read += 1;
            day.read += 1;
          }
        }
      }
      byDayMap.set(date, day);
    }

    // Fill missing days in range with zeros
    const filled: AnalyticsData["byDay"] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cursor <= endDay) {
      const key = cursor.toISOString().slice(0, 10);
      const v = byDayMap.get(key) ?? { sent: 0, delivered: 0, read: 0, failed: 0, incoming: 0 };
      filled.push({ date: key.slice(5), ...v });
      cursor.setDate(cursor.getDate() + 1);
    }

    const byType = Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    const topContacts = Array.from(contactMap.entries())
      .map(([phone, v]) => ({ phone, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      ...totals,
      uniqueContacts: contactMap.size,
      byDay: filled,
      byType,
      topContacts,
    };
  }, [rows, start, end]);

  return {
    data,
    loading: rows === null && !error,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
