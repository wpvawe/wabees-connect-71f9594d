import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema, type SignInValues } from "@/lib/schemas/auth";
import { isBotSubmission } from "@/lib/security/honeypot";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { HoneypotField } from "@/components/wb/HoneypotField";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { unifiedSignIn } from "@/lib/auth/unified-signin.functions";

export function SignInForm() {
  const navigate = useNavigate();
  const signInFn = useServerFn(unifiedSignIn);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
  });

  async function onSubmit(values: SignInValues) {
    if (isBotSubmission(values as unknown as Record<string, unknown>)) {
      return;
    }
    try {
      const result = await signInFn({ data: { email: values.email, password: values.password } });
      if (result.mode === "linked") {
        const { error: setErr } = await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        if (setErr) throw setErr;
      } else {
        // Browser still needs a session for the existing-Supabase-user path.
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        });
        if (error) throw error;
      }
      toast.success("Welcome back");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid email or password");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <HoneypotField register={(name) => register(name as keyof SignInValues)} />
      <WbInput label="Email" type="email" autoComplete="email" {...register("email")} error={errors.email?.message} />
      <WbInput label="Password" type="password" autoComplete="current-password" {...register("password")} error={errors.password?.message} />
      <div className="flex items-center justify-end">
        <Link to="/auth/forgot" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link>
      </div>
      <WbButton type="submit" fullWidth loading={isSubmitting}>Sign in</WbButton>
    </form>
  );
}