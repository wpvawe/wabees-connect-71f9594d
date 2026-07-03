import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { BotsWorkspace } from "@/components/bots/BotsWorkspace";
import { RequireCapability } from "@/components/auth/RequireCapability";

export const Route = createFileRoute("/_authenticated/bots")({
  head: () => ({
    meta: [
      { title: "Bots — Wabees" },
      { name: "description", content: "Create and manage keyword auto-reply bots for WhatsApp." },
    ],
  }),
  component: () => (
    <RequireCapability capability="bots.write">
      <BotsPage />
    </RequireCapability>
  ),
});

function BotsPage() {
  return (
    <>
      <TopBar title="Bots" subtitle="Keyword & rule-based auto-replies" />
      <BotsWorkspace />
    </>
  );
}
