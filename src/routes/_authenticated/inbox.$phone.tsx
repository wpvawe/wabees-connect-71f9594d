import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { MessageBubble, type MessageActions } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { useMessages, type Message } from "@/hooks/useMessages";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { phoneQueryCandidates, whatsappRecipientId } from "@/lib/firebase/normalizers";
import { sendReactionMessage } from "@/lib/wabees/api";
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
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
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
        const batch = writeBatch(fbDb());
        for (const m of unread) {
          batch.set(
            doc(fbDb(), `users/${uid}/messages/${m.id}`),
            { status: "read", readAt: serverTimestamp() },
            { merge: true },
          );
        }
        await batch.commit();
        // Also keep conversation counter at 0.
        for (const candidate of candidates) {
          await setDoc(
            doc(fbDb(), `users/${uid}/conversations/${candidate}`),
            { unreadCount: 0 },
            { merge: true },
          ).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    })();
  }, [uid, phone, data]);

  const onReact = useCallback(
    async (m: Message, emoji: string) => {
      if (!uid || !selfUid) return;
      const wamid = m.whatsappMessageId ?? null;
      try {
        // 1) Update parent so website renders the chip instantly.
        await updateDoc(doc(fbDb(), `users/${uid}/messages/${m.id}`), {
          reactionEmoji: emoji || null,
          reactionMsgId: wamid,
        });
        // 2) Also write a separate reaction event doc — this is the shape the
        //    Flutter app reads to render reactions on outgoing messages.
        if (wamid) {
          await addDoc(collection(fbDb(), `users/${uid}/messages`), {
            contactPhone: m.contactPhone,
            contactName: m.contactName ?? m.contactPhone,
            type: "reaction",
            direction: "outgoing",
            status: "sent",
            body: "",
            reactionEmoji: emoji || null,
            reactionMsgId: `msg_${wamid}`,
            createdAt: serverTimestamp(),
          });
        }
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
      if (
        !confirm(
          "Delete this message?\n\nIt will be hidden on your website and app only. WhatsApp Business API does not support revoking messages from the recipient's phone.",
        )
      )
        return;
      try {
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
    [uid],
  );

  const actions: MessageActions = {
    onReply: setReplyTo,
    onReact,
    onDelete,
  };

  const name =
    data && data.length > 0 && data[0].contactName && data[0].contactName !== phone
      ? data[0].contactName
      : phone;

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
      <div className="flex-1 space-y-2 overflow-y-auto bg-[oklch(0.97_0.005_152)] p-3 dark:bg-background">
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
      <Composer phone={phone} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
    </section>
  );
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
