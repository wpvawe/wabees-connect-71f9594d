import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthTabs } from "@/components/auth/AuthTabs";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "Sign in — Wabees" },
      {
        name: "description",
        content:
          "Sign in or create your free Wabees account and connect your WhatsApp Business in one click.",
      },
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
      footer={
        <a href="https://wabees.live" className="hover:text-foreground">
          ← Back to home
        </a>
      }
    >
      <AuthTabs />
    </AuthLayout>
  );
}
