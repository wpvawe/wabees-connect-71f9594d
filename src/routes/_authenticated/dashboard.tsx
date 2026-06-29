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
} from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { useProfile } from "@/hooks/useProfile";
import { useSubscription } from "@/hooks/useSubscription";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Wabees" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data: wa, loading } = useWhatsAppConfig();
  const { data: profile } = useProfile("effective");
  const { data: subscription } = useSubscription();

  return (
    <>
      <TopBar title="Dashboard" subtitle="Overview of your WhatsApp Business activity" />
      <div className="space-y-6 px-4 py-6 sm:px-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Stat
                icon={faComments}
                label="Messages"
                value={String(profile?.totalMessages ?? "—")}
              />
              <Stat
                icon={faAddressBook}
                label="Contacts"
                value={String(profile?.totalContacts ?? "—")}
              />
              <Stat
                icon={faBullhorn}
                label="Campaigns"
                value={String(profile?.totalCampaigns ?? "—")}
              />
              <Stat icon={faRobot} label="Bots" value={String(profile?.totalBots ?? "—")} />
              <Stat icon={faPlug} label="Plan" value={subscription?.planName ?? "—"} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <QuickAction to="/analytics" icon={faChartColumn} label="Analytics" />
              <QuickAction to="/agents" icon={faUsers} label="Agents" />
              <QuickAction to="/ai-bot" icon={faBrain} label="AI Bot" />
              <QuickAction to="/support" icon={faHeadset} label="Support" />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: typeof faPlug; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-soft transition-colors hover:bg-muted"
    >
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <FontAwesomeIcon icon={icon} className="h-4 w-4 text-primary" />
    </Link>
  );
}

function Stat({ icon, label, value }: { icon: typeof faPlug; label: string; value: string }) {
  return (
    <WbCard>
      <WbCardBody>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <FontAwesomeIcon icon={icon} className="h-4 w-4 text-primary" />
        </div>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </WbCardBody>
    </WbCard>
  );
}
