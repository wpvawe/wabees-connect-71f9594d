import { createFileRoute } from "@tanstack/react-router";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments } from "@fortawesome/free-solid-svg-icons";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { ConversationList } from "@/components/inbox/ConversationList";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Wabees" }] }),
  component: InboxIndex,
});

function InboxIndex() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hasChild = pathname !== "/inbox" && pathname !== "/inbox/";
  const activePhone = hasChild
    ? decodeURIComponent(pathname.replace(/^\/inbox\//, "").split(/[/?#]/)[0])
    : undefined;
  return (
    <WbFirebaseGate>
      <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
        {/* On mobile, hide the list when a chat is open so the thread takes the full screen. */}
        <div className={hasChild ? "hidden md:block" : "block w-full md:block md:w-auto"}>
          <ConversationList activePhone={activePhone} />
        </div>
        {hasChild ? (
          <Outlet />
        ) : (
          <section className="hidden flex-1 items-center justify-center bg-background text-muted-foreground md:flex">
            <div className="text-center">
              <FontAwesomeIcon icon={faComments} className="h-10 w-10 opacity-30" />
              <p className="mt-3 text-sm">Select a conversation</p>
            </div>
          </section>
        )}
      </div>
    </WbFirebaseGate>
  );
}
