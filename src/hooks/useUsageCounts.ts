import { useProfile } from "@/hooks/useProfile";
import { useSubscription } from "@/hooks/useSubscription";

export type UsageCounts = {
  messages: number;
  contacts: number;
  campaigns: number;
  bots: number;
};

const emptyCounts: UsageCounts = {
  messages: 0,
  contacts: 0,
  campaigns: 0,
  bots: 0,
};

/**
 * Cost-optimised usage counts. Reads the pre-aggregated counters that the
 * PHP webhook + client mutations already maintain on the owner's user doc
 * (totalMessages, totalContacts, totalCampaigns, totalBots) — reusing the
 * existing useProfile listener so this hook adds ZERO extra Firestore reads.
 *
 * Previously called getCountFromServer() on 4 collections per mount, which
 * scales linearly with collection size and re-billed on every dashboard visit.
 */
export function useUsageCounts(): { data: UsageCounts; loading: boolean; error: string | null } {
  const { data: profile, loading, error } = useProfile("effective");
  const { data: sub } = useSubscription();
  const data: UsageCounts = profile
    ? {
        messages: Math.max(sub?.messagesUsed ?? 0, profile.totalMessages ?? 0),
        contacts: Math.max(sub?.contactsUsed ?? 0, profile.totalContacts ?? 0),
        campaigns: Math.max(sub?.campaignsUsed ?? 0, profile.totalCampaigns ?? 0),
        bots: Math.max(sub?.botsUsed ?? 0, profile.totalBots ?? 0),
      }
    : emptyCounts;
  return { data, loading, error };
}