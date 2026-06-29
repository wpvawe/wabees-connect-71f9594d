import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { listOfStrings, normalizePhone, str, strOrNull, toIso } from "@/lib/firebase/normalizers";

export type Conversation = {
  contactPhone: string;
  contactName: string;
  lastMessage: string;
  lastMessageType: string;
  lastMessageAt: string | null;
  unreadCount: number;
  profileImageUrl?: string | null;
  lastIncomingMessageAt?: string | null;
  isPinned?: boolean;
  pinOrder?: number;
  activeChatterId?: string | null;
  activeChatterEmail?: string | null;
  isBlocked?: boolean;
  tags?: string[];
};

export function useConversations(): { data: Conversation[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, `users/${uid}/conversations`), orderBy("lastMessageAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const grouped = new Map<string, Conversation>();
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          const phone = normalizePhone(d.id || str(x.contactPhone));
          if (!phone) continue;
          const row: Conversation = {
            contactPhone: phone,
            contactName: str(x.contactName, phone),
            lastMessage: str(x.lastMessage),
            lastMessageType: str(x.lastMessageType, "text"),
            lastMessageAt: toIso(x.lastMessageAt),
            unreadCount: typeof x.unreadCount === "number" ? x.unreadCount : 0,
            profileImageUrl: strOrNull(x.profileImageUrl),
            lastIncomingMessageAt: toIso(x.lastIncomingMessageAt),
            isPinned: Boolean(x.isPinned),
            pinOrder: typeof x.pinOrder === "number" ? x.pinOrder : 0,
            activeChatterId: strOrNull(x.activeChatterId),
            activeChatterEmail: strOrNull(x.activeChatterEmail),
            isBlocked: Boolean(x.isBlocked),
            tags: listOfStrings(x.tags),
          };
          const existing = grouped.get(phone);
          if (!existing) grouped.set(phone, row);
          else {
            grouped.set(phone, {
              ...existing,
              ...row,
              unreadCount: existing.unreadCount + row.unreadCount,
              tags: Array.from(new Set([...(existing.tags ?? []), ...(row.tags ?? [])])),
              lastMessageAt: row.lastMessageAt && (!existing.lastMessageAt || row.lastMessageAt > existing.lastMessageAt)
                ? row.lastMessageAt
                : existing.lastMessageAt,
              lastMessage: row.lastMessageAt && (!existing.lastMessageAt || row.lastMessageAt >= existing.lastMessageAt)
                ? row.lastMessage
                : existing.lastMessage,
            });
          }
        }
        const rows = Array.from(grouped.values()).sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          if ((a.pinOrder ?? 0) !== (b.pinOrder ?? 0)) return (b.pinOrder ?? 0) - (a.pinOrder ?? 0);
          return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
        });
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}