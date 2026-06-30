import { Link } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faBellSlash } from "@fortawesome/free-solid-svg-icons";
import { useEffect, useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { useIncomingMessageAlerts } from "@/hooks/useIncomingMessageAlerts";
import {
  installAutoplayUnlocker,
  isNotificationMuted,
  setNotificationMuted,
  playNotificationChime,
} from "@/lib/notification-sound";

function MuteToggle() {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    installAutoplayUnlocker();
    setMuted(isNotificationMuted());
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !muted;
        setNotificationMuted(next);
        setMuted(next);
        if (!next) playNotificationChime();
      }}
      aria-label={muted ? "Unmute notifications" : "Mute notifications"}
      title={muted ? "Unmute notifications" : "Mute notifications"}
      className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <FontAwesomeIcon icon={muted ? faBellSlash : faBell} className="h-4 w-4" />
    </button>
  );
}

function NotificationBell() {
  const { unread } = useNotifications();
  return (
    <Link
      to="/notifications"
      aria-label="Notifications"
      className="relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <FontAwesomeIcon icon={faBell} className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}

export function TopBar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  useIncomingMessageAlerts();
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <MuteToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
