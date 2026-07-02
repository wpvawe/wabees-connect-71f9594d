import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthTabs } from "@/components/auth/AuthTabs";
import { Link } from "@tanstack/react-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";

export const Route = createFileRoute("/auth/")({
  ssr: false,
  beforeLoad: async () => {
    const auth = fbAuth();
    const user: User | null =
      auth.currentUser ??
      (await new Promise<User | null>((resolve) => {
        const unsub = onAuthStateChanged(auth, (u) => {
          unsub();
          resolve(u);
        });
      }));
    if (user) throw redirect({ to: "/dashboard" });
  },
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
        <Link to="/" className="hover:text-foreground">
          ← Back to home
        </Link>
      }
    >
      <AuthTabs />
    </AuthLayout>
  );
}
