import { useProfile } from "@/hooks/useProfile";
import { useSubscription } from "@/hooks/useSubscription";

export type UsageCounts = {
  /** Billing-period usage — resets when admin resets counters. Source: subscription/current.*Used */
  messages: number;
  contacts: number;
  campaigns: number;
  bots: number;
  /** Lifetime totals — never reset. Source: users/{uid}.total* */
  totalMessages: number;
  totalContacts: number;
  totalCampaigns: number;
  totalBots: number;
};

const emptyCounts: UsageCounts = {
  messages: 0,
  contacts: 0,
  campaigns: 0,
  bots: 0,
  totalMessages: 0,
  totalContacts: 0,
  totalCampaigns: 0,
  totalBots: 0,
};

/**
 * Usage counters split into TWO buckets:
 *  - `messages` / `contacts` / `campaigns` / `bots` → **billing-period** usage
 *    from `subscription/current` (reset on admin action / new billing cycle).
 *  - `totalMessages` / `totalContacts` / ... → **lifetime** totals from the
 *    user doc (never reset, incremented by PHP webhook + client mutations).
 *
 * Previously we did `Math.max(sub.messagesUsed, profile.totalMessages)`
 * which fused the two — after one plan activation `totalMessages` was
 * always larger, so the UI always showed the lifetime count as the
 * billing-period usage (BUG-08). Fixed by keeping them separate.
 *
 * Adds ZERO extra Firestore reads — reuses `useProfile` and `useSubscription`.
 */
export function useUsageCounts(): { data: UsageCounts; loading: boolean; error: string | null } {
  const { data: profile, loading, error } = useProfile("effective");
  const { data: sub } = useSubscription();
  const data: UsageCounts = profile
    ? {
        messages: sub?.messagesUsed ?? 0,
        contacts: sub?.contactsUsed ?? 0,
        campaigns: sub?.campaignsUsed ?? 0,
        bots: sub?.botsUsed ?? 0,
        totalMessages: profile.totalMessages ?? 0,
        totalContacts: profile.totalContacts ?? 0,
        totalCampaigns: profile.totalCampaigns ?? 0,
        totalBots: profile.totalBots ?? 0,
      }
    : emptyCounts;
  return { data, loading, error };
}