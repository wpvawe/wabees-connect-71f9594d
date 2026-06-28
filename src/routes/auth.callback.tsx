import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing you in — Wabees" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 20; i++) {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) {
          toast.error("Sign-in failed");
          navigate({ to: "/auth" });
          return;
        }
        if (data.session) {
          navigate({ to: "/dashboard" });
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      toast.error("Sign-in timed out");
      navigate({ to: "/auth" });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}