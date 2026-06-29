import { useEffect, useState } from "react";
import { WABEES_API_BASE } from "@/integrations/firebase/client";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { fbAuthOrNull } from "@/integrations/firebase/client";

export type InsightPoint = { start: number; end: number; value: number };
export type InsightSeries = { type: string; data_points: InsightPoint[] };

export type AnalyticsData = {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  byDay: Array<{ date: string; sent: number; delivered: number; read: number }>;
};

export function useAnalytics(range: "7d" | "30d" | "month" | "lastMonth"): {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  hasConfig: boolean;
} {
  const { data: wa } = useWhatsAppConfig();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const hasConfig = Boolean(wa?.phone_number_id);

  useEffect(() => {
    if (!hasConfig) return;
    const phoneNumberId = wa!.phone_number_id!;
    const { start, end } = computeRange(range);
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const user = fbAuthOrNull()?.currentUser;
        const idToken = user ? await user.getIdToken() : "";
        const res = await fetch(`${WABEES_API_BASE}/get-insights.php`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_number_id: phoneNumberId, start, end, id_token: idToken }),
        });
        const raw = (await res.json().catch(() => ({}))) as { data?: InsightSeries[]; error?: unknown };
        if (cancelled) return;
        if (!res.ok || raw.error) {
          setError(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        setData(aggregate(raw.data ?? []));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hasConfig, wa, range, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1), hasConfig };
}

function computeRange(range: "7d" | "30d" | "month" | "lastMonth"): { start: number; end: number } {
  const now = new Date();
  const end = Math.floor(now.getTime() / 1000);
  if (range === "7d") return { start: end - 7 * 86400, end };
  if (range === "30d") return { start: end - 30 * 86400, end };
  if (range === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: Math.floor(first.getTime() / 1000), end };
  }
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { start: Math.floor(firstLast.getTime() / 1000), end: Math.floor(firstThis.getTime() / 1000) };
}

function aggregate(series: InsightSeries[]): AnalyticsData {
  const totals = { sent: 0, delivered: 0, read: 0, failed: 0 };
  const byDayMap = new Map<string, { sent: number; delivered: number; read: number }>();
  for (const s of series) {
    const key = s.type?.toUpperCase();
    for (const p of s.data_points ?? []) {
      const v = typeof p.value === "number" ? p.value : 0;
      if (key === "SENT") totals.sent += v;
      else if (key === "DELIVERED") totals.delivered += v;
      else if (key === "READ") totals.read += v;
      else if (key === "FAILED") totals.failed += v;
      const date = new Date((p.start ?? 0) * 1000).toISOString().slice(0, 10);
      const row = byDayMap.get(date) ?? { sent: 0, delivered: 0, read: 0 };
      if (key === "SENT") row.sent += v;
      else if (key === "DELIVERED") row.delivered += v;
      else if (key === "READ") row.read += v;
      byDayMap.set(date, row);
    }
  }
  const byDay = Array.from(byDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
  return { ...totals, byDay };
}