import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { CampaignForm } from "@/components/campaigns/CampaignForm";
import { RequireCapability } from "@/components/auth/RequireCapability";

export const Route = createFileRoute("/_authenticated/campaigns/new")({
  head: () => ({ meta: [{ title: "New campaign — Wabees" }] }),
  component: () => (
    <RequireCapability capability="campaigns.write">
      <NewCampaign />
    </RequireCapability>
  ),
});

function NewCampaign() {
  return (
    <>
      <TopBar title="New campaign" subtitle="Pick recipients and write your message" />
      <WbFirebaseGate>
        <div className="px-4 py-6 sm:px-6">
          <CampaignForm />
        </div>
      </WbFirebaseGate>
    </>
  );
}
