import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetSchema, type ResetValues } from "@/lib/schemas/auth";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { confirmPasswordReset } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { friendlyAuthError } from "@/lib/auth/firebase-errors";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Firebase password reset uses an `oobCode` from the email link. Configure
 * the Action URL in Firebase Console → Authentication → Templates to
 * `${window.location.origin}/auth/reset-password`.
 */
export function ResetForm() {
  const navigate = useNavigate();
  const [oobCode, setOobCode] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("oobCode");
    setOobCode(code);
  }, []);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
  });
  async function onSubmit(v: ResetValues) {
    if (!oobCode) {
      toast.error("Invalid or expired reset link");
      return;
    }
    try {
      await confirmPasswordReset(fbAuth(), oobCode, v.password);
      toast.success("Password updated — sign in again");
      navigate({ to: "/auth" });
    } catch (err) {
      toast.error(friendlyAuthError(err, "Could not update password"));
    }
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <WbInput label="New password" type="password" autoComplete="new-password" {...register("password")} error={errors.password?.message} />
      <WbButton type="submit" fullWidth loading={isSubmitting}>Update password</WbButton>
    </form>
  );
}