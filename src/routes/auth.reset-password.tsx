import { createFileRoute } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ResetForm } from "@/components/auth/ResetForm";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => ({
    meta: [{ title: "Set new password — Wabees" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose something strong — 8 characters or more."
    >
      <ResetForm />
    </AuthLayout>
  ),
});
