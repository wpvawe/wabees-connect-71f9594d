import { createFileRoute } from "@tanstack/react-router";
import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbEmpty } from "@/components/wb/WbEmpty";

export const Route = createFileRoute("/_authenticated/bots")({
  head: () => ({ meta: [{ title: "Bots — Wabees" }] }),
  component: BotsPage,
});

function BotsPage() {
  return (
    <>
      <TopBar title="Bots" subtitle="AI + rule-based auto-replies" />
      <div className="px-4 py-6 sm:px-6">
        <WbEmpty
          icon={faRobot}
          title="Coming in Phase 4"
          description="DeepSeek AI replies and keyword rules will live here. The Flutter app already manages bots — those will appear automatically once we wire the UI."
        />
      </div>
    </>
  );
}