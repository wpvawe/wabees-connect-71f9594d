import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signUpSchema, type SignUpValues } from "@/lib/schemas/auth";
import { isBotSubmission } from "@/lib/security/honeypot";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { HoneypotField } from "@/components/wb/HoneypotField";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { ensureUserDoc } from "@/lib/firebase/users";
import { friendlyAuthError } from "@/lib/auth/firebase-errors";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { postAuthDestination } from "@/lib/auth-redirect";

export function SignUpForm() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
  });

  async function onSubmit(values: SignUpValues) {
    if (isBotSubmission(values as unknown as Record<string, unknown>)) return;
    try {
      const cred = await createUserWithEmailAndPassword(
        fbAuth(),
        values.email.trim(),
        values.password,
      );
      if (values.displayName) {
        await updateProfile(cred.user, { displayName: values.displayName });
      }
      await ensureUserDoc(cred.user, { businessName: values.displayName });
      toast.success("Account created — welcome!");
      navigate(postAuthDestination());
    } catch (err) {
      toast.error(friendlyAuthError(err, "Could not create account"));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <HoneypotField register={(name) => register(name as keyof SignUpValues)} />
      <WbInput
        label="Your name"
        autoComplete="name"
        {...register("displayName")}
        error={errors.displayName?.message}
      />
      <WbInput
        label="Work email"
        type="email"
        autoComplete="email"
        {...register("email")}
        error={errors.email?.message}
      />
      <WbInput
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="8 characters or more"
        {...register("password")}
        error={errors.password?.message}
      />
      <WbButton type="submit" fullWidth loading={isSubmitting}>
        Create account
      </WbButton>
      <p className="text-center text-[11px] text-muted-foreground">
        By creating an account you agree to our Terms & Privacy policy.
      </p>
    </form>
  );
}
