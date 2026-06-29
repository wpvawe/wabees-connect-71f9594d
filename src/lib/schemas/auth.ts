import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
  company_url: z.string().optional(), // honeypot
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = signInSchema.extend({
  displayName: z.string().trim().min(2).max(60),
});
export type SignUpValues = z.infer<typeof signUpSchema>;

export const forgotSchema = z.object({
  email: z.string().trim().email().max(255),
  company_url: z.string().optional(),
});
export type ForgotValues = z.infer<typeof forgotSchema>;

export const resetSchema = z.object({
  password: z.string().min(8).max(128),
});
export type ResetValues = z.infer<typeof resetSchema>;
