import { z } from "zod";

export const metaExchangeSchema = z.object({
  code: z.string().min(10).max(2048),
  phone_number_id: z.string().min(3).max(64),
  waba_id: z.string().min(3).max(64),
});

export const manualConnectSchema = z.object({
  phone_number_id: z.string().trim().min(3).max(64),
  access_token: z.string().trim().min(20).max(4096),
  waba_id: z.string().trim().max(64).optional().or(z.literal("")),
});
export type ManualConnectValues = z.infer<typeof manualConnectSchema>;
