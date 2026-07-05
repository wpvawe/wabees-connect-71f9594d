import { useCallback, useEffect, useState } from "react";
import { collection, onSnapshot, query, where, orderBy, limit } from "firebase/firestore";
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
};

const PAGE_SIZE = 300;
const PAGE_STEP = 200;

export function useMessages(phone: string | undefined): {
  data: Message[] | null;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLimit, setPageLimit] = useState<number>(PAGE_SIZE);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  // Reset paging when the thread changes.
  useEffect(() => {
    setPageLimit(PAGE_SIZE);
    setHasMore(false);
  }, [phone]);

  useEffect(() => {
    if (!uid || !phone) return;
    const db = fbDbOrNull();
    if (!db) return;
    setData(null);
    const candidates = phoneQueryCandidates(phone);
    const q = query(
      collection(db, `users/${uid}/messages`),
      candidates.length === 1
        ? where("contactPhone", "==", candidates[0])
        : where("contactPhone", "in", candidates),
      orderBy("createdAt", "desc"),
      limit(pageLimit),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        // If we hit the current page cap, older messages likely exist —
        // enable "Load older" until a fetch returns fewer than requested.
        setHasMore(snap.docs.length >= pageLimit);
        setLoadingMore(false);
        const allRows: Message[] = snap.docs
          .map((d) => {
            const x = d.data() as Record<string, unknown>;
            const contactPhone = str(x.contactPhone, phone);
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
            // Bug fix: incoming webhook writes `mediaId` first and stamps
            // `mediaUrl` in a follow-up commit ~200ms later. When the
            // follow-up commit fails (Firestore contact query 5xx, Meta
            // token expiry, function timeout), the message is left with a
            // mediaId but no mediaUrl — the bubble then renders blank
            // forever. Synthesize the same proxy URL the backend would
            // stamp so the media is always displayable when mediaId exists.
            const mediaUrl =
              rawMediaUrl ??
              (rawMediaId && uid ? mediaProxyUrl(rawMediaId, uid) : null);
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
              otpCode:
                strOrNull(x.otpCode) ??
                (looksLikeOtp ? otpFromBody![1] : null),
              replyToId: strOrNull(x.replyToId),
              replyToBody: strOrNull(x.replyToBody),
              replyToWamid: strOrNull(x.replyToWamid),
              replyToType: strOrNull(x.replyToType),
              raw: null,
              starred: x.starred === true,
            };
          });
        // Merge orphan reaction events onto the original message so the chip
        // shows even when the webhook stored them as separate docs.
        const byWamid = new Map<string, Message>();
        for (const m of allRows) {
          if (m.whatsappMessageId) byWamid.set(m.whatsappMessageId, m);
        }
        for (const m of allRows) {
          if (m.type === "reaction" && m.reactionMsgId) {
            // reactionMsgId can be "msg_<wamid>" (webhook) or the bare wamid.
            const candidates = [
              m.reactionMsgId,
              m.reactionMsgId.replace(/^msg_/, ""),
            ];
            for (const k of candidates) {
              const parent = byWamid.get(k) ?? allRows.find((p) => p.id === k);
              if (parent) {
                // Newer reaction wins. Parent.reactionAt is set when the
                // website/app writes a reaction directly on the parent doc,
                // so we don't let a stale orphan webhook doc overwrite a
                // fresh local reaction.
                const orphanAt = m.createdAt ?? "";
                const parentAt = parent.reactionAt ?? "";
                if (!parent.reactionEmoji || orphanAt > parentAt) {
                  parent.reactionEmoji = m.reactionEmoji ?? parent.reactionEmoji;
                  parent.reactionMsgId = m.reactionMsgId;
                  parent.reactionAt = orphanAt || parent.reactionAt;
                }
                break;
              }
            }
          }
        }
        const rows: Message[] = allRows
          .filter(
            (m) =>
              !(m.type === "reaction" && !m.mediaUrl),
          )
          .sort((a, b) => (a.createdAt ?? "9999").localeCompare(b.createdAt ?? "9999"));
        setData(rows);
      },
      (err) => {
        setError(err.message);
        setLoadingMore(false);
      },
    );
    return () => unsub();
  }, [uid, phone, pageLimit]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setPageLimit((n) => n + PAGE_STEP);
  }, []);

  return { data, error, hasMore, loadMore, loadingMore };
}
