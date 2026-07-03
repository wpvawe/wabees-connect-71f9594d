import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faCheckDouble, faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { doc, updateDoc, writeBatch } from "firebase/firestore";
import { formatDistanceToNowStrict } from "date-fns";
import { TopBar } from "@/components/shell/TopBar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { fbDb } from "@/integrations/firebase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Wabees" }] }),
  component: NotificationsPage,
});

const ICONS: Record<string, string> = {
  plan_activated: "✅",
  plan_rejected: "❌",
  campaign_completed: "🚀",
  new_support_message: "💬",
  bot_triggered: "🤖",
  template_approved: "📝",
  template_rejected: "📝",
  new_message: "💬",
  system: "🔔",
};

function NotificationsPage() {
  const uid = useEffectiveUid();
  const { data, error } = useNotifications();

  async function markOne(n: AppNotification) {
    if (!uid || n.read) return;
    try {
      await updateDoc(doc(fbDb(), "users", uid, "notifications", n.id), { read: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function markAll() {
    if (!uid || !data) return;
    const unread = data.filter((n) => !n.read);
    if (!unread.length) return;
    try {
      const batch = writeBatch(fbDb());
      for (const n of unread)
        batch.update(doc(fbDb(), "users", uid, "notifications", n.id), { read: true });
      await batch.commit();
      toast.success("Marked all read");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <>
      <TopBar
        title="Notifications"
        subtitle="Updates from your WhatsApp Business account"
        right={
          <WbButton variant="secondary" size="sm" onClick={markAll}>
            <FontAwesomeIcon icon={faCheckDouble} className="h-3.5 w-3.5" /> Mark all read
          </WbButton>
        }
      />
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : data.length === 0 ? (
          <WbEmpty
            icon={faBell}
            title="No notifications yet"
            description="System events will appear here in realtime."
          />
        ) : (
          <ul className="space-y-2">
            {data.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => markOne(n)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted",
                    !n.read && "border-primary/40 bg-accent/30",
                  )}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-base">
                    {ICONS[n.type] ?? "🔔"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          "truncate text-sm",
                          n.read ? "text-foreground" : "font-semibold text-foreground",
                        )}
                      >
                        {n.title || n.type}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {n.createdAt
                          ? formatDistanceToNowStrict(new Date(n.createdAt), { addSuffix: true })
                          : ""}
                      </span>
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                    )}
                  </div>
                  {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
