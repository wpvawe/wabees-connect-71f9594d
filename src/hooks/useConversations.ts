import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  listOfStrings,
  normalizePhone,
  phoneDocId,
  str,
  strOrNull,
  toIso,
} from "@/lib/firebase/normalizers";

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
    const unsub = onSnapshot(
      collection(db, `users/${uid}/conversations`),
      (snap) => {
        const grouped = new Map<string, Conversation>();
        // Track which raw doc IDs belong to each canonical phone, so we can
        // self-heal "+92..." vs "92..." duplicates created by older clients.
        const idsByPhone = new Map<string, string[]>();
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          const phone = normalizePhone(d.id || str(x.contactPhone));
          if (!phone) continue;
          const list = idsByPhone.get(phone) ?? [];
          list.push(d.id);
          idsByPhone.set(phone, list);
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
              contactName:
                existing.contactName.length >= row.contactName.length
                  ? existing.contactName
                  : row.contactName,
              unreadCount: Math.max(existing.unreadCount, row.unreadCount),
              tags: Array.from(new Set([...(existing.tags ?? []), ...(row.tags ?? [])])),
              profileImageUrl: existing.profileImageUrl ?? row.profileImageUrl,
              isPinned: existing.isPinned || row.isPinned,
              isBlocked: existing.isBlocked || row.isBlocked,
              lastMessageAt:
                row.lastMessageAt &&
                (!existing.lastMessageAt || row.lastMessageAt > existing.lastMessageAt)
                  ? row.lastMessageAt
                  : existing.lastMessageAt,
              lastMessage:
                row.lastMessageAt &&
                (!existing.lastMessageAt || row.lastMessageAt >= existing.lastMessageAt)
                  ? row.lastMessage
                  : existing.lastMessage,
              lastMessageType:
                row.lastMessageAt &&
                (!existing.lastMessageAt || row.lastMessageAt >= existing.lastMessageAt)
                  ? row.lastMessageType
                  : existing.lastMessageType,
            });
          }
        }
        // Best-effort canonicalization: keep/create the Flutter/PHP `+E.164`
        // doc ID and delete older stray copies after merging their fields.
        // Idempotent and safe to re-run.
        for (const [phone, ids] of idsByPhone) {
          const canonical = phoneDocId(phone);
          const hasStray = ids.some((id) => id !== canonical);
          if (!hasStray) continue;
          const merged = grouped.get(phone);
          if (!merged) continue;
          void (async () => {
            try {
              await setDoc(
                doc(db, `users/${uid}/conversations/${canonical}`),
                {
                  contactPhone: merged.contactPhone,
                  contactName: merged.contactName,
                  lastMessage: merged.lastMessage,
                  lastMessageType: merged.lastMessageType,
                  lastMessageAt: merged.lastMessageAt,
                  unreadCount: merged.unreadCount,
                  profileImageUrl: merged.profileImageUrl ?? null,
                  lastIncomingMessageAt: merged.lastIncomingMessageAt ?? null,
                  isPinned: merged.isPinned ?? false,
                  pinOrder: merged.pinOrder ?? 0,
                  activeChatterId: merged.activeChatterId ?? null,
                  activeChatterEmail: merged.activeChatterEmail ?? null,
                  isBlocked: merged.isBlocked ?? false,
                  tags: merged.tags ?? [],
                },
                { merge: true },
              );
              for (const id of ids) {
                if (id !== canonical) {
                  await deleteDoc(doc(db, `users/${uid}/conversations/${id}`)).catch(() => {});
                }
              }
            } catch {
              /* permissions or race — ignore, UI already deduped */
            }
          })();
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
