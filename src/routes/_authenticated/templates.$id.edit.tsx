import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { TemplateComposer } from "@/components/templates/TemplateComposer";
import { useTemplates } from "@/hooks/useTemplates";
import { RequireCapability } from "@/components/auth/RequireCapability";

export const Route = createFileRoute("/_authenticated/templates/$id/edit")({
  head: () => ({ meta: [{ title: "Edit template — Wabees" }] }),
  component: () => (
    <RequireCapability capability="templates.write">
      <EditTemplatePage />
    </RequireCapability>
  ),
});

function EditTemplatePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data, error } = useTemplates();
  const template = useMemo(() => (data ?? []).find((t) => t.id === id) ?? null, [data, id]);
  return (
    <>
      <TopBar
        title="Edit template"
        subtitle="Update category, body, header, footer, or buttons — Meta will re-review the changes"
      />
      <WbFirebaseGate>
        <div className="space-y-4 px-4 py-6 sm:px-6">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : data === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : !template ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm">
              <p className="text-muted-foreground">Template not found.</p>
              <button
                type="button"
                onClick={() => navigate({ to: "/templates" })}
                className="mt-3 text-sm text-primary underline"
              >
                Back to templates
              </button>
            </div>
          ) : (
            <TemplateComposer initial={template} />
          )}
        </div>
      </WbFirebaseGate>
    </>
  );
}