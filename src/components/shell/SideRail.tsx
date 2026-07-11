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
  faGaugeHigh,
  faHeadset,
  faLink,
  faBell,
  faBullseye,
  faPhoneVolume,
  faAngleDoubleLeft,
  faAngleDoubleRight,
} from "@fortawesome/free-solid-svg-icons";
import { signOut as fbSignOut } from "firebase/auth";
import { useEffect, useState } from "react";
import { fbAuth } from "@/integrations/firebase/client";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/useProfile";
import { useCan } from "@/lib/auth/permissions";
import wbIcon from "@/assets/wabees-icon.png";

import type { Capability } from "@/lib/auth/permissions";

type NavItem = { to: string; label: string; icon: IconDefinition; require?: Capability };
type NavGroup = { label: string; items: NavItem[] };

// Grouped like the leading WhatsApp Business SaaS tools (Wati, DoubleTick,
// AiSensy): a short "Overview" pinned at the top, then feature areas grouped
// by intent, then Team, then Setup at the bottom near Settings.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: faChartLine },
      { to: "/analytics", label: "Analytics", icon: faChartColumn },
    ],
  },
  {
    label: "Messaging",
    items: [
      { to: "/inbox", label: "Inbox", icon: faComments },
      { to: "/calls", label: "Calls", icon: faPhoneVolume },
      { to: "/contacts", label: "Contacts", icon: faAddressBook },
      { to: "/templates", label: "Templates", icon: faFileLines },
    ],
  },
  {
    label: "Growth",
    items: [
      { to: "/campaigns", label: "Campaigns", icon: faBullhorn, require: "campaigns.write" },
      { to: "/message-links", label: "Links", icon: faLink, require: "billing.manage" },
      { to: "/leads", label: "Leads", icon: faBullseye, require: "billing.manage" },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/bots", label: "Bots", icon: faRobot, require: "bots.write" },
      { to: "/ai-bot", label: "AI Bot", icon: faBrain, require: "aiBot.manage" },
    ],
  },
  {
    label: "Team",
    items: [
      { to: "/agents", label: "Agents", icon: faUsers },
      { to: "/workload", label: "Workload", icon: faGaugeHigh, require: "team.manage" },
      { to: "/support", label: "Support", icon: faHeadset, require: "support.chat" },
    ],
  },
  {
    label: "Setup",
    items: [
      { to: "/connect", label: "Connect", icon: faPlug, require: "whatsapp.connect" },
      { to: "/plans", label: "Plans", icon: faCrown, require: "billing.manage" },
      { to: "/notifications", label: "Alerts", icon: faBell },
    ],
  },
];

const COLLAPSE_KEY = "wb_sidebar_collapsed";

export function SideRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: profile } = useProfile("effective");
  const aiBotVisible = Boolean(profile?.aiBotEnabled);
  const can = useCan();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(COLLAPSE_KEY) !== "0";
  });
  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  async function signOut() {
    // BUG-17/BUG-18 — see settings.tsx signOut for rationale.
    try {
      const { clearDocBrokerRegistry } = await import("@/lib/firebase/docBroker");
      const { clearDashboardPreviewCache } = await import("@/hooks/useDashboardPreview");
      clearDocBrokerRegistry();
      clearDashboardPreviewCache();
    } catch {
      /* best-effort */
    }
    await fbSignOut(fbAuth());
    window.location.assign("/auth");
  }
  const itemBase = collapsed
    ? "group relative grid h-10 w-10 place-items-center rounded-lg transition-colors"
    : "group relative flex h-9 w-full items-center gap-3 rounded-md px-3 transition-colors";

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items
      .filter((n) => n.to !== "/ai-bot" || aiBotVisible)
      .filter((n) => !n.require || can(n.require)),
  })).filter((g) => g.items.length > 0);

  const renderItem = (n: NavItem) => {
    const active = pathname.startsWith(n.to);
    return (
      <Link
        key={n.to}
        to={n.to}
        title={n.label}
        className={cn(
          itemBase,
          active
            ? "bg-sidebar-accent text-sidebar-primary font-medium"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        {active && !collapsed && (
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-sidebar-primary"
          />
        )}
        <FontAwesomeIcon icon={n.icon} className="h-[15px] w-[15px] shrink-0" />
        {!collapsed && <span className="truncate text-[13px]">{n.label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
        collapsed ? "w-[64px] items-center py-3" : "w-[232px] items-stretch py-3",
      )}
    >
      <div
        className={cn(
          "flex items-center",
          collapsed ? "w-full flex-col gap-2 pb-2" : "justify-between gap-2 px-3 pb-3",
        )}
      >
        <Link to="/dashboard" className="flex items-center gap-2">
          <img src={wbIcon} alt="Wabees" className="h-8 w-8 rounded-lg" />
          {!collapsed && (
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Wabees
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className="grid h-7 w-7 place-items-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <FontAwesomeIcon
            icon={collapsed ? faAngleDoubleRight : faAngleDoubleLeft}
            className="h-3 w-3"
          />
        </button>
      </div>
      <nav
        className={cn(
          "flex flex-1 flex-col overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          collapsed ? "items-center gap-1 px-0" : "gap-4 px-2",
        )}
      >
        {visibleGroups.map((group, idx) => (
          <div
            key={group.label}
            className={cn(
              "flex flex-col",
              collapsed ? "w-full items-center gap-1" : "gap-0.5",
            )}
          >
            {!collapsed && (
              <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">
                {group.label}
              </div>
            )}
            {collapsed && idx > 0 && (
              <div className="my-1 h-px w-6 bg-sidebar-border/60" aria-hidden />
            )}
            {group.items.map(renderItem)}
          </div>
        ))}
      </nav>
      <div
        className={cn(
          "mt-2 flex flex-col border-t border-sidebar-border pt-2",
          collapsed ? "w-full items-center gap-1" : "gap-0.5 px-2",
        )}
      >
        {renderItem({ to: "/settings", label: "Settings", icon: faGear })}
        <button
          type="button"
          onClick={signOut}
          title="Sign out"
          className={cn(
            itemBase,
            "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <FontAwesomeIcon icon={faRightFromBracket} className="h-[15px] w-[15px] shrink-0" />
          {!collapsed && <span className="truncate text-[13px]">Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
