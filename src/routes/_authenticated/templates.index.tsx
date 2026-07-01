import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { TemplateGrid } from "@/components/templates/TemplateGrid";

export const Route = createFileRoute("/_authenticated/templates/")({
  head: () => ({ meta: [{ title: "Templates — Wabees" }] }),
  component: TemplatesIndexPage,
});

function TemplatesIndexPage() {
  return (
    <>
      <TopBar title="Templates" subtitle="WhatsApp message templates (approved by Meta)" />
      <WbFirebaseGate>
        <div className="space-y-4 px-4 py-6 sm:px-6">
          <TemplateGrid />
        </div>
      </WbFirebaseGate>
    </>
  );
}