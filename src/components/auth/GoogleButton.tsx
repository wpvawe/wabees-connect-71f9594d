import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGoogle } from "@fortawesome/free-brands-svg-icons";
import { useState } from "react";
import { lovable } from "@/integrations/lovable";
import { WbButton } from "@/components/wb/WbButton";
import { toast } from "sonner";

export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  async function onClick() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (result.error) {
        toast.error("Google sign-in failed");
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      window.location.assign("/dashboard");
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