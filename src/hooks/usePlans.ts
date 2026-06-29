import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { toIso } from "@/lib/firebase/normalizers";

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

export function usePlans(): { data: Plan[] | null; error: string | null } {
  const [data, setData] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, "plans"),
      (snap) => {
        const rows: Plan[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: str(x.name),
            description: str(x.description),
            priceMonthly: num(x.priceMonthly),
            priceYearly: typeof x.priceYearly === "number" ? x.priceYearly : null,
            currency: str(x.currency, "PKR"),
            maxMessages: num(x.maxMessages, 1000),
            maxContacts: num(x.maxContacts, 100),
            maxCampaigns: num(x.maxCampaigns, 5),
            maxBots: num(x.maxBots, 2),
            maxTemplates: num(x.maxTemplates, 10),
            maxAiMessages: num(x.maxAiMessages, 300),
            hasAnalytics: bool(x.hasAnalytics),
            hasPrioritySupport: bool(x.hasPrioritySupport),
            hasApiAccess: bool(x.hasApiAccess),
            features: Array.isArray(x.features) ? x.features.filter((v): v is string => typeof v === "string") : [],
            expiryType: str(x.expiryType, "monthly"),
            expiryDays: num(x.expiryDays, 30),
            isActive: x.isActive !== false,
            sortOrder: num(x.sortOrder),
            isPopular: bool(x.isPopular),
            isWelcomePlan: bool(x.isWelcomePlan),
            createdAt: toIso(x.createdAt),
          };
        })
          .filter((p) => p.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.priceMonthly - b.priceMonthly);
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, []);

  return { data, error };
}