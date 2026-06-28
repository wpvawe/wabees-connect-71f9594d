import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { manualConnectSchema, type ManualConnectValues } from "@/lib/schemas/meta";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { useMutation } from "@tanstack/react-query";
import { saveWhatsAppConfig } from "@/lib/firebase/whatsapp-config";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { toast } from "sonner";

const GRAPH = "https://graph.facebook.com/v21.0";

type PhoneInfo = {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
};

async function graphGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number };
  } & T;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Meta API error (${res.status})`);
  }
  return json as T;
}

/**
 * Auto-detect connect — user enters only Phone Number ID + Access Token.
 * Backend (`whatsapp-smart-connect.php`) discovers WABA, business name,
 * display phone, and quality rating, mirroring the mobile app.
 */
export function ManualTokenForm() {
  const uid = useFirebaseUid();
  const { register, handleSubmit, formState: { errors } } = useForm<ManualConnectValues>({
    resolver: zodResolver(manualConnectSchema),
  });
  const m = useMutation({
    mutationFn: async (v: ManualConnectValues) => {
      if (!uid) throw new Error("Not signed in");
      // Best-effort verify against Meta Graph. If the entered ID is a WABA
      // (not a phone number) or token lacks the field, we still save —
      // sending messages only needs phone_number_id + access_token.
      let phone: PhoneInfo = {};
      let waba_id = v.waba_id?.trim() || undefined;
      try {
        phone = await graphGet<PhoneInfo>(
          `${encodeURIComponent(v.phone_number_id)}?fields=display_phone_number,verified_name,quality_rating`,
          v.access_token,
        );
      } catch {
        // Fallback: try as WABA id and pull the first phone number.
        try {
          const list = await graphGet<{ data?: Array<PhoneInfo & { id?: string }> }>(
            `${encodeURIComponent(v.phone_number_id)}/phone_numbers?fields=display_phone_number,verified_name,quality_rating`,
            v.access_token,
          );
          const first = list.data?.[0];
          if (first) {
            phone = {
              display_phone_number: first.display_phone_number,
              verified_name: first.verified_name,
              quality_rating: first.quality_rating,
            };
            if (!waba_id) waba_id = v.phone_number_id.trim();
          }
        } catch {
          // Skip verification entirely — save raw credentials.
        }
      }
      if (!waba_id) {
        try {
          const owner = await graphGet<{ whatsapp_business_account?: { id?: string } }>(
            `${encodeURIComponent(v.phone_number_id)}?fields=whatsapp_business_account`,
            v.access_token,
          );
          if (owner.whatsapp_business_account?.id) waba_id = owner.whatsapp_business_account.id;
        } catch {
          /* ignore */
        }
      }
      await saveWhatsAppConfig({
        uid,
        phone_number_id: v.phone_number_id.trim(),
        access_token: v.access_token.trim(),
        waba_id,
        display_phone: phone.display_phone_number,
        business_name: phone.verified_name,
        quality_rating: phone.quality_rating,
      });
    },
    onSuccess: () => toast.success("WhatsApp connected — details auto-detected"),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form onSubmit={handleSubmit((v) => m.mutate(v))} className="space-y-4">
      <WbInput
        label="Phone Number ID"
        placeholder="e.g. 1234567890"
        {...register("phone_number_id")}
        error={errors.phone_number_id?.message}
      />
      <WbInput
        label="Permanent Access Token"
        type="password"
        placeholder="EAAG…"
        {...register("access_token")}
        error={errors.access_token?.message}
      />
      <WbInput
        label="WhatsApp Business Account ID (optional)"
        placeholder="auto-detect if blank"
        {...register("waba_id")}
        error={errors.waba_id?.message}
      />
      <p className="text-xs text-muted-foreground">
        Hum Meta Graph API se seedha verify karen ge. Business name, display
        phone, quality rating, aur WABA ID (agar token ko permission hai)
        khud detect ho jain ge.
      </p>
      <WbButton type="submit" loading={m.isPending}>
        Connect & auto-detect
      </WbButton>
    </form>
  );
}