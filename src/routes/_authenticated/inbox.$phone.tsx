import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { ConversationList } from "@/components/inbox/ConversationList";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { useMessages } from "@/hooks/useMessages";

export const Route = createFileRoute("/_authenticated/inbox/$phone")({
  head: ({ params }) => ({ meta: [{ title: `Chat ${params.phone} — Wabees` }] }),
  component: InboxThread,
});

function InboxThread() {
  const { phone } = Route.useParams();
  return (
    <WbFirebaseGate>
      <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
        <div className="hidden md:block">
          <ConversationList activePhone={phone} />
        </div>
        <Thread phone={phone} />
      </div>
    </WbFirebaseGate>
  );
}

function Thread({ phone }: { phone: string }) {
  const { data, error } = useMessages(phone);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [data?.length]);
  const name =
    data && data.length > 0 && data[0].contactName && data[0].contactName !== phone
      ? data[0].contactName
      : phone;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-3">
        <Link to="/inbox" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted md:hidden">
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
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet. Say hi 👋</p>
        ) : (
          data.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
        <div ref={bottomRef} />
      </div>
      <Composer phone={phone} />
    </section>
  );
}