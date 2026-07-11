import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faCircleNotch,
  faChevronDown,
  faEllipsisVertical,
  faPhone,
  faCopy,
  faUpRightFromSquare,
  faCloudArrowUp,
  faMagnifyingGlass,
  faXmark,
  faNoteSticky,
  faUserPlus,
  faClock,
  faBan,
  faCircleCheck,
  faCheckDouble,
  faRotateLeft,
  faMoon,
  faClockRotateLeft,
  faCircleInfo,
  faStar,
  faFileArrowDown,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { MessageBubble, type MessageActions } from "@/components/inbox/MessageBubble";
import { useCan } from "@/lib/auth/permissions";
import { Composer } from "@/components/inbox/Composer";
import { MediaLightbox, type LightboxItem } from "@/components/inbox/MediaLightbox";
import { ForwardDialog } from "@/components/inbox/ForwardDialog";
import { NotesPanel } from "@/components/inbox/NotesPanel";
import { AssignAgentDialog } from "@/components/inbox/AssignAgentDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScheduleDialog } from "@/components/inbox/ScheduleDialog";
import { ActivityDrawer } from "@/components/inbox/ActivityDrawer";
import { ContactDetailsDrawer } from "@/components/inbox/ContactDetailsDrawer";
import { ShortcutsHelp } from "@/components/inbox/ShortcutsHelp";
import { StarredDrawer } from "@/components/inbox/StarredDrawer";
import { exportChatTxt, exportChatCsv, downloadBlob } from "@/lib/inbox/export";
import { useHotkeys } from "@/hooks/useHotkeys";
import { setConversationState } from "@/lib/firebase/assignments";
import { addSystemNote } from "@/lib/firebase/notes";
import { sendCsatSurvey } from "@/lib/firebase/csat";
import { useCsatSettings } from "@/hooks/useCsatSettings";
import { useMessages, type Message } from "@/hooks/useMessages";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { normalizePhone, phoneQueryCandidates, whatsappRecipientId } from "@/lib/firebase/normalizers";
import {
  sendReactionMessage,
  markMessageRead,
  deleteWhatsAppMessage,
  sendTextMessage,
  sendMediaMessage,
  extractWamid,
} from "@/lib/wabees/api";
import { initiateCall } from "@/lib/wabees/calls";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { useContacts } from "@/hooks/useContacts";
import { useConversations } from "@/hooks/useConversations";
import { useAgents } from "@/hooks/useAgents";
import { useSlaSettings } from "@/hooks/useSlaSettings";
import { SlaBadge } from "@/components/inbox/SlaBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Route = createFileRoute("/_authenticated/inbox/$phone")({
  head: ({ params }) => ({ meta: [{ title: `Chat ${params.phone} — Wabees` }] }),
  component: InboxThread,
});

function hoursUntilTomorrow9am(): number {
  const now = new Date();
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  const hours = Math.round((t.getTime() - now.getTime()) / 3600000);
  return Math.max(1, hours);
}

function InboxThread() {
  const { phone } = Route.useParams();
  return <Thread phone={phone} />;
}

function Thread({ phone }: { phone: string }) {
  // Local helper: hours between now and 9am tomorrow (24h window, minimum 1h).
  // Defined inside Thread scope so it stays colocated with the snooze menu that uses it.
  // (Kept as a plain function — pure, deterministic per call, no hooks needed.)
  //
  // Extracted below into module scope for stability across renders.
  const { data, error, hasMore, loadMore, loadingMore } = useMessages(phone);
  const { data: contacts } = useContacts();
  const { data: conversations } = useConversations();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const session = useFirebaseSession();
  const selfEmail = session.status === "ready" ? session.user.email ?? null : null;
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newSinceScroll, setNewSinceScroll] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [stateBusy, setStateBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [starredOpen, setStarredOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // A11y / S1: use a shadcn AlertDialog for destructive delete confirmation
  // instead of window.confirm() — keyboard-accessible, themed, and works
  // inside our design system.
  const [pendingDelete, setPendingDelete] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // First unread anchor — used to jump the viewport to the first unread
  // incoming message on thread open (instead of always jumping to bottom).
  const firstUnreadRef = useRef<HTMLDivElement>(null);
  const lastLenRef = useRef(0);
  const dragCounterRef = useRef(0);
  // B4: capture the first-unread anchor exactly once per opened thread.
  // Previously the ref was mutated during render, which violates React
  // rules and produced stale ids under Strict Mode's double-invoke.
  const initialUnreadRef = useRef<string | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  useEffect(() => {
    initialUnreadRef.current = null;
    setFirstUnreadId(null);
  }, [phone]);
  useEffect(() => {
    if (!data || initialUnreadRef.current !== null) return;
    const first = data.find(
      (m) => m.direction === "incoming" && m.status !== "read" && !m.readAt,
    );
    initialUnreadRef.current = first ? first.id : "";
    setFirstUnreadId(first ? first.id : null);
  }, [data]);
  // Auto-scroll only when (a) the thread just opened or (b) the user is
  // already near the bottom. Otherwise scrolling jumps the viewport away
  // from messages they were reading.
  useEffect(() => {
    const el = scrollerRef.current;
    const len = data?.length ?? 0;
    if (!el || len === 0) return;
    const prevLen = lastLenRef.current;
    lastLenRef.current = len;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 160;
    if (prevLen === 0 || nearBottom) {
      if (prevLen === 0 && firstUnreadRef.current) {
        firstUnreadRef.current.scrollIntoView({ behavior: "auto", block: "start" });
      } else {
        bottomRef.current?.scrollIntoView({
          behavior: prevLen === 0 ? "auto" : "smooth",
          block: "end",
        });
      }
      setNewSinceScroll(0);
    } else if (len > prevLen) {
      setNewSinceScroll((n) => n + (len - prevLen));
    }
  }, [data?.length]);

  // Track whether user has scrolled up so we can show the floating jump-to-bottom pill.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const near = distance < 160;
      setAtBottom(near);
      if (near) setNewSinceScroll(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Close header menu on outside click.
  useEffect(() => {
    if (!headerMenu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.("[data-header-menu]") && !t.closest?.("[data-snooze-menu]")) {
        setHeaderMenu(false);
        setSnoozeOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [headerMenu]);

  // Mark conversation read when user opens the chat on the website.
  // Mirrors Flutter: reset conversation.unreadCount and stamp readAt on
  // unread incoming messages so app & website stay in sync.
  useEffect(() => {
    if (!uid || !phone) return;
    void (async () => {
      try {
        // Conversation doc ID can be either raw or normalized depending on
        // which client created it; try all candidates so the mobile app
        // sees unread reset to 0.
        const candidates = phoneQueryCandidates(phone);
        await Promise.all(
          candidates.map((c) =>
            setDoc(
              doc(fbDb(), `users/${uid}/conversations/${c}`),
              { unreadCount: 0 },
              { merge: true },
            ).catch(() => {}),
          ),
        );
      } catch {
        /* permissions/race — ignore */
      }
    })();
  }, [uid, phone]);

  // When new incoming messages arrive while this thread is open, mark them as read.
  useEffect(() => {
    if (!uid || !data) return;
    const unread = data.filter(
      (m) => m.direction === "incoming" && m.status !== "read" && !m.readAt,
    );
    if (unread.length === 0) return;
    // Bug fix: `data` is a new array ref on every snapshot (delivery ticks,
    // reactions). Without a cancel flag, rapid updates spawn N concurrent
    // async IIFEs each doing batch writes + Meta mark-read calls, burning
    // Firestore quota and API rate-limit. Cancel the in-flight run when a
    // fresh update arrives.
    let cancelled = false;
    void (async () => {
      try {
        const candidates = phoneQueryCandidates(phone);
        // C-4 fix: Firestore batches cap at 500 ops. Chunk so large unread
        // backlogs don't silently throw and leave messages forever-unread.
        const CHUNK = 450;
        for (let i = 0; i < unread.length; i += CHUNK) {
          if (cancelled) return;
          const batch = writeBatch(fbDb());
          for (const m of unread.slice(i, i + CHUNK)) {
            batch.set(
              doc(fbDb(), `users/${uid}/messages/${m.id}`),
              { status: "read", readAt: serverTimestamp() },
              { merge: true },
            );
          }
          await batch.commit();
        }
        if (cancelled) return;
        // Also keep conversation counter at 0.
        for (const candidate of candidates) {
          if (cancelled) return;
          await setDoc(
            doc(fbDb(), `users/${uid}/conversations/${candidate}`),
            { unreadCount: 0 },
            { merge: true },
          ).catch(() => {});
        }
        // L-1 fix: also tell Meta the messages are read so the customer's
        // phone shows blue ticks. Best-effort & dedup'd by wamid.
        // Perf: WhatsApp automatically marks all prior messages as read when
        // any single wamid is marked. So we only need to hit Meta with the
        // newest wamid — sending N calls for N-unread was pointless and
        // burned rate-limit on high-traffic threads (B-9).
        if (selfUid) {
          try {
            const creds = await loadWaConnection(selfUid);
            if (cancelled) return;
            if (creds) {
              // Newest unread with a wamid (unread is sorted ascending by
              // createdAt in useMessages, so scan from the end).
              let newestWamid: string | null = null;
              for (let i = unread.length - 1; i >= 0; i--) {
                if (unread[i].whatsappMessageId) {
                  newestWamid = unread[i].whatsappMessageId!;
                  break;
                }
              }
              if (newestWamid) {
                await markMessageRead({
                  phone_number_id: creds.phone_number_id,
                  access_token: "",
                  message_id: newestWamid,
                }).catch(() => {});
              }
            }
          } catch {
            /* mark-read is best-effort */
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, selfUid, phone, data]);

  const onReact = useCallback(
    async (m: Message, emoji: string) => {
      if (!uid || !selfUid) return;
      const wamid = whatsappContextMessageId(m);
      const reactionTargetId = wamid ? `msg_${wamid}` : null;
      // Toggle: clicking the same emoji removes it (mirrors WhatsApp).
      const nextEmoji = m.reactionEmoji === emoji ? "" : emoji;
      try {
        // 1) Update parent so website renders the chip instantly. reactionAt
        //    lets useMessages tie-break against any stale orphan reaction
        //    doc the webhook wrote earlier.
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          reactionEmoji: nextEmoji || null,
          reactionMsgId: reactionTargetId,
          reactionAt: serverTimestamp(),
        });
      } catch {
        /* local update best-effort */
      }
      if (wamid) {
        try {
          const creds = await loadWaConnection(selfUid);
          if (!creds) return;
          await sendReactionMessage({
            phone_number_id: creds.phone_number_id,
            access_token: "",
            to: whatsappRecipientId(phone),
            message_id: wamid,
            emoji: nextEmoji,
          });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Reaction failed");
        }
      }
    },
    [uid, selfUid, phone],
  );

  const onDelete = useCallback((m: Message) => {
    // Open the AlertDialog; actual delete happens in performDelete on confirm.
    setPendingDelete(m);
  }, []);

  const performDelete = useCallback(
    async (m: Message) => {
      if (!uid) return;
      const canRevoke =
        m.direction === "outgoing" &&
        !!m.whatsappMessageId &&
        (() => {
          if (!m.createdAt) return false;
          const ageHours = (Date.now() - new Date(m.createdAt).getTime()) / 36e5;
          return ageHours < 48;
        })();
      try {
        if (canRevoke && selfUid && m.whatsappMessageId) {
          try {
            const creds = await loadWaConnection(selfUid);
            if (creds) {
              const res = await deleteWhatsAppMessage({
                phone_number_id: creds.phone_number_id,
                access_token: "",
                message_id: m.whatsappMessageId,
              });
              if (!res.success) {
                toast.error(res.message ?? "Couldn't revoke on WhatsApp");
              }
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't revoke on WhatsApp");
          }
        }
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          status: "deleted",
          body: "",
          mediaUrl: null,
          caption: null,
          deletedAt: serverTimestamp(),
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [uid, selfUid],
  );

  const pendingCanRevoke =
    pendingDelete?.direction === "outgoing" &&
    !!pendingDelete?.whatsappMessageId &&
    !!pendingDelete?.createdAt &&
    (Date.now() - new Date(pendingDelete.createdAt).getTime()) / 36e5 < 48;

  const onResend = useCallback(
    async (m: Message) => {
      if (!uid || !selfUid) return;
      const creds = await loadWaConnection(selfUid).catch(() => null);
      if (!creds) {
        toast.error("Connect WhatsApp first");
        return;
      }
      let quotaReserved = false;
      try {
        // Resend counts as a new billable Meta send — enforce plan quota
        // before hitting the wire (B-4).
        try {
          const { reserveQuota } = await import("@/lib/plans/limits");
          await reserveQuota(uid, "messages", 1);
          quotaReserved = true;
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Message limit reached");
          return;
        }
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          status: "pending",
          errorReason: null,
        });
        const to = whatsappRecipientId(phone);
        let res;
        if (m.type === "text") {
          res = await sendTextMessage({
            phone_number_id: creds.phone_number_id,
            access_token: "",
            to,
            message: m.body,
            context_message_id: m.replyToWamid ?? null,
          });
        } else if (
          m.type === "image" ||
          m.type === "video" ||
          m.type === "document" ||
          m.type === "audio" ||
          m.type === "sticker"
        ) {
          // B8: prefer media_url on resend. Meta expires uploaded media_ids
          // ~30 days after upload, so an old mediaId will fail with
          // "media not found" while the proxy URL keeps working.
          res = await sendMediaMessage({
            phone_number_id: creds.phone_number_id,
            access_token: "",
            to,
            type: m.type,
            ...(m.mediaUrl ? { media_url: m.mediaUrl } : m.mediaId ? { media_id: m.mediaId } : {}),
            ...(m.caption ? { caption: m.caption } : {}),
            ...(m.fileName ? { filename: m.fileName } : {}),
            context_message_id: m.replyToWamid ?? null,
          });
        } else {
          if (quotaReserved) {
            const { releaseQuota } = await import("@/lib/plans/limits");
            await releaseQuota(uid, "messages", 1).catch(() => {});
          }
          toast.error("Cannot resend this message type");
          return;
        }
        const wamid = extractWamid(res.raw);
        if (!res.success) {
          if (quotaReserved) {
            const { releaseQuota } = await import("@/lib/plans/limits");
            await releaseQuota(uid, "messages", 1).catch(() => {});
            quotaReserved = false;
          }
          await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
            status: "failed",
            errorReason: res.message ?? "Send failed",
          });
          toast.error(res.message ?? "Send failed");
          return;
        }
        if (quotaReserved) {
          const { releaseQuota } = await import("@/lib/plans/limits");
          await releaseQuota(uid, "messages", 1).catch(() => {});
          quotaReserved = false;
        }
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          status: "sent",
          whatsappMessageId: wamid,
        });
        toast.success("Resent");
      } catch (e) {
        if (quotaReserved) {
          const { releaseQuota } = await import("@/lib/plans/limits");
          await releaseQuota(uid, "messages", 1).catch(() => {});
        }
        toast.error(e instanceof Error ? e.message : "Resend failed");
      }
    },
    [uid, selfUid, phone],
  );

  // P4 fix — stable `actions` reference so the memoized MessageBubble
  // skips re-rendering all N bubbles on unrelated parent state changes
  // (menu open, scroll, delivery-status ticks).
  const onOpenMedia = useCallback((m: Message) => setLightboxId(m.id), []);
  const onToggleStar = useCallback(
    async (m: Message) => {
      if (!uid) return;
      try {
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          starred: !m.starred,
          starredAt: !m.starred ? serverTimestamp() : null,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't star message");
      }
    },
    [uid],
  );
  const actions: MessageActions = useMemo(
    () => ({
      onReply: setReplyTo,
      onReact,
      onDelete,
      onForward: setForwardMsg,
      onOpenMedia,
      onResend,
      onToggleStar,
    }),
    [onReact, onDelete, onOpenMedia, onResend, onToggleStar],
  );

  // Filter thread by in-chat search.
  const visibleData = useMemo(() => {
    if (!data) return data;
    const s = searchQuery.trim().toLowerCase();
    if (!s) return data;
    return data.filter((m) => {
      const body = (m.body || "").toLowerCase();
      const cap = (m.caption || "").toLowerCase();
      const fn = (m.fileName || "").toLowerCase();
      return body.includes(s) || cap.includes(s) || fn.includes(s);
    });
  }, [data, searchQuery]);
  // P5: cache the rendered day-divider list. Recomputing on every parent
  // state change (menu toggles, atBottom flips, unread ticks) was
  // O(n) per keystroke — memoize on the inputs that actually affect it.
  const renderedMessages = useMemo(
    () => renderWithDayDividers(visibleData ?? [], actions, firstUnreadId, firstUnreadRef),
    [visibleData, actions, firstUnreadId],
  );

  // P6: derived list — memoize so the lightbox array isn't reallocated on
  // every parent state change (menus, scroll, delivery-status ticks).
  const lightboxItems: LightboxItem[] = useMemo(
    () =>
      (data ?? [])
        .filter(
          (m) =>
            !!m.mediaUrl &&
            (m.type === "image" ||
              m.type === "video" ||
              m.type === "sticker" ||
              m.mimeType?.startsWith("image/") ||
              m.mimeType?.startsWith("video/")),
        )
        .map((m) => ({
          id: m.id,
          url: m.mediaUrl!,
          kind:
            m.type === "video" || m.mimeType?.startsWith("video/") ? "video" : "image",
          caption: m.caption ?? m.body ?? null,
          fileName: m.fileName ?? null,
          mime: m.mimeType ?? null,
        })),
    [data],
  );

  // H-4 fix: walk newest→oldest and pick the freshest real (non-phone) name.
  // `data` is sorted ascending by createdAt, so the contact-name on data[0]
  // is the OLDEST and may still be the raw phone even after the webhook
  // attached a profile name to later messages.
  const name = (() => {
    if (!data || data.length === 0) return phone;
    for (let i = data.length - 1; i >= 0; i--) {
      const n = data[i].contactName;
      if (n && n !== phone && n !== data[i].contactPhone) return n;
    }
    return phone;
  })();
  const normalizedPhone = normalizePhone(phone);
  const contact = (contacts ?? []).find((c) => normalizePhone(c.phone) === normalizedPhone);
  const conv = (conversations ?? []).find((c) => normalizePhone(c.contactPhone) === normalizedPhone);
  const slaSettings = useSlaSettings();
  const csatSettings = useCsatSettings();
  // U3: resolve the assigned agent so we can render a live presence chip
  // in the thread header — owners immediately see who's on the case and
  // whether that teammate is actually online right now.
  const { data: agentsList } = useAgents();
  const assignedAgent = conv?.assignedAgentId
    ? (agentsList ?? []).find((a) => a.id === conv.assignedAgentId) ?? null
    : null;
  const assignedLabel =
    assignedAgent?.email?.split("@")[0] ||
    conv?.assignedAgentEmail?.split("@")[0] ||
    (conv?.assignedAgentId ? "agent" : null);
  const isBlocked = !!conv?.isBlocked;
  const convState = conv?.state ?? "open";
  const isResolved = convState === "resolved";
  const displayName = contact?.name || (name !== phone ? name : "");
  const can = useCan();
  const canAssign = can("conversation.assign");
  const canBlock = can("conversation.block");

  const onToggleBlock = useCallback(async () => {
    if (!uid) return;
    setBlockBusy(true);
    try {
      // Conv doc can live under any candidate id (legacy raw / +E.164 /
      // digits-only). Update all so the actual doc — wherever it exists —
      // gets flipped instead of orphaning a fresh normalized one.
      const canonical = normalizePhone(phone);
      const candidates = phoneQueryCandidates(phone);
      await Promise.all(
        candidates.map((c) =>
          setDoc(
            doc(fbDb(), `users/${uid}/conversations/${c}`),
            {
              isBlocked: !isBlocked,
              blockedAt: !isBlocked ? serverTimestamp() : null,
              contactPhone: canonical,
            },
            { merge: true },
          ).catch(() => {}),
        ),
      );
      toast.success(isBlocked ? "Contact unblocked" : "Contact blocked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBlockBusy(false);
      setHeaderMenu(false);
    }
  }, [uid, phone, isBlocked]);

  const onToggleResolve = useCallback(async () => {
    if (!uid || !selfUid) return;
    setStateBusy(true);
    try {
      const convId = normalizePhone(phone);
      await setConversationState(
        uid,
        convId,
        isResolved ? "open" : "resolved",
        { uid: selfUid, email: selfEmail },
        {
          assignedAgentId: conv?.assignedAgentId ?? null,
          previousState: convState,
        },
      );
      addSystemNote(
        uid,
        convId,
        isResolved ? "Conversation reopened" : "Marked as resolved",
        { uid: selfUid, email: selfEmail },
        "system",
      ).catch(() => {});
      toast.success(isResolved ? "Conversation reopened" : "Marked as resolved");
      // Auto-send CSAT survey on resolve when the owner has it enabled.
      if (!isResolved && csatSettings.enabled && csatSettings.autoOnResolve) {
        void sendCsatSurvey({
          ownerUid: uid,
          phone: convId,
          settings: csatSettings,
          actor: { uid: selfUid, email: selfEmail },
          assignedAgentId: conv?.assignedAgentId ?? null,
          assignedAgentEmail: conv?.assignedAgentEmail ?? null,
          // 24-hour cooldown so resolve/reopen loops don't spam surveys.
          cooldownMs: 24 * 60 * 60 * 1000,
        })
          .then((id) => {
            if (id) toast.success("CSAT survey sent");
          })
          .catch(() => {});
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setStateBusy(false);
      setHeaderMenu(false);
    }
  }, [uid, selfUid, selfEmail, phone, isResolved, csatSettings, conv?.assignedAgentId, conv?.assignedAgentEmail, convState]);

  // ---- Snooze ----
  const snoozeUntilIso = conv?.snoozeUntil ?? null;
  const isSnoozed = convState === "snoozed";
  const snoozeFor = useCallback(
    async (hours: number) => {
      if (!uid || !selfUid) return;
      setStateBusy(true);
      setSnoozeOpen(false);
      try {
        const until = new Date(Date.now() + hours * 3600 * 1000);
        await setConversationState(
          uid,
          normalizePhone(phone),
          "snoozed",
          { uid: selfUid, email: selfEmail },
          {
            snoozeUntil: until,
            assignedAgentId: conv?.assignedAgentId ?? null,
            previousState: convState,
          },
        );
        addSystemNote(
          uid,
          normalizePhone(phone),
          `Snoozed until ${until.toLocaleString()}`,
          { uid: selfUid, email: selfEmail },
          "system",
        ).catch(() => {});
        toast.success(`Snoozed for ${hours}h`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Snooze failed");
      } finally {
        setStateBusy(false);
        setHeaderMenu(false);
      }
    },
    [uid, selfUid, selfEmail, phone, conv?.assignedAgentId, convState],
  );

  // Auto-wake: if snoozed and snoozeUntil is in the past, self-heal to open.
  // B2: guard so a rapid burst of snapshot updates (unreadCount / lastMessageAt
  // flipping while we're mid-write) doesn't retrigger setConversationState 2-3
  // times before Firestore reflects the state="open" change.
  const didWakeRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset the guard whenever a new snooze window is set.
    if (isSnoozed && snoozeUntilIso) didWakeRef.current = null;
  }, [isSnoozed, snoozeUntilIso]);
  useEffect(() => {
    if (!uid || !selfUid) return;
    if (!isSnoozed || !snoozeUntilIso) return;
    const until = Date.parse(snoozeUntilIso);
    if (!Number.isFinite(until)) return;
    if (until > Date.now()) return;
    if (didWakeRef.current === snoozeUntilIso) return;
    didWakeRef.current = snoozeUntilIso;
    setConversationState(
      uid,
      normalizePhone(phone),
      "open",
      { uid: selfUid, email: selfEmail },
      {
        assignedAgentId: conv?.assignedAgentId ?? null,
        previousState: "snoozed",
      },
    ).catch(() => {
      // Allow retry on the next tick if the write actually failed.
      didWakeRef.current = null;
    });
  }, [uid, selfUid, selfEmail, phone, isSnoozed, snoozeUntilIso, conv?.assignedAgentId]);

  const photo = contact?.profileImageUrl ?? conv?.profileImageUrl ?? null;
  const initials = (displayName || phone).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

  // Keyboard shortcuts scoped to an open thread. Declared after all the
  // callbacks and derived state so every dep is in scope. Handlers no-op
  // gracefully when data isn't ready.
  useHotkeys(
    {
      e: () => {
        if (!stateBusy) void onToggleResolve();
      },
      s: () => setSnoozeOpen((v) => !v),
      a: () => {
        if (canAssign) setAssignOpen(true);
      },
      n: () => setNotesOpen(true),
      i: () => setDetailsOpen(true),
      t: () => setActivityOpen(true),
      "/": () => setSearchOpen(true),
      "?": () => setHelpOpen(true),
      Escape: () => {
        if (helpOpen) setHelpOpen(false);
        else if (snoozeOpen) setSnoozeOpen(false);
        else if (activityOpen) setActivityOpen(false);
        else if (detailsOpen) setDetailsOpen(false);
        else if (notesOpen) setNotesOpen(false);
        else if (assignOpen) setAssignOpen(false);
        else if (scheduleOpen) setScheduleOpen(false);
        else if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
        }
      },
    },
    [
      canAssign,
      stateBusy,
      onToggleResolve,
      helpOpen,
      snoozeOpen,
      activityOpen,
      detailsOpen,
      notesOpen,
      assignOpen,
      scheduleOpen,
      searchOpen,
    ],
  );

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setNewSinceScroll(0);
  };

  const waLink = `https://wa.me/${phone.replace(/[^\d]/g, "")}`;

  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col bg-background"
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
        dragCounterRef.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={() => {
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) setIsDragging(false);
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragging(false);
        window.dispatchEvent(
          new CustomEvent("wabees:chat-drop", { detail: { files } }),
        );
      }}
    >
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-3">
        <Link
          to="/inbox"
          aria-label="Back to inbox"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted md:hidden"
        >
          <FontAwesomeIcon icon={faArrowLeft} className="h-4 w-4" />
        </Link>
        <Avatar className="h-9 w-9">
          {photo ? <AvatarImage src={photo} alt={displayName || phone} /> : null}
          <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{displayName || phone}</p>
            {conv && <SlaBadge conv={conv} settings={slaSettings} compact />}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{phone}</span>
            {assignedLabel && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80"
                title={
                  assignedAgent
                    ? `Assigned to ${assignedAgent.email || assignedLabel}${assignedAgent.isOnline ? " (online)" : ""}`
                    : `Assigned to ${assignedLabel}`
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    assignedAgent?.isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
                  }`}
                />
                {assignedLabel}
              </span>
            )}
          </div>
        </div>
        {canAssign && (
          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            aria-label={conv?.assignedAgentEmail ? `Assigned to ${conv.assignedAgentEmail} — reassign` : "Assign to agent"}
            title={conv?.assignedAgentEmail ? `Assigned: ${conv.assignedAgentEmail}` : "Assign to agent"}
            className="hidden h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted md:grid"
          >
            <FontAwesomeIcon icon={faUserPlus} className="h-4 w-4" />
          </button>
        )}
        <div className="relative hidden md:block" data-snooze-menu>
          <button
            type="button"
            disabled={stateBusy}
            onClick={() => setSnoozeOpen((v) => !v)}
            aria-label={isSnoozed ? "Snoozed — change duration" : "Snooze conversation"}
            aria-haspopup="menu"
            aria-expanded={snoozeOpen}
            title={isSnoozed ? "Snoozed — change" : "Snooze"}
            className={`grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:opacity-50 ${
              isSnoozed ? "text-amber-500" : "text-muted-foreground"
            }`}
          >
            <FontAwesomeIcon icon={faMoon} className="h-4 w-4" />
          </button>
          {snoozeOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 min-w-[180px] rounded-lg border border-border bg-card p-1 text-sm shadow-md">
              {[
                { label: "1 hour", h: 1 },
                { label: "4 hours", h: 4 },
                { label: "Tomorrow 9am", h: hoursUntilTomorrow9am() },
                { label: "3 days", h: 72 },
                { label: "1 week", h: 168 },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => void snoozeFor(o.h)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                >
                  {o.label}
                </button>
              ))}
              {isSnoozed && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    onClick={onToggleResolve}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sky-600 hover:bg-muted"
                  >
                    Wake now
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setSearchQuery("");
          }}
          aria-label="Search in chat"
          aria-pressed={searchOpen}
          title="Search in chat"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <FontAwesomeIcon icon={faMagnifyingGlass} className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={async () => {
            const res = await initiateCall({ to: phone });
            if (res.success) toast.success("Calling " + phone);
            else toast.error(res.message || "Couldn't start call");
          }}
          aria-label={`WhatsApp call ${phone}`}
          title="WhatsApp call"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <FontAwesomeIcon icon={faPhone} className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          aria-label="Contact details"
          title="Contact details"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <FontAwesomeIcon icon={faCircleInfo} className="h-4 w-4" />
        </button>
        <div className="relative" data-header-menu>
          <button
            type="button"
            onClick={() => setHeaderMenu((v) => !v)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={headerMenu}
            title="More"
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faEllipsisVertical} className="h-4 w-4" />
          </button>
          {headerMenu && (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[200px] rounded-lg border border-border bg-card p-1 text-sm shadow-md">
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                onClick={() => setHeaderMenu(false)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <FontAwesomeIcon icon={faUpRightFromSquare} className="h-3.5 w-3.5" />
                Open in WhatsApp
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(phone);
                  toast.success("Phone copied");
                  setHeaderMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <FontAwesomeIcon icon={faCopy} className="h-3.5 w-3.5" />
                Copy phone
              </button>
              <a
                href={`tel:${phone}`}
                onClick={() => setHeaderMenu(false)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <FontAwesomeIcon icon={faPhone} className="h-3.5 w-3.5" />
                Call {phone}
              </a>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setNotesOpen(true);
                  setHeaderMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <FontAwesomeIcon icon={faNoteSticky} className="h-3.5 w-3.5" />
                Internal notes
              </button>
              {canAssign && (<button
                type="button"
                onClick={() => {
                  setAssignOpen(true);
                  setHeaderMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <FontAwesomeIcon icon={faUserPlus} className="h-3.5 w-3.5" />
                Assign to agent
                {conv?.assignedAgentEmail && (
                  <span className="ml-auto truncate text-[10px] text-muted-foreground">
                    {conv.assignedAgentEmail}
                  </span>
                )}
              </button>)}
              <button
                type="button"
                onClick={() => {
                  setScheduleOpen(true);
                  setHeaderMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <FontAwesomeIcon icon={faClock} className="h-3.5 w-3.5" />
                Schedule message
              </button>
              <button
                type="button"
                onClick={() => {
                  setActivityOpen(true);
                  setHeaderMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <FontAwesomeIcon icon={faClockRotateLeft} className="h-3.5 w-3.5" />
                Activity timeline
              </button>
              <button
                type="button"
                onClick={() => {
                  setStarredOpen(true);
                  setHeaderMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <FontAwesomeIcon icon={faStar} className="h-3.5 w-3.5 text-amber-500" />
                Starred messages
              </button>
              <button
                type="button"
                onClick={() => {
                  const msgs = data ?? [];
                  if (msgs.length === 0) {
                    toast.error("No messages to export yet");
                    setHeaderMenu(false);
                    return;
                  }
                  const meta = {
                    contactName: conv?.contactName ?? phone,
                    contactPhone: phone,
                  };
                  const base = `wabees-chat-${phone.replace(/\D/g, "")}-${new Date().toISOString().slice(0, 10)}`;
                  downloadBlob(
                    exportChatTxt(msgs, meta),
                    `${base}.txt`,
                    "text/plain;charset=utf-8",
                  );
                  downloadBlob(
                    exportChatCsv(msgs),
                    `${base}.csv`,
                    "text/csv;charset=utf-8",
                  );
                  toast.success(`Exported ${msgs.length} messages`);
                  setHeaderMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <FontAwesomeIcon icon={faFileArrowDown} className="h-3.5 w-3.5" />
                Export chat (TXT + CSV)
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                disabled={stateBusy}
                onClick={onToggleResolve}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted ${
                  isResolved ? "text-sky-600" : "text-emerald-600"
                } disabled:opacity-50`}
              >
                <FontAwesomeIcon
                  icon={isResolved ? faRotateLeft : faCheckDouble}
                  className="h-3.5 w-3.5"
                />
                {isResolved ? "Reopen conversation" : "Mark as resolved"}
              </button>
              {csatSettings.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    if (!uid || !selfUid) return;
                    setHeaderMenu(false);
                    void sendCsatSurvey({
                      ownerUid: uid,
                      phone: normalizePhone(phone),
                      settings: csatSettings,
                      actor: { uid: selfUid, email: selfEmail },
                      assignedAgentId: conv?.assignedAgentId ?? null,
                      assignedAgentEmail: conv?.assignedAgentEmail ?? null,
                    })
                      .then((id) =>
                        id
                          ? toast.success("CSAT survey sent")
                          : toast.error("Could not send CSAT survey"),
                      )
                      .catch((e: unknown) =>
                        toast.error(e instanceof Error ? e.message : "Send failed"),
                      );
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-amber-600 hover:bg-muted"
                >
                  <FontAwesomeIcon icon={faStar} className="h-3.5 w-3.5" />
                  Send CSAT survey now
                </button>
              )}
              <div className="relative" data-snooze-menu>
                <button
                  type="button"
                  disabled={stateBusy}
                  onClick={() => setSnoozeOpen((v) => !v)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-amber-600 hover:bg-muted disabled:opacity-50"
                >
                  <FontAwesomeIcon icon={faMoon} className="h-3.5 w-3.5" />
                  {isSnoozed ? "Snoozed — change" : "Snooze"}
                  <FontAwesomeIcon icon={faChevronDown} className="ml-auto h-3 w-3 opacity-60" />
                </button>
                {snoozeOpen && (
                  <div className="absolute right-full top-0 z-40 mr-1 min-w-[160px] rounded-lg border border-border bg-card p-1 text-sm shadow-md">
                    {[
                      { label: "1 hour", h: 1 },
                      { label: "4 hours", h: 4 },
                      { label: "Tomorrow 9am", h: hoursUntilTomorrow9am() },
                      { label: "3 days", h: 72 },
                      { label: "1 week", h: 168 },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => void snoozeFor(o.h)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                      >
                        {o.label}
                      </button>
                    ))}
                    {isSnoozed && (
                      <>
                        <div className="my-1 h-px bg-border" />
                        <button
                          type="button"
                          onClick={onToggleResolve}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sky-600 hover:bg-muted"
                        >
                          Wake now
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {canBlock && (<button
                type="button"
                disabled={blockBusy}
                onClick={onToggleBlock}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted ${
                  isBlocked ? "text-emerald-600" : "text-destructive"
                } disabled:opacity-50`}
              >
                <FontAwesomeIcon
                  icon={isBlocked ? faCircleCheck : faBan}
                  className="h-3.5 w-3.5"
                />
                {isBlocked ? "Unblock contact" : "Block contact"}
              </button>)}
            </div>
          )}
        </div>
      </header>
      {isBlocked && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          <FontAwesomeIcon icon={faBan} className="h-3.5 w-3.5" />
          <span className="flex-1">
            This contact is blocked. Incoming messages are ignored and you can’t
            send messages.
          </span>
          <button
            type="button"
            onClick={onToggleBlock}
            disabled={blockBusy}
            className="rounded-full border border-destructive/40 px-2.5 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            Unblock
          </button>
        </div>
      )}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <div className="relative flex-1">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setSearchQuery("");
                }
              }}
              placeholder="Search messages…"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
            />
          </div>
          {searchQuery && (
            <span className="text-[11px] text-muted-foreground">
              {(visibleData?.length ?? 0)} match{(visibleData?.length ?? 0) === 1 ? "" : "es"}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Close search"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div
        ref={scrollerRef}
        className="relative flex-1 space-y-2 overflow-y-auto bg-[oklch(0.97_0.005_152)] p-3 dark:bg-background"
      >
        {error && <p className="text-sm text-destructive">{error}</p>}
        {hasMore && visibleData && visibleData.length > 0 && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-soft hover:bg-muted disabled:opacity-60"
            >
              {loadingMore ? (
                <>
                  <FontAwesomeIcon icon={faCircleNotch} className="mr-1.5 h-3 w-3 animate-spin" />
                  Loading…
                </>
              ) : (
                "Load older messages"
              )}
            </button>
          </div>
        )}
        {visibleData === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : visibleData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? "No matching messages" : "No messages yet. Say hi 👋"}
          </p>
        ) : (
          renderedMessages
        )}
        <div ref={bottomRef} />
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-24 right-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:bg-muted"
          aria-label="Scroll to latest"
        >
          <FontAwesomeIcon icon={faChevronDown} className="h-4 w-4" />
          {newSinceScroll > 0 && (
            <span className="absolute -top-1 -right-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {newSinceScroll > 99 ? "99+" : newSinceScroll}
            </span>
          )}
        </button>
      )}
      {isBlocked ? (
        <div className="border-t border-border bg-muted/40 px-4 py-3 text-center text-xs text-muted-foreground">
          Unblock this contact to resume the conversation.
        </div>
      ) : (
        <Composer
          phone={phone}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          lastInboundWamid={
            data?.slice().reverse().find((m) => m.direction === "incoming" && !!m.whatsappMessageId)
              ?.whatsappMessageId ?? null
          }
          lastInboundAt={
            data?.slice().reverse().find((m) => m.direction === "incoming")
              ?.createdAt ?? null
          }
        />
      )}
      {lightboxId && lightboxItems.length > 0 && (
        <MediaLightbox
          items={lightboxItems}
          startId={lightboxId}
          onClose={() => setLightboxId(null)}
        />
      )}
      {forwardMsg && (
        <ForwardDialog message={forwardMsg} onClose={() => setForwardMsg(null)} />
      )}
      <NotesPanel phone={phone} open={notesOpen} onOpenChange={setNotesOpen} />
      <AssignAgentDialog
        phone={phone}
        currentAgentId={conv?.assignedAgentId ?? null}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />
      <ScheduleDialog phone={phone} open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <ActivityDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        phone={phone}
        contactName={conv?.contactName ?? null}
      />
      <ContactDetailsDrawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        phone={phone}
        onOpenMedia={(id) => {
          setDetailsOpen(false);
          setLightboxId(id);
        }}
      />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <StarredDrawer
        open={starredOpen}
        onClose={() => setStarredOpen(false)}
        messages={data ?? []}
        onJump={(id) => {
          // Scroll to the target bubble via data-msg-id set on MessageBubble
          // wrapper. We tag it in the renderer below.
          requestAnimationFrame(() => {
            const el = document.querySelector(
              `[data-msg-id="${CSS.escape(id)}"]`,
            ) as HTMLElement | null;
            if (!el) return;
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("wb-star-flash");
            setTimeout(() => el.classList.remove("wb-star-flash"), 1500);
          });
        }}
      />
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card px-8 py-6 text-primary shadow-lg">
            <FontAwesomeIcon icon={faCloudArrowUp} className="h-8 w-8" />
            <p className="text-sm font-semibold">Drop to send</p>
            <p className="text-xs text-muted-foreground">Photos, videos & documents</p>
          </div>
        </div>
      )}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingCanRevoke
                ? "Delete this message for everyone?"
                : pendingDelete?.direction === "outgoing"
                  ? "Delete from your inbox?"
                  : "Hide this incoming message?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCanRevoke
                ? "It will be removed from the recipient's WhatsApp and from your inbox."
                : pendingDelete?.direction === "outgoing"
                  ? "This message is older than 48h or has no WhatsApp ID, so it can only be hidden on your side — the recipient's copy will remain."
                  : "It will be removed from your inbox only. WhatsApp does not let businesses delete messages from a customer's phone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const m = pendingDelete;
                setPendingDelete(null);
                if (m) void performDelete(m);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function whatsappContextMessageId(message: Message): string | null {
  const raw = message.whatsappMessageId ?? (message.id.startsWith("msg_") ? message.id.slice(4) : null);
  return raw?.replace(/^msg_/, "") ?? null;
}

function dayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  // Within last 7 days: weekday name; otherwise full date
  const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return format(d, "EEEE");
  return format(d, "d MMM yyyy");
}

function renderWithDayDividers(
  msgs: Message[],
  actions: MessageActions,
  firstUnreadId: string | null,
  firstUnreadRef: React.RefObject<HTMLDivElement | null>,
) {
  const nodes: ReactNode[] = [];
  let prev: Date | null = null;
  for (const m of msgs) {
    const d = m.createdAt ? new Date(m.createdAt) : null;
    if (d && (!prev || !isSameDay(prev, d))) {
      nodes.push(
        <div key={`sep-${m.id}`} className="my-2 flex justify-center">
          <span className="rounded-full bg-card px-3 py-1 text-[10px] font-medium text-muted-foreground shadow-soft">
            {dayLabel(d)}
          </span>
        </div>,
      );
      prev = d;
    }
    if (firstUnreadId && m.id === firstUnreadId) {
      nodes.push(
        <div
          key={`unread-${m.id}`}
          ref={firstUnreadRef}
          className="my-2 flex items-center gap-2"
        >
          <div className="h-px flex-1 bg-primary/40" />
          <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Unread messages
          </span>
          <div className="h-px flex-1 bg-primary/40" />
        </div>,
      );
    }
    nodes.push(
      <div key={m.id} data-msg-id={m.id} className="transition-colors">
        <MessageBubble m={m} actions={actions} />
      </div>,
    );
  }
  return nodes;
}
