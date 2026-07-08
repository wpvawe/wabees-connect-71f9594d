import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  getCountFromServer,
  getAggregateFromServer,
  sum,
  limit,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  where,
} from "firebase/firestore";
import { getDoc } from "firebase/firestore";
import { fbDb, fbDbOrNull } from "@/integrations/firebase/client";
import { toIso } from "@/lib/firebase/normalizers";
import { fetchCached } from "@/lib/firebase/countCache";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";

// ============ ALL USERS (REALTIME) ============
export type AdminUser = {
  id: string;
  email: string;
  businessName: string;
  phoneNumber: string;
  profileImageUrl: string | null;
  role: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  totalMessages: number;
  totalContacts: number;
  totalBots: number;
  totalCampaigns: number;
  whatsappConnected: boolean;
  whatsappPhoneNumberId: string | null;
  whatsappWabaId: string | null;
  isOnline: boolean;
  aiBotEnabled: boolean;
  /** BUG-03 flag maintained by ensureWelcomeSubscription / admin plan actions. */
  hasSubscription: boolean | null;
};

function toAdminUser(id: string, d: Record<string, unknown>): AdminUser {
  return {
    id,
    email: (d.email as string) ?? "",
    businessName: (d.businessName as string) ?? "",
    phoneNumber: (d.phoneNumber as string) ?? (d.phone as string) ?? "",
    profileImageUrl: (d.profileImageUrl as string | null) ?? null,
    role: (d.role as string) ?? "user",
    status: (d.status as string) ?? "active",
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    totalMessages: (d.totalMessages as number) ?? 0,
    totalContacts: (d.totalContacts as number) ?? 0,
    totalBots: (d.totalBots as number) ?? 0,
    totalCampaigns: (d.totalCampaigns as number) ?? 0,
    whatsappConnected: d.whatsappConnected === true,
    whatsappPhoneNumberId: (d.whatsappPhoneNumberId as string | null) ?? null,
    whatsappWabaId: (d.whatsappWabaId as string | null) ?? null,
    isOnline: d.isOnline === true,
    aiBotEnabled: Boolean(d.aiBotEnabled),
    hasSubscription: typeof d.hasSubscription === "boolean" ? d.hasSubscription : null,
  };
}

export function useAllUsers(): { data: AdminUser[] | null; error: string | null } {
  const [data, setData] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    // Was onSnapshot (200 docs streamed on every isOnline heartbeat /
    // totalMessages increment — massive quota drain).
    // Now:
    //  1. sessionStorage cache (60s) so admin nav in/out doesn't re-fire
    //     the 200-doc read every mount — this was the #1 billed query.
    //  2. Refetch only on explicit admin mutations via refetchBus, NOT on
    //     visibility change (tab-switch spam re-read all 200 docs).
    let cancelled = false;
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"), limit(200));
    const CACHE_KEY = "wb:adminUsers:v1";
    const TTL_MS = 60_000;
    type CachedShape = { at: number; rows: AdminUser[] };
    function readCache(): CachedShape | null {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedShape;
        if (!parsed || typeof parsed.at !== "number") return null;
        return parsed;
      } catch {
        return null;
      }
    }
    function writeCache(rows: AdminUser[]): void {
      if (typeof window === "undefined") return;
      try {
        window.sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ at: Date.now(), rows }),
        );
      } catch {
        /* ignore quota */
      }
    }
    async function load(force = false) {
      if (!force) {
        const cached = readCache();
        if (cached && Date.now() - cached.at < TTL_MS) {
          setData(cached.rows);
          return;
        }
        if (cached) {
          // Serve stale immediately for instant paint, then refresh.
          setData(cached.rows);
        }
      }
      try {
        const snap = await getDocs(q);
        if (cancelled) return;
        const rows = snap.docs.map((d) => toAdminUser(d.id, d.data() as Record<string, unknown>));
        writeCache(rows);
        setData(rows);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void load();
    const unsubBus = subscribeRefetch("adminUsers", () => void load(true));
    return () => {
      cancelled = true;
      unsubBus();
    };
  }, []);
  return { data, error };
}

export function useUserById(uid: string | null): { data: AdminUser | null } {
  const [data, setData] = useState<AdminUser | null>(null);
  useEffect(() => {
    if (!uid) {
      setData(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
      if (!snap.exists()) {
        setData(null);
        return;
      }
      setData(toAdminUser(snap.id, snap.data() as Record<string, unknown>));
    });
    return () => unsub();
  }, [uid]);
  return { data };
}

// ============ PLATFORM STATS ============
export type PlatformStats = {
  totalUsers: number;
  activeUsers: number;
  pendingUsers: number;
  suspendedUsers: number;
  connectedUsers: number;
  onlineUsers: number;
  totalMessages: number;
  totalContacts: number;
  totalCampaigns: number;
};

export function usePlatformStats(users: AdminUser[] | null): PlatformStats {
  return useMemo(() => {
    const list = users ?? [];
    const stats: PlatformStats = {
      totalUsers: list.length,
      activeUsers: 0,
      pendingUsers: 0,
      suspendedUsers: 0,
      connectedUsers: 0,
      onlineUsers: 0,
      totalMessages: 0,
      totalContacts: 0,
      totalCampaigns: 0,
    };
    for (const u of list) {
      if (u.status === "active") stats.activeUsers++;
      else if (u.status === "pending") stats.pendingUsers++;
      else if (u.status === "suspended") stats.suspendedUsers++;
      if (u.whatsappConnected) stats.connectedUsers++;
      if (u.isOnline) stats.onlineUsers++;
      stats.totalMessages += u.totalMessages;
      stats.totalContacts += u.totalContacts;
      stats.totalCampaigns += u.totalCampaigns;
    }
    return stats;
  }, [users]);
}

// ============ ADMIN NOTIFICATIONS ============
export type AdminNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string | null;
  data: Record<string, unknown>;
};

export function useAdminNotifications(): {
  notifications: AdminNotification[];
  unreadCount: number;
  markAllRead: () => Promise<number>;
} {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, "admin_notifications"), orderBy("createdAt", "desc"), limit(100));
    // One-shot fetch + polling + focus refresh instead of a live stream.
    // Admin notifications don't need sub-second latency; a 60s poll is fine.
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDocs(q);
        if (cancelled) return;
        setNotifications(
          snap.docs.slice(0, 50).map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              title: (x.title as string) ?? "",
              body: (x.body as string) ?? "",
              type: (x.type as string) ?? "",
              read: x.read === true,
              createdAt: toIso(x.createdAt),
              data: (x.data as Record<string, unknown>) ?? {},
            };
          }),
        );
      } catch {
        /* ignore */
      }
    }
    void load();
    const timer = window.setInterval(load, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    const unsubBus = subscribeRefetch("adminNotifications", () => void load());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      unsubBus();
    };
  }, []);
  const unreadCount = notifications.filter((n) => !n.read).length;
  // Full-collection markAllRead: fetches every unread doc (not just the loaded
  // 50) and commits in 500-op batches so a large backlog still gets cleared.
  async function markAllRead(): Promise<number> {
    const db = fbDb();
    const snap = await getDocs(
      query(collection(db, "admin_notifications"), where("read", "==", false)),
    );
    if (snap.empty) return 0;
    let committed = 0;
    const CHUNK = 400;
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const d of snap.docs.slice(i, i + CHUNK)) {
        batch.update(d.ref, { read: true });
      }
      await batch.commit();
      committed += Math.min(CHUNK, snap.docs.length - i);
    }
    return committed;
  }
  return { notifications, unreadCount, markAllRead };
}

// ============ PENDING SUBSCRIPTIONS ============
export type PendingSubRow = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  requestedAt: string | null;
  planId: string;
  planName: string;
};

export function usePendingSubscriptions(): { data: PendingSubRow[] | null } {
  const [data, setData] = useState<PendingSubRow[] | null>(null);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(
      collection(db, "pending_subscriptions"),
      orderBy("requestedAt", "desc"),
      limit(100),
    );
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDocs(q);
        if (cancelled) return;
        setData(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              userId: (x.userId as string) ?? d.id,
              userName: (x.userName as string) ?? "",
              userEmail: (x.userEmail as string) ?? "",
              userPhone: (x.userPhone as string) ?? "",
              requestedAt: toIso(x.requestedAt),
              planId: (x.planId as string) ?? "",
              planName: (x.planName as string) ?? "",
            };
          }),
        );
      } catch {
        /* ignore */
      }
    }
    void load();
    const timer = window.setInterval(load, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    const unsubBus = subscribeRefetch("pendingSubs", () => void load());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      unsubBus();
    };
  }, []);
  return { data };
}

// ============ ADMIN SUPPORT CHATS ============
export type AdminChatRow = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadByAdmin: number;
  userOnline: boolean;
  status: string;
  priority: string;
};

export function useAdminSupportChats(): { data: AdminChatRow[] | null } {
  const [data, setData] = useState<AdminChatRow[] | null>(null);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, "support_chats"), orderBy("lastMessageAt", "desc"), limit(100));
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDocs(q);
        if (cancelled) return;
        setData(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              userId: (x.userId as string) ?? d.id,
              userName: (x.userName as string) ?? (x.userEmail as string) ?? d.id,
              userEmail: (x.userEmail as string) ?? "",
              lastMessage: (x.lastMessage as string) ?? "",
              lastMessageAt: toIso(x.lastMessageAt),
              unreadByAdmin: (x.unreadByAdmin as number) ?? 0,
              userOnline: x.userOnline === true,
              status: (x.status as string) ?? "open",
              priority: (x.priority as string) ?? "normal",
            };
          }),
        );
      } catch {
        if (!cancelled) setData([]);
      }
    }
    void load();
    const timer = window.setInterval(load, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    const unsubBus = subscribeRefetch("supportChats", () => void load());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      unsubBus();
    };
  }, []);
  return { data };
}

export type AdminChatMessage = {
  id: string;
  senderId: string;
  senderRole: "user" | "admin";
  text: string;
  imageUrl: string | null;
  read: boolean;
  createdAt: string | null;
};

export function useAdminSupportMessages(chatId: string | null): { data: AdminChatMessage[] | null } {
  const [data, setData] = useState<AdminChatMessage[] | null>(null);
  useEffect(() => {
    if (!chatId) {
      setData(null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    // Cap the live stream. Very long chats otherwise re-stream every
    // historical message on every new reply. We fetch the most recent
    // 300 (descending) and reverse client-side to preserve chat order.
    const q = query(
      collection(db, "support_chats", chatId, "messages"),
      orderBy("createdAt", "desc"),
      limit(300),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            senderId: (x.senderId as string) ?? "",
            senderRole: (x.senderRole === "admin" ? "admin" : "user") as "user" | "admin",
            text: (x.text as string) ?? "",
            imageUrl: (x.imageUrl as string | null) ?? null,
            read: x.read === true,
            createdAt: toIso(x.createdAt),
          };
        });
      setData(rows.reverse());
    });
    return () => unsub();
  }, [chatId]);
  return { data };
}

// ============ PLATFORM COUNTS (server-side aggregation) ============
// The live user stream is capped at 200 rows for read-cost reasons, so we
// can't derive accurate "total users / active / pending / suspended /
// connected" numbers from it once the workspace grows past that cap.
// Firestore's aggregation queries return an exact count without loading
// every doc — one read per aggregate regardless of collection size.
export type PlatformCounts = {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  connected: number;
  agents: number;
  totalMessages: number;
  loading: boolean;
};

export function usePlatformCounts(): PlatformCounts {
  const [counts, setCounts] = useState<PlatformCounts>({
    total: 0,
    active: 0,
    pending: 0,
    suspended: 0,
    connected: 0,
    agents: 0,
    totalMessages: 0,
    loading: true,
  });
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    (async () => {
      try {
        const users = collection(db, "users");
        // Cache for 5 minutes — admin dashboard mounts should not re-fire
        // 7 aggregation RPCs each time. Prevents 429 storms.
        // Pre-extract to plain numbers so the sessionStorage backup in
        // countCache survives a hard reload (raw AggregateQuerySnapshot has
        // methods that JSON.stringify would drop).
        const TTL = 5 * 60_000;
        const countOf = async (q: Parameters<typeof getCountFromServer>[0]) =>
          (await getCountFromServer(q)).data().count;
        const [total, active, pending, suspended, connected, agents, msgSum] = await Promise.all([
          fetchCached<number>("admin:users:total", () => countOf(users), TTL),
          fetchCached<number>("admin:users:active", () => countOf(query(users, where("status", "==", "active"))), TTL),
          fetchCached<number>("admin:users:pending", () => countOf(query(users, where("status", "==", "pending"))), TTL),
          fetchCached<number>("admin:users:suspended", () => countOf(query(users, where("status", "==", "suspended"))), TTL),
          fetchCached<number>("admin:users:connected", () => countOf(query(users, where("whatsappConnected", "==", true))), TTL),
          fetchCached<number>("admin:agents:group", () => countOf(collectionGroup(db, "agents")), TTL).catch((err) => {
            // BUG-13 fix — the `agents` collection-group count was silently
            // swallowing errors and reporting 0. Surface the real cause
            // (permission-denied → rules; failed-precondition → missing
            // index) so admin can diagnose without reading Firebase logs.
            // eslint-disable-next-line no-console
            console.error("[admin] agents collectionGroup count failed:",
              (err as { code?: string })?.code ?? "unknown", (err as Error)?.message ?? err);
            return null;
          }),
          fetchCached<number>(
            "admin:users:msgSum",
            async () => Number((await getAggregateFromServer(users, { total: sum("totalMessages") })).data().total ?? 0),
            TTL,
          ).catch((err) => {
            // eslint-disable-next-line no-console
            console.error("[admin] totalMessages sum failed:", (err as Error)?.message ?? err);
            return null;
          }),
        ]);
        if (cancelled) return;
        setCounts({
          total: total ?? 0,
          active: active ?? 0,
          pending: pending ?? 0,
          suspended: suspended ?? 0,
          connected: connected ?? 0,
          agents: agents ?? 0,
          totalMessages: msgSum ?? 0,
          loading: false,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[admin] usePlatformCounts failed:",
          (err as { code?: string })?.code ?? "unknown", (err as Error)?.message ?? err);
        if (!cancelled) setCounts((c) => ({ ...c, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return counts;
}

// ============ USER SUBSCRIPTION (for admin drawer) ============
export type UserSubscriptionRow = {
  planId: string;
  planName: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  expiryType: string;
  messagesUsed: number;
  maxMessages: number;
  contactsUsed: number;
  maxContacts: number;
  campaignsUsed: number;
  maxCampaigns: number;
  botsUsed: number;
  maxBots: number;
  templatesUsed: number;
  maxTemplates: number;
  aiMessagesUsed: number;
  maxAiMessages: number;
  agentsUsed: number;
  maxAgents: number;
};

export function useUserSubscription(uid: string | null): {
  data: UserSubscriptionRow | null;
  loading: boolean;
} {
  const [data, setData] = useState<UserSubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!uid) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db!, "users", uid!, "subscription", "current"));
        if (cancelled) return;
        setLoading(false);
        if (!snap.exists()) {
          setData(null);
          return;
        }
        const x = snap.data() as Record<string, unknown>;
        setData({
          planId: (x.planId as string) ?? "",
          planName: (x.planName as string) ?? "",
          status: (x.status as string) ?? "unknown",
          startDate: toIso(x.startDate),
          endDate: toIso(x.endDate),
          expiryType: (x.expiryType as string) ?? "monthly",
          messagesUsed: (x.messagesUsed as number) ?? 0,
          maxMessages: (x.maxMessages as number) ?? 0,
          contactsUsed: (x.contactsUsed as number) ?? 0,
          maxContacts: (x.maxContacts as number) ?? 0,
          campaignsUsed: (x.campaignsUsed as number) ?? 0,
          maxCampaigns: (x.maxCampaigns as number) ?? 0,
          botsUsed: (x.botsUsed as number) ?? 0,
          maxBots: (x.maxBots as number) ?? 0,
          templatesUsed: (x.templatesUsed as number) ?? 0,
          maxTemplates: (x.maxTemplates as number) ?? 0,
          aiMessagesUsed: (x.aiMessagesUsed as number) ?? 0,
          maxAiMessages: (x.maxAiMessages as number) ?? 0,
          agentsUsed: (x.agentsUsed as number) ?? 0,
          maxAgents: (x.maxAgents as number) ?? 0,
        });
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    const unsubBus = subscribeRefetch("userSub", () => void load());
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      unsubBus();
    };
  }, [uid]);
  return { data, loading };
}

// ============ CONFIG DOC READER ============
export function useConfigDoc<T extends Record<string, unknown>>(
  path: [string, string],
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db!, path[0], path[1]));
        if (cancelled) return;
        setLoading(false);
        setData(snap.exists() ? ((snap.data() as unknown) as T) : null);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    const unsubBus = subscribeRefetch("configDoc", () => void load());
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      unsubBus();
    };
  }, [path[0], path[1]]);
  return { data, loading };
}

// ============ LIVE PER-USER COUNTS (admin drawer) ============
// Cached `totalMessages/totalContacts/totalBots/totalCampaigns` on the user
// doc are increment-only counters — they don't reflect deletions. For the
// admin's user-detail view we run a server-side aggregate on the actual
// subcollections so the numbers stay truthful after users delete records.
export type UserLiveCounts = {
  messages: number;
  contacts: number;
  bots: number;
  campaigns: number;
  agents: number;
  loading: boolean;
};

export function useUserLiveCounts(uid: string | null): UserLiveCounts {
  const [state, setState] = useState<UserLiveCounts>({
    messages: 0,
    contacts: 0,
    bots: 0,
    campaigns: 0,
    agents: 0,
    loading: true,
  });
  useEffect(() => {
    if (!uid) {
      setState({ messages: 0, contacts: 0, bots: 0, campaigns: 0, agents: 0, loading: false });
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const TTL = 5 * 60_000;
        const countOf = async (path: string[]) =>
          (await getCountFromServer(collection(db, path[0], ...path.slice(1)))).data().count;
        const [messages, contacts, bots, campaigns, agents] = await Promise.all([
          fetchCached<number>(`admin:user:${uid}:messages`, () => countOf(["users", uid, "messages"]), TTL),
          fetchCached<number>(`admin:user:${uid}:contacts`, () => countOf(["users", uid, "contacts"]), TTL),
          fetchCached<number>(`admin:user:${uid}:bots`, () => countOf(["users", uid, "bots"]), TTL),
          fetchCached<number>(`admin:user:${uid}:campaigns`, () => countOf(["users", uid, "campaigns"]), TTL),
          fetchCached<number>(`admin:user:${uid}:agents`, () => countOf(["users", uid, "agents"]), TTL),
        ]);
        if (cancelled) return;
        setState({
          messages: messages ?? 0,
          contacts: contacts ?? 0,
          bots: bots ?? 0,
          campaigns: campaigns ?? 0,
          agents: agents ?? 0,
          loading: false,
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);
  return state;
}

// ============ USERS WITHOUT A SUBSCRIPTION (admin remediation) ============
// Legacy accounts (created before the plans system, or via seed scripts)
// may not have a `users/{uid}/subscription/current` doc. `reserveQuota`
// skips the cap check for these users to avoid locking them out. Rather
// than log to DevTools, we surface them here so an admin can assign a
// plan from the Users section.
export type UserMissingPlan = {
  id: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  createdAt: string | null;
};

export function useUsersWithoutSubscription(users: AdminUser[] | null): {
  data: UserMissingPlan[] | null;
  loading: boolean;
} {
  const [data, setData] = useState<UserMissingPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Stable key: only re-run when the id list actually changes.
  const idsKey = useMemo(
    () => (users ?? []).map((u) => u.id).sort().join("|"),
    [users],
  );
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db || !users) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const missing: UserMissingPlan[] = [];
      // Batch in chunks of 20 so we don't fan out 200 parallel reads at once.
      const CHUNK = 20;
      for (let i = 0; i < users.length; i += CHUNK) {
        if (cancelled) return;
        const slice = users.slice(i, i + CHUNK);
        const SUB_TTL = 15 * 60_000;
        const results = await Promise.all(
          slice.map((u) =>
            fetchCached(
              `admin:userSubExists:${u.id}`,
              () => getDoc(doc(db, "users", u.id, "subscription", "current")).then((s) => s.exists()),
              SUB_TTL,
            )
              .then((exists) => ({ u, exists }))
              .catch(() => ({ u, exists: true })), // on error assume ok
          ),
        );
        for (const { u, exists } of results) {
          if (!exists) {
            missing.push({
              id: u.id,
              businessName: u.businessName,
              email: u.email,
              phoneNumber: u.phoneNumber,
              createdAt: u.createdAt,
            });
          }
        }
      }
      if (cancelled) return;
      setData(missing);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  return { data, loading };
}
