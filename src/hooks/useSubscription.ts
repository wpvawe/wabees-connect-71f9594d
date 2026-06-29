import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { toIso } from "@/lib/firebase/normalizers";

export type Subscription = {
  id: string;
  planId: string;
  planName: string;
  status: string;
  messagesUsed: number;
  contactsUsed: number;
  campaignsUsed: number;
  botsUsed: number;
  templatesUsed: number;
  aiMessagesUsed: number;
  maxMessages: number;
  maxContacts: number;
  maxCampaigns: number;
  maxBots: number;
  maxTemplates: number;
  maxAiMessages: number;
  expiryType: string;
  expiryDays: number;
  startDate: string | null;
  endDate: string | null;
  cancelledAt: string | null;
  activatedAt: string | null;
  createdAt: string | null;
  pendingPlanId?: string | null;
  pendingPlanName?: string | null;
};

function num(x: unknown, fallback = 0): number {
  return typeof x === "number" ? x : fallback;
}

function str(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

export function useSubscription(): { data: Subscription | null; loading: boolean; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    const db = fbDbOrNull();
    if (!db) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "users", uid, "subscription", "current"),
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setData(null);
          return;
        }
        const x = snap.data() as Record<string, unknown>;
        setData({
          id: snap.id,
          planId: str(x.planId),
          planName: str(x.planName),
          status: str(x.status, "active"),
          messagesUsed: num(x.messagesUsed),
          contactsUsed: num(x.contactsUsed),
          campaignsUsed: num(x.campaignsUsed),
          botsUsed: num(x.botsUsed),
          templatesUsed: num(x.templatesUsed),
          aiMessagesUsed: num(x.aiMessagesUsed),
          maxMessages: num(x.maxMessages, 1000),
          maxContacts: num(x.maxContacts, 100),
          maxCampaigns: num(x.maxCampaigns, 5),
          maxBots: num(x.maxBots, 2),
          maxTemplates: num(x.maxTemplates, 10),
          maxAiMessages: num(x.maxAiMessages, 300),
          expiryType: str(x.expiryType, "monthly"),
          expiryDays: num(x.expiryDays, 30),
          startDate: toIso(x.startDate),
          endDate: toIso(x.endDate),
          cancelledAt: toIso(x.cancelledAt),
          activatedAt: toIso(x.activatedAt),
          createdAt: toIso(x.createdAt),
          pendingPlanId: str(x.pendingPlanId) || null,
          pendingPlanName: str(x.pendingPlanName) || null,
        });
      },
      (err) => {
        setLoading(false);
        setError(err.message);
      },
    );
    return () => unsub();
  }, [uid]);

  return { data, loading, error };
}