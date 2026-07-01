import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { BotsWorkspace } from "@/components/bots/BotsWorkspace";

export const Route = createFileRoute("/_authenticated/bots")({
  head: () => ({
    meta: [
      { title: "Bots — Wabees" },
      { name: "description", content: "Create and manage keyword auto-reply bots for WhatsApp." },
    ],
  }),
  component: BotsPage,
});

function BotsPage() {
  return (
    <>
      <TopBar title="Bots" subtitle="Keyword & rule-based auto-replies" />
      <BotsWorkspace />
    </>
  );
}
