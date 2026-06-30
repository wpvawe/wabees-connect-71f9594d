import { Link, useRouterState } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faChartLine,
  faComments,
  faAddressBook,
  faBullhorn,
  faRobot,
  faFileLines,
  faPlug,
  faGear,
  faRightFromBracket,
  faCrown,
  faChartColumn,
  faBrain,
  faUsers,
  faHeadset,
  faLink,
  faBell,
  faAngleDoubleLeft,
  faAngleDoubleRight,
} from "@fortawesome/free-solid-svg-icons";
import { signOut as fbSignOut } from "firebase/auth";
import { useEffect, useState } from "react";
import { fbAuth } from "@/integrations/firebase/client";
import { cn } from "@/lib/utils";
import wbIcon from "@/assets/wabees-icon.png";

const NAV: { to: string; label: string; icon: IconDefinition }[] = [
  { to: "/dashboard", label: "Dashboard", icon: faChartLine },
  { to: "/analytics", label: "Analytics", icon: faChartColumn },
  { to: "/inbox", label: "Inbox", icon: faComments },
  { to: "/contacts", label: "Contacts", icon: faAddressBook },
  { to: "/campaigns", label: "Campaigns", icon: faBullhorn },
  { to: "/bots", label: "Bots", icon: faRobot },
  { to: "/ai-bot", label: "AI Bot", icon: faBrain },
  { to: "/templates", label: "Templates", icon: faFileLines },
  { to: "/plans", label: "Plans", icon: faCrown },
  { to: "/connect", label: "Connect", icon: faPlug },
  { to: "/message-links", label: "Links", icon: faLink },
  { to: "/agents", label: "Agents", icon: faUsers },
  { to: "/notifications", label: "Alerts", icon: faBell },
  { to: "/support", label: "Support", icon: faHeadset },
];

const COLLAPSE_KEY = "wb_sidebar_collapsed";

export function SideRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(COLLAPSE_KEY) !== "0";
  });
  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  async function signOut() {
    await fbSignOut(fbAuth());
    window.location.assign("/auth");
  }
  const itemBase = collapsed
    ? "grid h-11 w-11 place-items-center rounded-lg transition-colors"
    : "flex h-10 w-full items-center gap-3 rounded-lg px-3 transition-colors";
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground transition-[width] duration-200 md:flex",
        collapsed ? "w-[72px] items-center" : "w-[220px] items-stretch px-2",
      )}
    >
      <div
        className={cn(
          "mb-1 flex items-center",
          collapsed ? "w-full flex-col gap-2" : "justify-between gap-2 px-1",
        )}
      >
        <Link to="/dashboard" className="flex items-center gap-2">
          <img src={wbIcon} alt="Wabees" className="h-9 w-9 rounded-lg" />
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-foreground">Wabees</span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className="grid h-8 w-8 place-items-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <FontAwesomeIcon
            icon={collapsed ? faAngleDoubleRight : faAngleDoubleLeft}
            className="h-3.5 w-3.5"
          />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV.map((n) => {
          const active = pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              title={n.label}
              className={cn(
                itemBase,
                active
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <FontAwesomeIcon icon={n.icon} className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate text-sm">{n.label}</span>}
            </Link>
          );
        })}
      </nav>
      <Link
        to="/settings"
        title="Settings"
        className={cn(
          itemBase,
          "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <FontAwesomeIcon icon={faGear} className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate text-sm">Settings</span>}
      </Link>
      <button
        onClick={signOut}
        title="Sign out"
        className={cn(
          itemBase,
          "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <FontAwesomeIcon icon={faRightFromBracket} className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate text-sm">Sign out</span>}
      </button>
    </aside>
  );
}
