/**
 * Dashboard-only preview reader. The dashboard's "Latest …" cards show
 * at most 5 rows each. Mounting `useContacts` (2000 docs), `useBots`
 * (200), `useCampaigns` (100) and the live 200-doc `useConversations`
 * listener JUST to `.slice(0, 5)` was burning 2000+ reads on every
 * dashboard refresh. This hook runs 4 tiny `limit(5)` getDocs in
 * parallel and caches for 5 minutes per uid.
 *
 * Totals (used in the usage stat cards) come from the pre-aggregated
 * counters on the owner's user doc via `useUsageCounts` — no extra
 * reads needed.
 */
import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { listOfStrings, normalizePhone, str, strOrNull, toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

export type PreviewConversation = {
  contactPhone: string;
  contactName: string;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
};
export type PreviewContact = {
  id: string;
  name: string;
  phone: string;
  createdAt: string | null;
};
export type PreviewBot = {
  id: string;
  name: string;
  isActive: boolean;
  totalTriggered: number;
  updatedAt: string | null;
  createdAt: string | null;
};

export type DashboardPreview = {
  conversations: PreviewConversation[];
  contacts: PreviewContact[];
  bots: PreviewBot[];
};

const EMPTY: DashboardPreview = { conversations: [], contacts: [], bots: [] };
const TTL_MS = 5 * 60_000;

type Entry = { at: number; data: DashboardPreview };
const CACHE = new Map<string, Entry>();
const INFLIGHT = new Map<string, Promise<DashboardPreview>>();

async function loadPreview(uid: string): Promise<DashboardPreview> {
  const db = fbDbOrNull();
  if (!db) return EMPTY;
  const hit = CACHE.get(uid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const existing = INFLIGHT.get(uid);
  if (existing) return existing;
  const p = (async () => {
    try {
      const [convSnap, contactSnap, botSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, `users/${uid}/conversations`),
            orderBy("lastMessageAt", "desc"),
            limit(5),
          ),
        ),
        getDocs(
          query(
            collection(db, `users/${uid}/contacts`),
            orderBy("createdAt", "desc"),
            limit(5),
          ),
        ),
        getDocs(
          query(
            collection(db, `users/${uid}/bots`),
            orderBy("createdAt", "desc"),
            limit(5),
          ),
        ),
      ]);
      const data: DashboardPreview = {
        conversations: convSnap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const phone = normalizePhone(d.id || str(x.contactPhone));
          return {
            contactPhone: phone,
            contactName: str(x.contactName, phone),
            lastMessage: str(x.lastMessage),
            lastMessageAt: toIso(x.lastMessageAt),
            unreadCount: typeof x.unreadCount === "number" ? x.unreadCount : 0,
          };
        }),
        contacts: contactSnap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const phone = str(x.phone, d.id);
          return {
            id: d.id,
            name: str(x.name, phone || d.id),
            phone: phone ? normalizePhone(phone) : "",
            createdAt: toIso(x.createdAt),
          };
        }),
        bots: botSnap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: str(x.name, "Untitled bot"),
            isActive: x.isActive !== false,
            totalTriggered: typeof x.totalTriggered === "number" ? x.totalTriggered : 0,
            updatedAt: toIso(x.updatedAt),
            createdAt: toIso(x.createdAt),
          };
        }),
      };
      // touched to keep types happy (listOfStrings/strOrNull kept for future extension)
      void listOfStrings;
      void strOrNull;
      CACHE.set(uid, { at: Date.now(), data });
      return data;
    } finally {
      INFLIGHT.delete(uid);
    }
  })();
  INFLIGHT.set(uid, p);
  return p;
}

function invalidate(uid: string): void {
  CACHE.delete(uid);
}

/**
 * BUG-18 fix — wipe the module-level CACHE + INFLIGHT maps on logout so
 * a new signed-in user on the same tab doesn't see the previous user's
 * dashboard preview (5-min TTL previously bled across accounts).
 */
export function clearDashboardPreviewCache(): void {
  CACHE.clear();
  INFLIGHT.clear();
}

export function useDashboardPreview(): {
  data: DashboardPreview;
  loading: boolean;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<DashboardPreview>(EMPTY);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!uid) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const next = await loadPreview(uid);
      if (cancelled) return;
      setData(next);
      setLoading(false);
    };
    void run();
    const unsubs = [
      subscribeRefetch("contacts", () => {
        invalidate(uid);
        void run();
      }),
      subscribeRefetch("bots", () => {
        invalidate(uid);
        void run();
      }),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [uid]);

  return { data, loading };
}
