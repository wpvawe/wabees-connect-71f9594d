import { useEffect, useMemo, useState } from "react";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  dayId,
  dayIdsForRange,
  loadRangeAggregates,
  type DayAggregate,
} from "@/lib/firebase/analyticsRollup";

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
  const [days, setDays] = useState<Map<string, DayAggregate> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const { start, end } = useMemo(() => computeRange(range), [range]);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    setDays(null);
    setError(null);
    let cancelled = false;
    loadRangeAggregates(db, uid, start, end)
      .then((m) => {
        if (!cancelled) setDays(m);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, nonce, start.getTime(), end.getTime()]);

  const data = useMemo<AnalyticsData | null>(() => {
    if (!days) return null;
    const ids = dayIdsForRange(start, end);
    const totals = {
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      pending: 0,
      incoming: 0,
      outgoing: 0,
    };
    const typeMap = new Map<string, number>();
    const contactMap = new Map<string, { name: string; count: number }>();
    const byDay: AnalyticsData["byDay"] = [];
    const todayId = dayId(new Date());

    for (const id of ids) {
      const d = days.get(id);
      if (!d) {
        // Missing day past today shouldn't happen (loader zero-fills), but
        // future days simply render as zero.
        byDay.push({
          date: id.slice(5),
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          incoming: 0,
        });
        continue;
      }
      totals.sent += d.sent;
      totals.delivered += d.delivered;
      totals.read += d.read;
      totals.failed += d.failed;
      totals.pending += d.pending;
      totals.incoming += d.incoming;
      totals.outgoing += d.outgoing;
      for (const [t, n] of Object.entries(d.byType)) {
        typeMap.set(t, (typeMap.get(t) ?? 0) + n);
      }
      for (const [phone, v] of Object.entries(d.contacts)) {
        const cur = contactMap.get(phone);
        if (cur) {
          cur.count += v.count;
          if (!cur.name && v.name) cur.name = v.name;
        } else {
          contactMap.set(phone, { name: v.name, count: v.count });
        }
      }
      byDay.push({
        date: id.slice(5),
        sent: d.sent,
        delivered: d.delivered,
        read: d.read,
        failed: d.failed,
        incoming: d.incoming,
      });
      if (id === todayId) {
        // stop double-counting past-today placeholders below
      }
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
      byDay,
      byType,
      topContacts,
    };
  }, [days, start, end]);

  return {
    data,
    loading: days === null && !error,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
