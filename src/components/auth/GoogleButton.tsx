import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGoogle } from "@fortawesome/free-brands-svg-icons";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { WbButton } from "@/components/wb/WbButton";
import { toast } from "sonner";

export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  async function onClick() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        toast.error("Google sign-in failed");
        setLoading(false);
        return;
      }
      // Browser redirects to Google; nothing else to do here.
    } catch {
      toast.error("Google sign-in failed");
      setLoading(false);
    }
  }
  return (
    <WbButton type="button" variant="secondary" fullWidth loading={loading} onClick={onClick}>
      <FontAwesomeIcon icon={faGoogle} className="h-4 w-4 text-[#EA4335]" />
      {label}
    </WbButton>
  );
}