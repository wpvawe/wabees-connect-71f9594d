import { Link } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faVolumeHigh, faVolumeXmark } from "@fortawesome/free-solid-svg-icons";
import { useEffect, useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { useIncomingMessageAlerts } from "@/hooks/useIncomingMessageAlerts";
import { AvailabilityToggle } from "@/components/shell/AvailabilityToggle";
import {
  installAutoplayUnlocker,
  isNotificationMuted,
  setNotificationMuted,
  playNotificationChime,
} from "@/lib/notification-sound";
import { cn } from "@/lib/utils";

function MuteToggle() {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    installAutoplayUnlocker();
    setMuted(isNotificationMuted());
  }, []);
  const label = muted ? "Sounds muted — click to unmute" : "Sounds on — click to mute";
  return (
    <button
      type="button"
      onClick={() => {
        const next = !muted;
        setNotificationMuted(next);
        setMuted(next);
        if (!next) playNotificationChime();
      }}
      aria-label={label}
      aria-pressed={!muted}
      title={label}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        muted
          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400",
      )}
    >
      <FontAwesomeIcon
        icon={muted ? faVolumeXmark : faVolumeHigh}
        className="h-3.5 w-3.5"
      />
      <span className="hidden sm:inline">{muted ? "Muted" : "On"}</span>
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
        <AvailabilityToggle />
        <MuteToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
