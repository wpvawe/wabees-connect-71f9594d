import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGoogle } from "@fortawesome/free-brands-svg-icons";
import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { ensureUserDoc } from "@/lib/firebase/users";
import { friendlyAuthError } from "@/lib/auth/firebase-errors";
import { WbButton } from "@/components/wb/WbButton";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function onClick() {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(fbAuth(), provider);
      await ensureUserDoc(cred.user);
      toast.success("Welcome");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(friendlyAuthError(err, "Google sign-in failed"));
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
