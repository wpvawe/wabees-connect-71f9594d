import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { TemplateComposer } from "@/components/templates/TemplateComposer";
import { RequireCapability } from "@/components/auth/RequireCapability";

export const Route = createFileRoute("/_authenticated/templates/new")({
  head: () => ({ meta: [{ title: "New template — Wabees" }] }),
  component: () => (
    <RequireCapability capability="templates.write">
      <NewTemplatePage />
    </RequireCapability>
  ),
});

function NewTemplatePage() {
  return (
    <>
      <TopBar title="New template" subtitle="Design a WhatsApp message template — submit for Meta approval" />
      <WbFirebaseGate>
        <div className="space-y-4 px-4 py-6 sm:px-6">
          <TemplateComposer />
        </div>
      </WbFirebaseGate>
    </>
  );
}