import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetSchema, type ResetValues } from "@/lib/schemas/auth";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

export function ResetForm() {
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
  });
  async function onSubmit(v: ResetValues) {
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/dashboard" });
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <WbInput label="New password" type="password" autoComplete="new-password" {...register("password")} error={errors.password?.message} />
      <WbButton type="submit" fullWidth loading={isSubmitting}>Update password</WbButton>
    </form>
  );
}