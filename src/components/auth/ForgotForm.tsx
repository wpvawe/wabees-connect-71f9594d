import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotSchema, type ForgotValues } from "@/lib/schemas/auth";
import { isBotSubmission } from "@/lib/security/honeypot";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { HoneypotField } from "@/components/wb/HoneypotField";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function ForgotForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
  });
  async function onSubmit(v: ForgotValues) {
    if (isBotSubmission(v as unknown as Record<string, unknown>)) return;
    const { error } = await supabase.auth.resetPasswordForEmail(v.email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success("Check your inbox for the reset link");
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <HoneypotField register={(name) => register(name as keyof ForgotValues)} />
      <WbInput label="Email" type="email" autoComplete="email" {...register("email")} error={errors.email?.message} />
      <WbButton type="submit" fullWidth loading={isSubmitting}>Send reset link</WbButton>
    </form>
  );
}