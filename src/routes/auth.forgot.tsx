import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ForgotForm } from "@/components/auth/ForgotForm";

export const Route = createFileRoute("/auth/forgot")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Forgot password — Wabees" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a secure link."
      footer={
        <Link to="/auth" className="hover:text-foreground">
          ← Back to sign in
        </Link>
      }
    >
      <ForgotForm />
    </AuthLayout>
  ),
});
