import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { mediaProxyUrl } from "@/lib/wabees/api";
import {
  normalizePhone,
  phoneQueryCandidates,
  str,
  strOrNull,
  toIso,
} from "@/lib/firebase/normalizers";

export type Message = {
  id: string;
  contactPhone: string;
  contactName: string;
  type: string;
  direction: "incoming" | "outgoing";
  status: string;
  body: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  fileName?: string | null;
  mediaId?: string | null;
  templateName?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  quickReplies?: Array<Record<string, unknown>> | null;
  ctaButton?: Record<string, unknown> | null;
  whatsappMessageId?: string | null;
  errorReason?: string | null;
  createdAt: string | null;
  // Mirrors Flutter MessageModel — needed for reactions, bot attribution,
  // delivery/read timestamps, and file size display.
  reactionEmoji?: string | null;
  reactionMsgId?: string | null;
  botName?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  fileSize?: number | null;
  // Extended message-type payload — keeps every WhatsApp message renderable
  // so the bubble never falls back to "message type unknown".
  latitude?: number | null;
  longitude?: number | null;
  locationName?: string | null;
  locationAddress?: string | null;
  contactsPayload?: Array<Record<string, unknown>> | null;
  buttonReplyId?: string | null;
  buttonReplyText?: string | null;
  interactiveType?: string | null;
  ctaUrl?: string | null;
  otpCode?: string | null;
  replyToId?: string | null;
  replyToBody?: string | null;
  replyToWamid?: string | null;
  replyToType?: string | null;
  raw?: Record<string, unknown> | null;
  reactionAt?: string | null;
  starred?: boolean;
  // Structured WhatsApp catalog order (webhook.php `case 'order'`).
  orderItems?: Array<{
    productRetailerId: string;
    quantity: number;
    itemPrice: number;
    currency: string;
    lineTotal: number;
  }> | null;
  orderTotal?: number | null;
  orderCurrency?: string | null;
  orderCatalogId?: string | null;
  orderNote?: string | null;
  // Decoded WhatsApp Flow (nfm_reply) response fields.
  flowResponse?: Record<string, unknown> | null;
};

// Initial live listener window: keep it tight so opening a thread only
// bills for the newest 20 messages. Older messages load lazily via
// `loadMore` (also small pages) as the user scrolls back.
const PAGE_SIZE = 20;
const PAGE_STEP = 20;

// Parse a raw Firestore message doc into our Message DTO. Extracted so
// both the live snapshot handler and the `loadMore` one-shot fetch share
// the exact same shape — previously duplicated logic drifted.
function parseMessageDoc(
  d: QueryDocumentSnapshot,
  fallbackPhone: string,
  uid: string,
): Message {
  const x = d.data() as Record<string, unknown>;
  const contactPhone = str(x.contactPhone, fallbackPhone);
  const locRaw = (x.location as Record<string, unknown> | undefined) ?? null;
  const latitude =
    typeof x.latitude === "number"
      ? (x.latitude as number)
      : typeof locRaw?.latitude === "number"
        ? (locRaw.latitude as number)
        : null;
  const longitude =
    typeof x.longitude === "number"
      ? (x.longitude as number)
      : typeof locRaw?.longitude === "number"
        ? (locRaw.longitude as number)
        : null;
  const body = str(x.body);
  const otpFromBody = /\b(\d{4,8})\b/.exec(body);
  const looksLikeOtp =
    /\b(otp|verification|code|pin)\b/i.test(body) && otpFromBody;
  const rawMediaUrl = strOrNull(x.mediaUrl);
  const rawMediaId = strOrNull(x.mediaId);
  // Prefer a freshly signed proxy URL whenever we have a mediaId — the
  // webhook writes `mediaUrl` as `/media-proxy.php?id=&uid=` without an
  // id_token, which now returns 401. `mediaProxyUrl` embeds the cached
  // Firebase token so `<img>` / `<video>` tags can load without headers.
  const rawIsProxy =
    typeof rawMediaUrl === "string" && rawMediaUrl.includes("/media-proxy.php");
  const mediaUrl =
    rawMediaId && uid
      ? mediaProxyUrl(rawMediaId, uid)
      : rawIsProxy
        ? rawMediaUrl
        : (rawMediaUrl ?? null);
  return {
    id: d.id,
    contactPhone: normalizePhone(contactPhone),
    contactName: str(x.contactName, normalizePhone(contactPhone)),
    type: str(x.type, "text"),
    direction: ((x.direction as string) === "outgoing" ? "outgoing" : "incoming") as
      | "incoming"
      | "outgoing",
    status: str(x.status, "sent"),
    body,
    mediaUrl,
    mediaId: rawMediaId,
    mimeType: strOrNull(x.mimeType),
    caption: strOrNull(x.caption),
    fileName: strOrNull(x.fileName),
    templateName: strOrNull(x.templateName),
    headerText: strOrNull(x.headerText),
    footerText: strOrNull(x.footerText),
    quickReplies: Array.isArray(x.quickReplies)
      ? (x.quickReplies as Array<Record<string, unknown>>)
      : null,
    ctaButton:
      x.ctaButton && typeof x.ctaButton === "object"
        ? (x.ctaButton as Record<string, unknown>)
        : null,
    whatsappMessageId: strOrNull(x.whatsappMessageId),
    errorReason: strOrNull(x.errorReason),
    createdAt: toIso(x.createdAt),
    reactionEmoji: strOrNull(x.reactionEmoji),
    reactionMsgId: strOrNull(x.reactionMsgId),
    reactionAt: toIso(x.reactionAt),
    botName: strOrNull(x.botName),
    deliveredAt: toIso(x.deliveredAt),
    readAt: toIso(x.readAt),
    fileSize: typeof x.fileSize === "number" ? x.fileSize : null,
    latitude,
    longitude,
    locationName: strOrNull(locRaw?.name),
    locationAddress: strOrNull(locRaw?.address),
    contactsPayload: Array.isArray(x.contacts)
      ? (x.contacts as Array<Record<string, unknown>>)
      : null,
    buttonReplyId: strOrNull(x.buttonReplyId),
    buttonReplyText: strOrNull(x.buttonReplyText),
    interactiveType: strOrNull(x.interactiveType),
    ctaUrl: strOrNull(x.ctaUrl),
    otpCode: strOrNull(x.otpCode) ?? (looksLikeOtp ? otpFromBody![1] : null),
    replyToId: strOrNull(x.replyToId),
    replyToBody: strOrNull(x.replyToBody),
    replyToWamid: strOrNull(x.replyToWamid),
    replyToType: strOrNull(x.replyToType),
    raw: null,
    starred: x.starred === true,
    orderItems: Array.isArray(x.orderItems)
      ? (x.orderItems as Array<Record<string, unknown>>).map((it) => ({
          productRetailerId: String(it.productRetailerId ?? ""),
          quantity: Number(it.quantity ?? 1),
          itemPrice: Number(it.itemPrice ?? 0),
          currency: String(it.currency ?? ""),
          lineTotal: Number(
            it.lineTotal ?? Number(it.itemPrice ?? 0) * Number(it.quantity ?? 1),
          ),
        }))
      : null,
    orderTotal: typeof x.orderTotal === "number" ? x.orderTotal : null,
    orderCurrency: strOrNull(x.orderCurrency),
    orderCatalogId: strOrNull(x.orderCatalogId),
    orderNote: strOrNull(x.orderNote),
    flowResponse:
      x.flowResponse && typeof x.flowResponse === "object"
        ? (x.flowResponse as Record<string, unknown>)
        : null,
  };
}

function mergeReactions(rows: Message[]): Message[] {
  const merged = [...rows];
  const byWamid = new Map<string, Message>();
  const byId = new Map<string, Message>();
  for (const m of merged) {
    byId.set(m.id, m);
    if (m.whatsappMessageId) byWamid.set(m.whatsappMessageId, m);
  }
  for (const m of rows) {
    if (m.type === "reaction" && m.reactionMsgId) {
      const candidates = [m.reactionMsgId, m.reactionMsgId.replace(/^msg_/, "")];
      for (const k of candidates) {
        const parent = byWamid.get(k) ?? byId.get(k);
        if (parent) {
          const orphanAt = m.createdAt ?? "";
          const parentAt = parent.reactionAt ?? "";
          if (!parent.reactionEmoji || orphanAt > parentAt) {
            const updated = {
              ...parent,
              reactionEmoji: m.reactionEmoji ?? parent.reactionEmoji,
              reactionMsgId: m.reactionMsgId,
              reactionAt: orphanAt || parent.reactionAt,
            };
            const idx = merged.findIndex((row) => row.id === parent.id);
            if (idx !== -1) merged[idx] = updated;
            byId.set(updated.id, updated);
            if (updated.whatsappMessageId) byWamid.set(updated.whatsappMessageId, updated);
          }
          break;
        }
      }
    }
  }
  return merged.filter((m) => !(m.type === "reaction" && !m.mediaUrl));
}

function messageTimeMs(m: Pick<Message, "createdAt" | "id">): number {
  const parsed = m.createdAt ? Date.parse(m.createdAt) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortMessagesAsc(rows: Message[]): Message[] {
  return [...rows].sort((a, b) => {
    const diff = messageTimeMs(a) - messageTimeMs(b);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

export function useMessages(phone: string | undefined): {
  data: Message[] | null;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
} {
  const uid = useEffectiveUid();
  // Live rows come from the fixed-size onSnapshot listener (only the
  // newest PAGE_SIZE messages stay subscribed). Older rows are appended
  // once via getDocs on `loadMore` so we do NOT re-bill the entire
  // listener every time the user pages back.
  const [liveRows, setLiveRows] = useState<Message[] | null>(null);
  const [olderRows, setOlderRows] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const oldestOlderCreatedRef = useRef<Date | null>(null);
  const oldestLiveCreatedRef = useRef<Date | null>(null);
  // Bug fix: once the user pages back with loadMore(), a subsequent live
  // snapshot must NOT reset hasMore based on the fixed live-window size,
  // otherwise "Load older" disappears the moment any new message arrives.
  const hasPagedBackRef = useRef<boolean>(false);

  // Reset paging when the thread changes.
  useEffect(() => {
    setHasMore(false);
    setOlderRows([]);
    // Bug fix: also clear liveRows here so switching threads doesn't flash
    // the previous thread's messages before the new snapshot arrives.
    setLiveRows(null);
    hasPagedBackRef.current = false;
    oldestOlderCreatedRef.current = null;
    oldestLiveCreatedRef.current = null;
  }, [phone]);

  useEffect(() => {
    if (!uid || !phone) return;
    const db = fbDbOrNull();
    if (!db) return;
    setLiveRows(null);
    const candidates = phoneQueryCandidates(phone);
    const timestampQuery = query(
      collection(db, `users/${uid}/messages`),
      candidates.length === 1
        ? where("contactPhone", "==", candidates[0])
        : where("contactPhone", "in", candidates),
      // Legacy PHP wrote ISO strings; new code writes Firestore Timestamp.
      // Firestore sorts value types separately, so read Timestamp rows and
      // string rows in separate windows, then merge by parsed time below.
      where("createdAt", "<", ""),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    );
    const legacyStringQuery = query(
      collection(db, `users/${uid}/messages`),
      candidates.length === 1
        ? where("contactPhone", "==", candidates[0])
        : where("contactPhone", "in", candidates),
      where("createdAt", ">=", ""),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    );

    let timestampDocs: QueryDocumentSnapshot[] = [];
    let legacyDocs: QueryDocumentSnapshot[] = [];
    let timestampReady = false;
    let legacyReady = false;

    const flushLiveRows = () => {
      if (!timestampReady || !legacyReady) return;
      const docsById = new Map<string, QueryDocumentSnapshot>();
      for (const d of [...timestampDocs, ...legacyDocs]) docsById.set(d.id, d);
      const docs = Array.from(docsById.values());
      if (!hasPagedBackRef.current) {
        setHasMore(timestampDocs.length >= PAGE_SIZE || legacyDocs.length >= PAGE_SIZE);
      }
      setLoadingMore(false);
      const parsed = sortMessagesAsc(mergeReactions(docs.map((d) => parseMessageDoc(d, phone, uid))));
      const oldest = parsed[0]?.createdAt ? new Date(parsed[0].createdAt) : null;
      oldestLiveCreatedRef.current = oldest && Number.isFinite(oldest.getTime()) ? oldest : null;
      setLiveRows(parsed);
    };

    const unsubs: Unsubscribe[] = [];
    unsubs.push(
      onSnapshot(
        timestampQuery,
        (snap) => {
          timestampDocs = snap.docs;
          timestampReady = true;
          flushLiveRows();
        },
        (err) => {
          setError(err.message);
          setLoadingMore(false);
        },
      ),
    );
    unsubs.push(
      onSnapshot(
        legacyStringQuery,
        (snap) => {
          legacyDocs = snap.docs;
          legacyReady = true;
          flushLiveRows();
        },
        (err) => {
          setError(err.message);
          setLoadingMore(false);
        },
      ),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [uid, phone]);

  const loadMore = useCallback(async () => {
    if (!uid || !phone) return;
    const db = fbDbOrNull();
    if (!db) return;
    const cursor = oldestOlderCreatedRef.current ?? oldestLiveCreatedRef.current;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const candidates = phoneQueryCandidates(phone);
      const phoneFilter =
        candidates.length === 1
          ? where("contactPhone", "==", candidates[0])
          : where("contactPhone", "in", candidates);
      const [timestampSnap, legacySnap] = await Promise.all([
        getDocs(
          query(
            collection(db, `users/${uid}/messages`),
            phoneFilter,
            where("createdAt", "<", Timestamp.fromDate(cursor)),
            orderBy("createdAt", "desc"),
            limit(PAGE_STEP),
          ),
        ),
        getDocs(
          query(
            collection(db, `users/${uid}/messages`),
            phoneFilter,
            where("createdAt", "<", cursor.toISOString()),
            orderBy("createdAt", "desc"),
            limit(PAGE_STEP),
          ),
        ),
      ]);
      const parsed = sortMessagesAsc(
        mergeReactions([
          ...timestampSnap.docs.map((d) => parseMessageDoc(d, phone, uid)),
          ...legacySnap.docs.map((d) => parseMessageDoc(d, phone, uid)),
        ]),
      );
      const oldest = parsed[0]?.createdAt ? new Date(parsed[0].createdAt) : null;
      if (oldest && Number.isFinite(oldest.getTime())) oldestOlderCreatedRef.current = oldest;
      setOlderRows((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of parsed) if (!seen.has(m.id)) merged.push(m);
        return merged;
      },
      );
      setHasMore(timestampSnap.docs.length >= PAGE_STEP || legacySnap.docs.length >= PAGE_STEP);
      hasPagedBackRef.current = true;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [uid, phone]);

  // Combined view: older (desc-fetched) prepended before live rows;
  // reactions merged again since older docs may reference live parents.
  const data = useMemo<Message[] | null>(() => {
    if (liveRows === null) return null;
    if (olderRows.length === 0) return liveRows;
    const seen = new Set(liveRows.map((m) => m.id));
    const olderAsc = sortMessagesAsc(olderRows.filter((m) => !seen.has(m.id)));
    return sortMessagesAsc(mergeReactions([...olderAsc, ...liveRows]));
  }, [liveRows, olderRows]);

  return { data, error, hasMore, loadMore, loadingMore };
}
