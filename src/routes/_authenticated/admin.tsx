import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faLock } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { useProfile } from "@/hooks/useProfile";
import { AdminShell } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Wabees" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { data: profile, loading: profileLoading } = useProfile();
  const isAdmin = profile?.role === "admin";

  if (profileLoading) {
    return (
      <>
        <TopBar title="Admin" />
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <TopBar title="Admin" />
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <FontAwesomeIcon icon={faLock} className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">Restricted area</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only workspace administrators can open this section.
          </p>
        </div>
      </>
    );
  }

  return <AdminShell />;
}