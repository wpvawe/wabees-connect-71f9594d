import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

export type Plan = {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly?: number | null;
  currency: string;
  maxMessages: number;
  maxContacts: number;
  maxCampaigns: number;
  maxBots: number;
  maxTemplates: number;
  maxAiMessages: number;
  maxAgents: number;
  hasAnalytics: boolean;
  hasPrioritySupport: boolean;
  hasApiAccess: boolean;
  features: string[];
  expiryType: string;
  expiryDays: number;
  isActive: boolean;
  sortOrder: number;
  isPopular: boolean;
  isWelcomePlan: boolean;
  createdAt: string | null;
  showOnPublic: boolean;
  offer: PlanOffer | null;
};

export type PlanOffer = {
  active: boolean;
  label: string;
  discountPct: number | null;
  priceOverride: number | null;
  endsAt: string | null;
};

function str(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

function num(x: unknown, fallback = 0): number {
  return typeof x === "number" ? x : fallback;
}

function bool(x: unknown, fallback = false): boolean {
  return typeof x === "boolean" ? x : fallback;
}

function parseOffer(x: unknown): PlanOffer | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const active = bool(o.active);
  const label = str(o.label);
  if (!active && !label) return null;
  return {
    active,
    label: label || "Special offer",
    discountPct: typeof o.discountPct === "number" ? o.discountPct : null,
    priceOverride: typeof o.priceOverride === "number" ? o.priceOverride : null,
    endsAt: toIso(o.endsAt),
  };
}

/**
 * Cross-mount cache for the plans list. Plans change rarely (admin edits),
 * yet every dashboard/plans page mount was firing a full
 * `getDocs(collection("plans"))` — the second-highest billed query in the
 * Firebase usage dashboard. sessionStorage keeps it warm across reloads;
 * `subscribeRefetch("plans")` still forces a refresh after admin mutations.
 */
const PLANS_CACHE_KEY = "wb:plans:v1";
const PLANS_TTL_MS = 10 * 60_000;
type PlansEntry = { at: number; rows: unknown[] };
let memPlans: PlansEntry | null = null;
function readPlansCache(): PlansEntry | null {
  if (memPlans && Date.now() - memPlans.at < PLANS_TTL_MS) return memPlans;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PLANS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlansEntry;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > PLANS_TTL_MS) return null;
    memPlans = parsed;
    return parsed;
  } catch {
    return null;
  }
}
function writePlansCache(rows: unknown[]): void {
  memPlans = { at: Date.now(), rows };
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PLANS_CACHE_KEY, JSON.stringify(memPlans));
  } catch {
    /* ignore */
  }
}
function invalidatePlansCache(): void {
  memPlans = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PLANS_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function shapePlan(id: string, x: Record<string, unknown>): Plan {
  return {
    id,
    name: str(x.name),
    description: str(x.description),
    priceMonthly: num(x.priceMonthly, num(x.price)),
    priceYearly: typeof x.priceYearly === "number" ? x.priceYearly : null,
    currency: str(x.currency, "PKR"),
    maxMessages: num(x.maxMessages),
    maxContacts: num(x.maxContacts),
    maxCampaigns: num(x.maxCampaigns),
    maxBots: num(x.maxBots),
    maxTemplates: num(x.maxTemplates),
    maxAiMessages: num(x.maxAiMessages),
    maxAgents: num(x.maxAgents),
    hasAnalytics: bool(x.hasAnalytics),
    hasPrioritySupport: bool(x.hasPrioritySupport),
    hasApiAccess: bool(x.hasApiAccess),
    features: Array.isArray(x.features)
      ? x.features.filter((v): v is string => typeof v === "string")
      : [],
    expiryType: str(x.expiryType, "monthly"),
    expiryDays: num(x.expiryDays, 30),
    isActive: x.isActive !== false,
    sortOrder: num(x.sortOrder),
    isPopular: bool(x.isPopular),
    isWelcomePlan: bool(x.isWelcomePlan),
    createdAt: toIso(x.createdAt),
    showOnPublic: x.showOnPublic !== false,
    offer: parseOffer(x.offer),
  };
}

export function usePlans(
  opts?: { includeInactive?: boolean; publicOnly?: boolean },
): { data: Plan[] | null; error: string | null } {
  const includeInactive = opts?.includeInactive === true;
  const publicOnly = opts?.publicOnly === true;
  const [data, setData] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyRows = useCallback(
    (raw: Array<{ id: string; x: Record<string, unknown> }>) => {
      const rows: Plan[] = raw
        .map((r) => shapePlan(r.id, r.x))
        .filter((p) => includeInactive || p.isActive)
        .filter((p) => !publicOnly || p.showOnPublic)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.priceMonthly - b.priceMonthly);
      setData(rows);
      setError(null);
    },
    [includeInactive, publicOnly],
  );

  const load = useCallback(async (force = false) => {
    const db = fbDbOrNull();
    if (!db) return;
    if (!force) {
      const cached = readPlansCache();
      if (cached) {
        applyRows(cached.rows as Array<{ id: string; x: Record<string, unknown> }>);
        return;
      }
    }
    try {
      // BUG-25 fix — was doing a full unordered scan and filtering client
      // side. Now let Firestore do the filter + sort so we only pay for
      // the docs we'll actually render. `includeInactive`/`publicOnly`
      // may need to short-circuit to the raw collection since we don't
      // have combined indexes for every permutation.
      let q: Parameters<typeof getDocs>[0] = collection(db, "plans");
      if (publicOnly && !includeInactive) {
        // Uses the `showOnPublic ASC + sortOrder ASC` index already in
        // firestore.indexes.json (line 87-94).
        q = query(
          collection(db, "plans"),
          where("showOnPublic", "==", true),
          orderBy("sortOrder", "asc"),
        );
      } else if (!includeInactive) {
        // Uses the `isActive ASC + sortOrder ASC` index (line 73-86).
        q = query(
          collection(db, "plans"),
          where("isActive", "==", true),
          orderBy("sortOrder", "asc"),
        );
      }
      const snap = await getDocs(q);
      const raw = snap.docs.map((d) => ({ id: d.id, x: d.data() as Record<string, unknown> }));
      writePlansCache(raw);
      applyRows(raw);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [applyRows, includeInactive, publicOnly]);

  useEffect(() => {
    void load();
    const unsub = subscribeRefetch("plans", () => {
      invalidatePlansCache();
      void load(true);
    });
    return () => unsub();
  }, [load]);

  return { data, error };
}
