import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SideRail } from "@/components/shell/SideRail";
import { MobileTabBar } from "@/components/shell/MobileTabBar";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppShell,
});

function AppShell() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <SideRail />
      <main className="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}