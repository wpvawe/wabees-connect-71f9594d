import { Link, useRouterState } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faComments, faBullhorn, faAddressBook, faFileLines, faGear } from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/dashboard", label: "Home", icon: faChartLine },
  { to: "/inbox", label: "Inbox", icon: faComments },
  { to: "/contacts", label: "Contacts", icon: faAddressBook },
  { to: "/templates", label: "Templates", icon: faFileLines },
  { to: "/campaigns", label: "Send", icon: faBullhorn },
  { to: "/settings", label: "Settings", icon: faGear },
];

export function MobileTabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 backdrop-blur md:hidden">
      {ITEMS.map((i) => {
        const active = pathname.startsWith(i.to);
        return (
          <Link
            key={i.to}
            to={i.to}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <FontAwesomeIcon icon={i.icon} className="h-4 w-4" />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}