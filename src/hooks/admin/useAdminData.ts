import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
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
  markAllRead: () => Promise<void>;
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
  async function markAllRead() {
    const db = fbDb();
    const batch = writeBatch(db);
    for (const n of notifications) {
      if (!n.read) batch.update(doc(db, "admin_notifications", n.id), { read: true });
    }
    await batch.commit();
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
    const unsub = onSnapshot(collection(db, "pending_subscriptions"), (snap) => {
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

// keep `where` referenced so tree-shake doesn't drop the import
void where;