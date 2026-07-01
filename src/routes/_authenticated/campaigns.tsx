import { createFileRoute, Link } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { WbButton } from "@/components/wb/WbButton";
import { CampaignsWorkspace } from "@/components/campaigns/CampaignsWorkspace";

export const Route = createFileRoute("/_authenticated/campaigns")({
  head: () => ({ meta: [{ title: "Campaigns — Wabees" }] }),
  component: CampaignsPage,
});

function CampaignsPage() {
  return (
    <>
      <TopBar
        title="Campaigns"
        subtitle="Broadcast WhatsApp messages to contact lists"
        right={
          <Link to="/campaigns/new">
            <WbButton size="sm">
              <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
              New campaign
            </WbButton>
          </Link>
        }
      />
      <WbFirebaseGate>
        <div className="px-4 py-6 sm:px-6">
          <CampaignsWorkspace />
        </div>
      </WbFirebaseGate>
    </>
  );
}
