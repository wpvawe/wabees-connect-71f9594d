import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { CampaignDetail } from "@/components/campaigns/CampaignDetail";

export const Route = createFileRoute("/_authenticated/campaigns/$id")({
  head: () => ({ meta: [{ title: "Campaign — Wabees" }] }),
  component: CampaignPage,
});

function CampaignPage() {
  const { id } = Route.useParams();
  return (
    <>
      <TopBar title="Campaign" />
      <WbFirebaseGate>
        <div className="px-4 py-6 sm:px-6">
          <CampaignDetail id={id} />
        </div>
      </WbFirebaseGate>
    </>
  );
}
