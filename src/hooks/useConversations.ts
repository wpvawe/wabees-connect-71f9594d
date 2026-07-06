import { useCallback, useEffect, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import {
  listOfStrings,
  normalizePhone,
  phoneDocId,
  str,
  strOrNull,
  toIso,
} from "@/lib/firebase/normalizers";
import { subscribeConversations } from "@/lib/firebase/conversationsBroker";

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
  assignedAgentId?: string | null;
  assignedAgentEmail?: string | null;
  isDeleted?: boolean;
  notesCount?: number;
  state?: "open" | "pending" | "resolved" | "snoozed";
  snoozeUntil?: string | null;
  firstResponseAt?: string | null;
  firstResponseMs?: number | null;
  priority?: "urgent" | "high" | "normal" | "low" | null;
  aiIntent?: string | null;
  aiSentiment?: "positive" | "neutral" | "negative" | null;
  aiSummary?: string | null;
  aiTriageAt?: string | null;
};

function fresherIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a && b) return a >= b ? a : b;
  return a ?? b ?? null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function mergeConversation(a: Conversation, b: Conversation): Conversation {
  const bIsNewer = Boolean(b.lastMessageAt && (!a.lastMessageAt || b.lastMessageAt >= a.lastMessageAt));
  const contactName =
    a.contactName && a.contactName.length >= b.contactName.length ? a.contactName : b.contactName;
  return {
    ...a,
    contactPhone: a.contactPhone || b.contactPhone,
    contactName,
    lastMessage: bIsNewer ? b.lastMessage : a.lastMessage || b.lastMessage,
    lastMessageType: bIsNewer ? b.lastMessageType : a.lastMessageType || b.lastMessageType,
    lastMessageAt: fresherIso(a.lastMessageAt, b.lastMessageAt),
    unreadCount: Math.max(a.unreadCount, b.unreadCount),
    profileImageUrl: firstNonEmpty(a.profileImageUrl, b.profileImageUrl),
    lastIncomingMessageAt: fresherIso(a.lastIncomingMessageAt, b.lastIncomingMessageAt),
    isPinned: Boolean(a.isPinned || b.isPinned),
    pinOrder: Math.max(a.pinOrder ?? 0, b.pinOrder ?? 0),
    activeChatterId: firstNonEmpty(a.activeChatterId, b.activeChatterId),
    activeChatterEmail: firstNonEmpty(a.activeChatterEmail, b.activeChatterEmail),
    isBlocked: Boolean(a.isBlocked || b.isBlocked),
    tags: Array.from(new Set([...(a.tags ?? []), ...(b.tags ?? [])])),
    assignedAgentId: firstNonEmpty(a.assignedAgentId, b.assignedAgentId),
    assignedAgentEmail: firstNonEmpty(a.assignedAgentEmail, b.assignedAgentEmail),
    isDeleted: Boolean(a.isDeleted || b.isDeleted),
    notesCount: Math.max(a.notesCount ?? 0, b.notesCount ?? 0),
    state: (b.state && b.state !== "open" ? b.state : a.state) ?? a.state ?? b.state,
    snoozeUntil: fresherIso(a.snoozeUntil, b.snoozeUntil),
    priority: b.priority ?? a.priority ?? null,
    aiIntent: b.aiIntent ?? a.aiIntent ?? null,
    aiSentiment: b.aiSentiment ?? a.aiSentiment ?? null,
    aiSummary: b.aiSummary ?? a.aiSummary ?? null,
    aiTriageAt: fresherIso(a.aiTriageAt, b.aiTriageAt),
  };
}

function compactConversationWrite(c: Conversation): Record<string, unknown> {
  const out: Record<string, unknown> = {
    contactPhone: c.contactPhone,
    contactName: c.contactName,
    lastMessage: c.lastMessage,
    lastMessageType: c.lastMessageType,
    unreadCount: c.unreadCount,
    isPinned: c.isPinned ?? false,
    pinOrder: c.pinOrder ?? 0,
    isBlocked: c.isBlocked ?? false,
    tags: c.tags ?? [],
  };
  if (c.lastMessageAt) out.lastMessageAt = c.lastMessageAt;
  if (c.profileImageUrl) out.profileImageUrl = c.profileImageUrl;
  if (c.lastIncomingMessageAt) out.lastIncomingMessageAt = c.lastIncomingMessageAt;
  if (c.activeChatterId) out.activeChatterId = c.activeChatterId;
  if (c.activeChatterEmail) out.activeChatterEmail = c.activeChatterEmail;
  if (c.assignedAgentId) out.assignedAgentId = c.assignedAgentId;
  if (c.assignedAgentEmail) out.assignedAgentEmail = c.assignedAgentEmail;
  return out;
}

function priorityRank(p: Conversation["priority"]): number {
  if (p === "urgent") return 3;
  if (p === "high") return 2;
  return 0;
}

const CONV_PAGE = 200;
const CONV_STEP = 100;

export function useConversations(): {
  data: Conversation[] | null;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
} {
  const uid = useEffectiveUid();
  const session = useFirebaseSession();
  const selfUid = session.status === "ready" ? session.uid : null;
  const maskOtherAgentEmails =
    session.status === "ready" && !!session.dataOwner && session.dataOwner !== session.uid;
  const [data, setData] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLimit, setPageLimit] = useState<number>(CONV_PAGE);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    // Auto-canonicalization write should fire once per phone per mount,
    // not on every snapshot burst — otherwise we spam Firestore writes on
    // initial load and every listener re-emit.
    const canonicalized = new Set<string>();
    const unsub = subscribeConversations(uid, pageLimit, (snap) => {
      if (snap.error) {
        setError(snap.error);
        setLoadingMore(false);
        return;
      }
      const rawDocs = snap.docs;
      setHasMore(rawDocs.length >= pageLimit);
        setLoadingMore(false);
        const grouped = new Map<string, Conversation>();
        // Track which raw doc IDs belong to each canonical phone, so we can
        // self-heal "+92..." vs "92..." duplicates created by older clients.
        const idsByPhone = new Map<string, string[]>();
        for (const d of rawDocs) {
          const x = d.data;
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
            assignedAgentId: strOrNull(x.assignedAgentId),
            assignedAgentEmail:
              maskOtherAgentEmails && strOrNull(x.assignedAgentId) !== selfUid
                ? null
                : strOrNull(x.assignedAgentEmail),
            isDeleted: x.isDeleted === true,
            notesCount: typeof x.notesCount === "number" ? Math.max(0, x.notesCount) : 0,
            state: (() => {
              const s = typeof x.state === "string" ? x.state : "open";
              return s === "pending" || s === "resolved" || s === "snoozed" ? s : "open";
            })(),
            snoozeUntil: typeof x.snoozeUntil === "string" ? x.snoozeUntil : null,
            firstResponseAt: typeof x.firstResponseAt === "string" ? x.firstResponseAt : null,
            firstResponseMs: typeof x.firstResponseMs === "number" ? x.firstResponseMs : null,
            priority: (() => {
              const p = typeof x.priority === "string" ? x.priority : null;
              return p === "urgent" || p === "high" || p === "normal" || p === "low" ? p : null;
            })(),
            aiIntent: typeof x.aiIntent === "string" ? x.aiIntent : null,
            aiSentiment: (() => {
              const s = typeof x.aiSentiment === "string" ? x.aiSentiment : null;
              return s === "positive" || s === "negative" || s === "neutral" ? s : null;
            })(),
            aiSummary: typeof x.aiSummary === "string" ? x.aiSummary : null,
            aiTriageAt: typeof x.aiTriageAt === "string" ? x.aiTriageAt : null,
          };
          if (row.isDeleted) continue;
          const existing = grouped.get(phone);
          if (!existing) grouped.set(phone, row);
          else grouped.set(phone, mergeConversation(existing, row));
        }
        // Best-effort canonicalization: keep/create the Flutter/PHP `+E.164`
        // doc ID and delete older stray copies after merging their fields.
        // Idempotent and safe to re-run.
        for (const [phone, ids] of idsByPhone) {
          const canonical = phoneDocId(phone);
          const hasStray = ids.some((id) => id !== canonical);
          if (!hasStray) continue;
          if (canonicalized.has(phone)) continue;
          canonicalized.add(phone);
          const merged = grouped.get(phone);
          if (!merged) continue;
          void (async () => {
            try {
              await setDoc(
                doc(db, `users/${uid}/conversations/${canonical}`),
                compactConversationWrite(merged),
                { merge: true },
              );
            } catch {
              /* permissions or race — ignore, UI already deduped */
            }
          })();
        }
        const rows = Array.from(grouped.values()).sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          if ((a.pinOrder ?? 0) !== (b.pinOrder ?? 0)) return (b.pinOrder ?? 0) - (a.pinOrder ?? 0);
          const pa = priorityRank(a.priority);
          const pb = priorityRank(b.priority);
          if (pa !== pb) return pb - pa;
          return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
        });
        setData(rows);
    });
    return () => unsub();
  }, [uid, pageLimit, selfUid, maskOtherAgentEmails]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setPageLimit((n) => n + CONV_STEP);
  }, []);

  return { data, error, hasMore, loadMore, loadingMore };
}
