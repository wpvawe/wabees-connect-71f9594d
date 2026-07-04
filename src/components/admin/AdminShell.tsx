import { useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faGaugeHigh,
  faUsers,
  faCreditCard,
  faLayerGroup,
  faHeadset,
  faBullhorn,
  faCommentDots,
  faBell,
  faXmark,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { cn } from "@/lib/utils";
import { useAdminNotifications } from "@/hooks/admin/useAdminData";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { OverviewSection } from "@/components/admin/sections/OverviewSection";
import { UsersSection } from "@/components/admin/sections/UsersSection";
import { PendingSubsSection } from "@/components/admin/sections/PendingSubsSection";
import { PlansSection } from "@/components/admin/sections/PlansSection";
import { SupportSection } from "@/components/admin/sections/SupportSection";
import { SystemSection } from "@/components/admin/sections/SystemSection";
import { SubscriptionMessagesEditor } from "@/components/admin/SubscriptionMessagesEditor";

export type AdminSectionKey =
  | "overview"
  | "users"
  | "pending"
  | "plans"
  | "support"
  | "system"
  | "messages";

const NAV: { key: AdminSectionKey; label: string; icon: IconDefinition }[] = [
  { key: "overview", label: "Overview", icon: faGaugeHigh },
  { key: "users", label: "Users", icon: faUsers },
  { key: "pending", label: "Pending Subs", icon: faCreditCard },
  { key: "plans", label: "Plans", icon: faLayerGroup },
  { key: "support", label: "Support", icon: faHeadset },
  { key: "system", label: "System", icon: faBullhorn },
  { key: "messages", label: "Sub Messages", icon: faCommentDots },
];

export function AdminShell() {
  const [section, setSection] = useState<AdminSectionKey>("overview");

  return (
    <>
      <TopBar
        title="Admin panel"
        subtitle="Wabees control center"
        right={<NotificationsBell />}
      />
      <div className="mx-auto flex w-full max-w-7xl gap-4 px-3 py-4 sm:px-6">
        {/* Desktop sidebar */}
        <aside className="hidden shrink-0 md:block">
          <nav className="sticky top-4 w-52 space-y-1">
            {NAV.map((n) => (
              <SidebarButton
                key={n.key}
                icon={n.icon}
                label={n.label}
                active={section === n.key}
                onClick={() => setSection(n.key)}
              />
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile top-scroll pill nav */}
          <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto pb-2 md:hidden">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => setSection(n.key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  section === n.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <FontAwesomeIcon icon={n.icon} className="h-3 w-3" />
                {n.label}
              </button>
            ))}
          </div>

          <SectionSwitch section={section} onNavigate={setSection} />
        </div>
      </div>
    </>
  );
}

function SectionSwitch({
  section,
  onNavigate,
}: {
  section: AdminSectionKey;
  onNavigate: (k: AdminSectionKey) => void;
}): ReactNode {
  switch (section) {
    case "overview":
      return <OverviewSection onNavigate={onNavigate} />;
    case "users":
      return <UsersSection />;
    case "pending":
      return <PendingSubsSection />;
    case "plans":
      return <PlansSection />;
    case "support":
      return <SupportSection />;
    case "system":
      return <SystemSection />;
    case "messages":
      return <SubscriptionMessagesEditor />;
    default:
      return null;
  }
}

function SidebarButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconDefinition;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-soft"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function NotificationsBell() {
  const { notifications, unreadCount, markAllRead } = useAdminNotifications();
  const [open, setOpen] = useState(false);

  async function handleMarkAll() {
    try {
      const n = await markAllRead();
      toast.success(n === 0 ? "Nothing to mark" : `Marked ${n} notification${n === 1 ? "" : "s"} read`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
        aria-label="Notifications"
      >
        <FontAwesomeIcon icon={faBell} className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAll}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    <FontAwesomeIcon icon={faCircleCheck} className="mr-1 h-3 w-3" />
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Nothing here yet.
                </p>
              ) : (
                notifications.slice(0, 20).map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      "border-b border-border/50 px-4 py-3 text-sm last:border-b-0",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-foreground">{n.title}</p>
                      {!n.read && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    {n.createdAt && (
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}