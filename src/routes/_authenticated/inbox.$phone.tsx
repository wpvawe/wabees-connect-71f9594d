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
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { MessageBubble, type MessageActions } from "@/components/inbox/MessageBubble";
import { useCan } from "@/lib/auth/permissions";
import { Composer } from "@/components/inbox/Composer";
import { MediaLightbox, type LightboxItem } from "@/components/inbox/MediaLightbox";
import { ForwardDialog } from "@/components/inbox/ForwardDialog";
import { NotesPanel } from "@/components/inbox/NotesPanel";
import { AssignAgentDialog } from "@/components/inbox/AssignAgentDialog";
import { ScheduleDialog } from "@/components/inbox/ScheduleDialog";
import { ActivityDrawer } from "@/components/inbox/ActivityDrawer";
import { setConversationState } from "@/lib/firebase/assignments";
import { addSystemNote } from "@/lib/firebase/notes";
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
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { useContacts } from "@/hooks/useContacts";
import { useConversations } from "@/hooks/useConversations";
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
  const { data, error } = useMessages(phone);
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
  const [blockBusy, setBlockBusy] = useState(false);
  const [stateBusy, setStateBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastLenRef = useRef(0);
  const dragCounterRef = useRef(0);
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
      bottomRef.current?.scrollIntoView({ behavior: prevLen === 0 ? "auto" : "smooth", block: "end" });
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
      if (!t.closest?.("[data-header-menu]")) setHeaderMenu(false);
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
    void (async () => {
      try {
        const candidates = phoneQueryCandidates(phone);
        // C-4 fix: Firestore batches cap at 500 ops. Chunk so large unread
        // backlogs don't silently throw and leave messages forever-unread.
        const CHUNK = 450;
        for (let i = 0; i < unread.length; i += CHUNK) {
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
        // Also keep conversation counter at 0.
        for (const candidate of candidates) {
          await setDoc(
            doc(fbDb(), `users/${uid}/conversations/${candidate}`),
            { unreadCount: 0 },
            { merge: true },
          ).catch(() => {});
        }
        // L-1 fix: also tell Meta the messages are read so the customer's
        // phone shows blue ticks. Best-effort & dedup'd by wamid.
        if (selfUid) {
          try {
            const creds = await loadWaCredentials(selfUid);
            if (creds) {
              const seen = new Set<string>();
              for (const m of unread) {
                const wamid = m.whatsappMessageId;
                if (!wamid || seen.has(wamid)) continue;
                seen.add(wamid);
                await markMessageRead({
                  phone_number_id: creds.phone_number_id,
                  access_token: creds.access_token,
                  message_id: wamid,
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
          const creds = await loadWaCredentials(selfUid);
          if (!creds) return;
          await sendReactionMessage({
            phone_number_id: creds.phone_number_id,
            access_token: creds.access_token,
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

  const onDelete = useCallback(
    async (m: Message) => {
      if (!uid) return;
      // Outgoing + has wamid + within ~48h → can revoke for everyone via Meta.
      const canRevoke =
        m.direction === "outgoing" &&
        !!m.whatsappMessageId &&
        (() => {
          if (!m.createdAt) return false;
          const ageHours = (Date.now() - new Date(m.createdAt).getTime()) / 36e5;
          return ageHours < 48;
        })();
      const prompt = canRevoke
        ? "Delete this message for everyone?\n\nIt will be removed from the recipient's WhatsApp and from your inbox."
        : m.direction === "outgoing"
          ? "Delete from your inbox?\n\nThis message is older than 48h or has no WhatsApp ID, so it can only be hidden on your side — the recipient's copy will remain."
          : "Hide this incoming message?\n\nIt will be removed from your inbox only. WhatsApp does not let businesses delete messages from a customer's phone.";
      if (!confirm(prompt)) return;
      try {
        if (canRevoke && selfUid && m.whatsappMessageId) {
          try {
            const creds = await loadWaCredentials(selfUid);
            if (creds) {
              const res = await deleteWhatsAppMessage({
                phone_number_id: creds.phone_number_id,
                access_token: creds.access_token,
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

  const onResend = useCallback(
    async (m: Message) => {
      if (!uid || !selfUid) return;
      const creds = await loadWaCredentials(selfUid).catch(() => null);
      if (!creds) {
        toast.error("Connect WhatsApp first");
        return;
      }
      try {
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          status: "pending",
          errorReason: null,
        });
        const to = whatsappRecipientId(phone);
        let res;
        if (m.type === "text") {
          res = await sendTextMessage({
            phone_number_id: creds.phone_number_id,
            access_token: creds.access_token,
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
          res = await sendMediaMessage({
            phone_number_id: creds.phone_number_id,
            access_token: creds.access_token,
            to,
            type: m.type,
            ...(m.mediaId ? { media_id: m.mediaId } : m.mediaUrl ? { media_url: m.mediaUrl } : {}),
            ...(m.caption ? { caption: m.caption } : {}),
            ...(m.fileName ? { filename: m.fileName } : {}),
            context_message_id: m.replyToWamid ?? null,
          });
        } else {
          toast.error("Cannot resend this message type");
          return;
        }
        const wamid = extractWamid(res.raw);
        if (!res.success) {
          await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
            status: "failed",
            errorReason: res.message ?? "Send failed",
          });
          toast.error(res.message ?? "Send failed");
          return;
        }
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          status: "sent",
          whatsappMessageId: wamid,
        });
        toast.success("Resent");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Resend failed");
      }
    },
    [uid, selfUid, phone],
  );

  const actions: MessageActions = {
    onReply: setReplyTo,
    onReact,
    onDelete,
    onForward: setForwardMsg,
    onOpenMedia: (m) => setLightboxId(m.id),
    onResend,
  };

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

  const lightboxItems: LightboxItem[] = (data ?? [])
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
    }));

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
      const convId = normalizePhone(phone);
      await setDoc(
        doc(fbDb(), `users/${uid}/conversations/${convId}`),
        {
          isBlocked: !isBlocked,
          blockedAt: !isBlocked ? serverTimestamp() : null,
          contactPhone: convId,
        },
        { merge: true },
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setStateBusy(false);
      setHeaderMenu(false);
    }
  }, [uid, selfUid, selfEmail, phone, isResolved]);

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
  useEffect(() => {
    if (!uid || !selfUid) return;
    if (!isSnoozed || !snoozeUntilIso) return;
    const until = Date.parse(snoozeUntilIso);
    if (!Number.isFinite(until)) return;
    if (until > Date.now()) return;
    setConversationState(
      uid,
      normalizePhone(phone),
      "open",
      { uid: selfUid, email: selfEmail },
      {
        assignedAgentId: conv?.assignedAgentId ?? null,
        previousState: "snoozed",
      },
    ).catch(() => {});
  }, [uid, selfUid, selfEmail, phone, isSnoozed, snoozeUntilIso, conv?.assignedAgentId]);

  const photo = contact?.profileImageUrl ?? conv?.profileImageUrl ?? null;
  const initials = (displayName || phone).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

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
          <p className="text-[11px] text-muted-foreground">{phone}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setSearchQuery("");
          }}
          title="Search in chat"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <FontAwesomeIcon icon={faMagnifyingGlass} className="h-4 w-4" />
        </button>
        <a
          href={`tel:${phone}`}
          title="Call"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <FontAwesomeIcon icon={faPhone} className="h-4 w-4" />
        </a>
        <div className="relative" data-header-menu>
          <button
            type="button"
            onClick={() => setHeaderMenu((v) => !v)}
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
              <div className="relative" data-header-menu>
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
          renderWithDayDividers(visibleData, actions)
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
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card px-8 py-6 text-primary shadow-lg">
            <FontAwesomeIcon icon={faCloudArrowUp} className="h-8 w-8" />
            <p className="text-sm font-semibold">Drop to send</p>
            <p className="text-xs text-muted-foreground">Photos, videos & documents</p>
          </div>
        </div>
      )}
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

function renderWithDayDividers(msgs: Message[], actions: MessageActions) {
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
    nodes.push(<MessageBubble key={m.id} m={m} actions={actions} />);
  }
  return nodes;
}
