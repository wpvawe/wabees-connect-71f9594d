import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { useMessages, type Message } from "@/hooks/useMessages";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { phoneQueryCandidates } from "@/lib/firebase/normalizers";

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
        await setDoc(
          doc(fbDb(), `users/${uid}/conversations/${phoneDocId(phone)}`),
          { unreadCount: 0 },
          { merge: true },
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
          renderWithDayDividers(data)
        )}
        <div ref={bottomRef} />
      </div>
      <Composer phone={phone} />
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

function renderWithDayDividers(msgs: Message[]) {
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
    nodes.push(<MessageBubble key={m.id} m={m} />);
  }
  return nodes;
}
