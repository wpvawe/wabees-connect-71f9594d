import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthTabs } from "@/components/auth/AuthTabs";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Wabees" },
      { name: "description", content: "Sign in or create your free Wabees account and connect your WhatsApp Business in one click." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  return (
    <AuthLayout
      title="Welcome to Wabees"
      subtitle="Run your WhatsApp Business like a real team."
      footer={<Link to="/" className="hover:text-foreground">← Back to home</Link>}
    >
      <AuthTabs />
    </AuthLayout>
  );
}