import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signUpSchema, type SignUpValues } from "@/lib/schemas/auth";
import { isBotSubmission } from "@/lib/security/honeypot";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { HoneypotField } from "@/components/wb/HoneypotField";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { unifiedSignUp } from "@/lib/auth/unified-signup.functions";

export function SignUpForm() {
  const navigate = useNavigate();
  const signUpFn = useServerFn(unifiedSignUp);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
  });

  async function onSubmit(values: SignUpValues) {
    if (isBotSubmission(values as unknown as Record<string, unknown>)) return;
    try {
      await signUpFn({
        data: { email: values.email, password: values.password, display_name: values.displayName },
      });
      // Auto sign-in so user lands straight in the app.
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) throw error;
      toast.success("Account created — welcome!");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create account");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <HoneypotField register={(name) => register(name as keyof SignUpValues)} />
      <WbInput label="Your name" autoComplete="name" {...register("displayName")} error={errors.displayName?.message} />
      <WbInput label="Work email" type="email" autoComplete="email" {...register("email")} error={errors.email?.message} />
      <WbInput label="Password" type="password" autoComplete="new-password" hint="8 characters or more" {...register("password")} error={errors.password?.message} />
      <WbButton type="submit" fullWidth loading={isSubmitting}>Create account</WbButton>
      <p className="text-center text-[11px] text-muted-foreground">By creating an account you agree to our Terms & Privacy policy.</p>
    </form>
  );
}