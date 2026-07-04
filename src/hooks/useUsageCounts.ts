import { useProfile } from "@/hooks/useProfile";

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
  const data: UsageCounts = profile
    ? {
        messages: profile.totalMessages ?? 0,
        contacts: profile.totalContacts ?? 0,
        campaigns: profile.totalCampaigns ?? 0,
        bots: profile.totalBots ?? 0,
      }
    : emptyCounts;
  return { data, loading, error };
}