import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  where,
} from "firebase/firestore";
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
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
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
    const q = query(collection(db, "admin_notifications"), orderBy("createdAt", "desc"));
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
    );
    const unsub = onSnapshot(q, (snap) => {
      setData(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const sub = (x.subscription as Record<string, unknown>) ?? {};
          return {
            id: d.id,
            userId: (x.userId as string) ?? d.id,
            userName: (x.userName as string) ?? "",
            userEmail: (x.userEmail as string) ?? "",
            userPhone: (x.userPhone as string) ?? "",
            requestedAt: toIso(x.requestedAt),
            planId: (sub.planId as string) ?? "",
            planName: (sub.planName as string) ?? "",
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
};

export function useAdminSupportChats(): { data: AdminChatRow[] | null } {
  const [data, setData] = useState<AdminChatRow[] | null>(null);
  useEffect(() => {
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, "support_chats"), orderBy("lastMessageAt", "desc"));
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
    const q = query(
      collection(db, "support_chats", chatId, "messages"),
      orderBy("createdAt", "asc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setData(
        snap.docs.map((d) => {
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
        }),
      );
    });
    return () => unsub();
  }, [chatId]);
  return { data };
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
