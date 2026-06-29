import { Link, useRouterState } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faChartLine, faComments, faAddressBook, faBullhorn, faRobot, faFileLines,
  faPlug, faGear, faRightFromBracket, faCrown,
  faChartColumn, faBrain, faUsers, faHeadset, faLink, faBell,
} from "@fortawesome/free-solid-svg-icons";
import { signOut as fbSignOut } from "firebase/auth";
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

export function SideRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  async function signOut() {
    await fbSignOut(fbAuth());
    window.location.assign("/auth");
  }
  return (
    <aside className="hidden w-[72px] shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-4 text-sidebar-foreground md:flex">
      <Link to="/dashboard" className="mb-2">
        <img src={wbIcon} alt="Wabees" className="h-9 w-9 rounded-lg" />
      </Link>
      <nav className="flex flex-1 flex-col items-center gap-1">
        {NAV.map((n) => {
          const active = pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              title={n.label}
              className={cn(
                "grid h-11 w-11 place-items-center rounded-lg transition-colors",
                active ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <FontAwesomeIcon icon={n.icon} className="h-4 w-4" />
            </Link>
          );
        })}
      </nav>
      <Link to="/settings" title="Settings" className="grid h-11 w-11 place-items-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground">
        <FontAwesomeIcon icon={faGear} className="h-4 w-4" />
      </Link>
      <button onClick={signOut} title="Sign out" className="grid h-11 w-11 place-items-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground">
        <FontAwesomeIcon icon={faRightFromBracket} className="h-4 w-4" />
      </button>
    </aside>
  );
}