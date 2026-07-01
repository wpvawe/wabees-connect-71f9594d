import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/templates")({
  component: TemplatesLayout,
});

function TemplatesLayout() {
  return <Outlet />;
}
