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
  };
}

export function useAllUsers(): { data: AdminUser[] | null; error: string | null } {
  const [data, setData] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    // Cap the realtime stream so an idle admin tab doesn't accumulate reads
    // on every user-doc update (isOnline heartbeat, totalMessages increment).
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => setData(snap.docs.map((d) => toAdminUser(d.id, d.data() as Record<string, unknown>))),
      (err) => setError(err.message),
    );
    return () => unsub();
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
    const unsub = onSnapshot(q, (snap) => {
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
    });
    return () => unsub();
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
    const unsub = onSnapshot(q, (snap) => {
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
    });
    return () => unsub();
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
    const unsub = onSnapshot(
      q,
      (snap) => {
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
      },
      () => setData([]),
    );
    return () => unsub();
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
        const [total, active, pending, suspended, connected, agents, msgSum] = await Promise.all([
          getCountFromServer(users),
          getCountFromServer(query(users, where("status", "==", "active"))),
          getCountFromServer(query(users, where("status", "==", "pending"))),
          getCountFromServer(query(users, where("status", "==", "suspended"))),
          getCountFromServer(query(users, where("whatsappConnected", "==", true))),
          getCountFromServer(collectionGroup(db, "agents")).catch(() => null),
          getAggregateFromServer(users, { total: sum("totalMessages") }).catch(() => null),
        ]);
        if (cancelled) return;
        setCounts({
          total: total.data().count,
          active: active.data().count,
          pending: pending.data().count,
          suspended: suspended.data().count,
          connected: connected.data().count,
          agents: agents ? agents.data().count : 0,
          totalMessages: msgSum ? Number(msgSum.data().total ?? 0) : 0,
          loading: false,
        });
      } catch {
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
        });
      },
      () => setLoading(false),
    );
    return () => unsub();
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
    const unsub = onSnapshot(doc(db, path[0], path[1]), (snap) => {
      setLoading(false);
      setData(snap.exists() ? ((snap.data() as unknown) as T) : null);
    });
    return () => unsub();
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
  loading: boolean;
};

export function useUserLiveCounts(uid: string | null): UserLiveCounts {
  const [state, setState] = useState<UserLiveCounts>({
    messages: 0,
    contacts: 0,
    bots: 0,
    campaigns: 0,
    loading: true,
  });
  useEffect(() => {
    if (!uid) {
      setState({ messages: 0, contacts: 0, bots: 0, campaigns: 0, loading: false });
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const [messages, contacts, bots, campaigns] = await Promise.all([
          getCountFromServer(collection(db, "users", uid, "messages")),
          getCountFromServer(collection(db, "users", uid, "contacts")),
          getCountFromServer(collection(db, "users", uid, "bots")),
          getCountFromServer(collection(db, "users", uid, "campaigns")),
        ]);
        if (cancelled) return;
        setState({
          messages: messages.data().count,
          contacts: contacts.data().count,
          bots: bots.data().count,
          campaigns: campaigns.data().count,
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
