import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { MessageBubble, type MessageActions } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { useMessages, type Message } from "@/hooks/useMessages";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { phoneQueryCandidates, whatsappRecipientId } from "@/lib/firebase/normalizers";
import { sendReactionMessage, markMessageRead, deleteWhatsAppMessage } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/inbox/$phone")({
  head: ({ params }) => ({ meta: [{ title: `Chat ${params.phone} — Wabees` }] }),
  component: InboxThread,
});

function InboxThread() {
  const { phone } = Route.useParams();
  return <Thread phone={phone} />;
}

function Thread({ phone }: { phone: string }) {
  const { data, error } = useMessages(phone);
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastLenRef = useRef(0);
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
    }
  }, [data?.length]);

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
      try {
        // 1) Update parent so website renders the chip instantly.
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          reactionEmoji: emoji || null,
          reactionMsgId: reactionTargetId,
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
            emoji,
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

  const actions: MessageActions = {
    onReply: setReplyTo,
    onReact,
    onDelete,
  };

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

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-3">
        <Link
          to="/inbox"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted md:hidden"
        >
          <FontAwesomeIcon icon={faArrowLeft} className="h-4 w-4" />
        </Link>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {(name || phone).slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <p className="text-[11px] text-muted-foreground">{phone}</p>
        </div>
      </header>
      <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto bg-[oklch(0.97_0.005_152)] p-3 dark:bg-background">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hi 👋
          </p>
        ) : (
          renderWithDayDividers(data, actions)
        )}
        <div ref={bottomRef} />
      </div>
      <Composer
        phone={phone}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        lastInboundWamid={
          data?.slice().reverse().find((m) => m.direction === "incoming" && !!m.whatsappMessageId)
            ?.whatsappMessageId ?? null
        }
      />
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
