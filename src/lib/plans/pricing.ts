import type { Plan, PlanOffer } from "@/hooks/usePlans";

export type ResolvedPricing = {
  effectivePrice: number;
  offerActive: boolean;
  discountPct: number | null;
};

/**
 * Compute the price a user actually sees for a plan, factoring in an
 * optional admin-defined offer (discount percentage OR price override).
 * Offers with an `endsAt` in the past are treated as inactive.
 */
export function resolvePricing(plan: Plan): ResolvedPricing {
  const offer = plan.offer;
  if (!offer || !offer.active || !isOfferLive(offer)) {
    return { effectivePrice: plan.priceMonthly, offerActive: false, discountPct: null };
  }
  let price = plan.priceMonthly;
  if (offer.priceOverride != null && offer.priceOverride >= 0) {
    price = offer.priceOverride;
  } else if (offer.discountPct != null && offer.discountPct > 0) {
    price = Math.max(0, Math.round(plan.priceMonthly * (1 - offer.discountPct / 100)));
  }
  return { effectivePrice: price, offerActive: true, discountPct: offer.discountPct };
}

export function isOfferLive(offer: PlanOffer): boolean {
  if (!offer.endsAt) return true;
  const ends = new Date(offer.endsAt).getTime();
  return Number.isFinite(ends) && ends > Date.now();
}

export function formatEndsIn(iso: string): string {
  const ends = new Date(iso).getTime();
  if (!Number.isFinite(ends)) return "";
  const diffMs = ends - Date.now();
  if (diffMs <= 0) return "Offer ended";
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 2) return `Ends in ${days} days`;
  if (days === 1) return "Ends tomorrow";
  const hours = Math.max(1, Math.floor(diffMs / 3_600_000));
  return `Ends in ${hours}h`;
}

export function limitLabel(value: number): string {
  return value <= 0 ? "Unlimited" : String(value);
}