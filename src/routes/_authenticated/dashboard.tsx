import { createFileRoute, Link } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlug,
  faComments,
  faBullhorn,
  faRobot,
  faCircleNotch,
  faAddressBook,
  faChartColumn,
  faUsers,
  faBrain,
  faHeadset,
  faArrowUpRightFromSquare,
  faCrown,
  faPaperPlane,
  faUserGroup,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { TopBar } from "@/components/shell/TopBar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { useProfile } from "@/hooks/useProfile";
import { useSubscription } from "@/hooks/useSubscription";
import { useContacts } from "@/hooks/useContacts";
import { useConversations } from "@/hooks/useConversations";
import { useBots } from "@/hooks/useBots";
import { useAgents } from "@/hooks/useAgents";
import { useUsageCounts } from "@/hooks/useUsageCounts";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useCampaignAggregate } from "@/hooks/useCampaignAggregate";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Wabees" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data: wa, loading } = useWhatsAppConfig("effective");
  const session = useFirebaseSession();
  const isAgent =
    session.status === "ready" && !!session.dataOwner && session.dataOwner !== session.uid;
  const sessionLoading = session.status === "loading";
  const { data: profile } = useProfile("effective");
  const { data: subscription } = useSubscription();
  const { data: contacts } = useContacts();
  const { data: conversations } = useConversations();
  const { data: bots } = useBots();
  const { data: agents } = useAgents();
  const { data: usageCounts } = useUsageCounts();
  const { data: campaigns } = useCampaigns();
  const { data: campaignAgg } = useCampaignAggregate();

  // Prefer LIVE counts over cached totals so deletions reflect immediately.
  // Cached counters (profile.totalX / subscription.xUsed) are quota meters
  // that only increment — they leave stale numbers on the dashboard after
  // the user deletes campaigns/contacts/bots.
  const messagesUsed =
    subscription?.messagesUsed ?? profile?.totalMessages ?? usageCounts.messages ?? 0;
  const contactsUsed =
    contacts?.length ?? usageCounts.contacts ?? profile?.totalContacts ?? 0;
  const campaignsUsed =
    campaignAgg?.totalCampaigns ?? campaigns?.length ?? usageCounts.campaigns ?? 0;
  const botsUsed = bots?.length ?? usageCounts.bots ?? profile?.totalBots ?? 0;

  return (
    <>
      <TopBar title="Dashboard" subtitle="Overview of your WhatsApp Business activity" />
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {loading || sessionLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : !wa && isAgent ? (
          <WbEmpty
            icon={faPlug}
            title="Insufficient permissions"
            description="Your access to this workspace has been revoked. Ask the owner to send you a fresh invite."
          />
        ) : !wa ? (
          <WbEmpty
            icon={faPlug}
            title="Connect WhatsApp to get started"
            description="Link your WhatsApp Business number to unlock the inbox, templates, and campaigns."
            action={
              <Link to="/connect">
                <WbButton>Connect WhatsApp</WbButton>
              </Link>
            }
          />
        ) : (
          <>
            {/* Hero — connected status + plan + upgrade */}
            <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-soft sm:p-6">
              <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-primary">
                    Connected
                  </p>
                  <h2 className="mt-1 truncate text-2xl font-semibold text-foreground">
                    {wa.business_name || "WhatsApp Business"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {wa.display_phone ?? wa.phone_number_id}
                    {wa.quality_rating && (
                      <>
                        {" · "}
                        Quality:{" "}
                        <span className="font-medium text-foreground">{wa.quality_rating}</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/80 p-3 backdrop-blur lg:flex-nowrap">
                  <div className="min-w-[140px]">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Current plan
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-base font-semibold text-foreground">
                      <FontAwesomeIcon icon={faCrown} className="h-3.5 w-3.5 text-amber-500" />
                      {subscription?.planName || subscription?.planId || "Free"}
                    </p>
                  </div>
                  <Link to="/plans">
                    <WbButton>
                      Upgrade
                      <FontAwesomeIcon
                        icon={faArrowUpRightFromSquare}
                        className="ml-1.5 h-3 w-3"
                      />
                    </WbButton>
                  </Link>
                </div>
              </div>
            </section>

            {/* Usage stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <UsageStat
                icon={faPaperPlane}
                label="Messages"
                used={messagesUsed}
                max={subscription?.maxMessages ?? 0}
              />
              <UsageStat
                icon={faAddressBook}
                label="Contacts"
                used={contactsUsed}
                max={subscription?.maxContacts ?? 0}
              />
              <UsageStat
                icon={faBullhorn}
                label="Campaigns"
                used={campaignsUsed}
                max={subscription?.maxCampaigns ?? 0}
              />
              <UsageStat
                icon={faRobot}
                label="Bots"
                used={botsUsed}
                max={subscription?.maxBots ?? 0}
              />
            </div>

            {/* Quick actions */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <QuickAction to="/analytics" icon={faChartColumn} label="Analytics" />
              <QuickAction to="/agents" icon={faUsers} label="Agents" />
              <QuickAction to="/ai-bot" icon={faBrain} label="AI Bot" />
              <QuickAction to="/support" icon={faHeadset} label="Support" />
            </div>

            {/* Latest sections — only render when non-empty */}
            <div className="grid gap-4 lg:grid-cols-2">
              {conversations && conversations.length > 0 && (
                <LatestCard
                  title="Latest messages"
                  icon={faComments}
                  viewAllTo="/inbox"
                  items={conversations.slice(0, 5).map((c) => ({
                    key: c.contactPhone,
                    primary: c.contactName || c.contactPhone,
                    secondary: c.lastMessage || "—",
                    meta: relTime(c.lastMessageAt),
                    badge: c.unreadCount > 0 ? String(c.unreadCount) : null,
                    to: "/inbox/$phone",
                    params: { phone: c.contactPhone },
                  }))}
                />
              )}
              {contacts && contacts.length > 0 && (
                <LatestCard
                  title="Latest contacts"
                  icon={faAddressBook}
                  viewAllTo="/contacts"
                  items={[...contacts]
                    .sort((a, b) =>
                      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
                    )
                    .slice(0, 5)
                    .map((c) => ({
                      key: c.id,
                      primary: c.name || c.phone,
                      secondary: c.phone,
                      meta: relTime(c.createdAt),
                      badge: null,
                      to: "/contacts",
                    }))}
                />
              )}
              {bots && bots.length > 0 && (
                <LatestCard
                  title="Latest bots"
                  icon={faRobot}
                  viewAllTo="/bots"
                  items={bots.slice(0, 5).map((b) => ({
                    key: b.id,
                    primary: b.name,
                    secondary: b.isActive ? "Active" : "Paused",
                    meta: relTime(b.updatedAt ?? b.createdAt),
                    badge: b.totalTriggered > 0 ? `${b.totalTriggered} runs` : null,
                    to: "/bots",
                  }))}
                />
              )}
              {agents && agents.length > 0 && (
                <LatestCard
                  title="Latest agents"
                  icon={faUserGroup}
                  viewAllTo="/agents"
                  items={agents.slice(0, 5).map((a) => ({
                    key: a.id,
                    primary: a.email || a.id,
                    secondary: a.role || "Agent",
                    meta: relTime(a.joinedAt),
                    badge: null,
                    to: "/agents",
                  }))}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: IconDefinition; label: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      </span>
    </Link>
  );
}

function UsageStat({
  icon,
  label,
  used,
  max,
}: {
  icon: IconDefinition;
  label: string;
  used: number;
  max: number;
}) {
  const unlimited = !max || max <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / max) * 100));
  const danger = pct >= 90;
  const warn = pct >= 70 && pct < 90;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/10 text-primary">
          <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">
        {used.toLocaleString()}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          / {unlimited ? "∞" : max.toLocaleString()}
        </span>
      </p>
      {!unlimited && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              danger ? "bg-destructive" : warn ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

type LatestItem = {
  key: string;
  primary: string;
  secondary: string;
  meta: string;
  badge: string | null;
  to: string;
  params?: Record<string, string>;
};

function LatestCard({
  title,
  icon,
  viewAllTo,
  items,
}: {
  title: string;
  icon: IconDefinition;
  viewAllTo: string;
  items: LatestItem[];
}) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-soft">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
            <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <Link
          to={viewAllTo}
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </header>
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const row = (
            <div className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{it.primary}</p>
                <p className="truncate text-xs text-muted-foreground">{it.secondary}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {it.badge && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {it.badge}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">{it.meta}</span>
              </div>
            </div>
          );
          return (
            <li key={it.key}>
              {it.params ? (
                <Link to={it.to} params={it.params}>
                  {row}
                </Link>
              ) : (
                <Link to={it.to}>{row}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}
