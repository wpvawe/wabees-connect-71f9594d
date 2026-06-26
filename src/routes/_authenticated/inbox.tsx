import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments } from "@fortawesome/free-solid-svg-icons";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { ConversationList } from "@/components/inbox/ConversationList";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Wabees" }] }),
  component: InboxIndex,
});

function InboxIndex() {
  return (
    <WbFirebaseGate>
      <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
        <ConversationList />
        <section className="hidden flex-1 items-center justify-center bg-background text-muted-foreground md:flex">
          <div className="text-center">
            <FontAwesomeIcon icon={faComments} className="h-10 w-10 opacity-30" />
            <p className="mt-3 text-sm">Select a conversation</p>
          </div>
        </section>
      </div>
    </WbFirebaseGate>
  );
}