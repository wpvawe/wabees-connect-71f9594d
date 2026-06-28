import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { manualConnectSchema, type ManualConnectValues } from "@/lib/schemas/meta";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { useMutation } from "@tanstack/react-query";
import { saveWhatsAppConfig } from "@/lib/firebase/whatsapp-config";
import { smartConnectWhatsApp } from "@/lib/wabees/api";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { toast } from "sonner";

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
      const res = await smartConnectWhatsApp(v);
      if (!res.success) {
        throw new Error(res.message ?? "Could not verify this token");
      }
      const d = res.data ?? {};
      await saveWhatsAppConfig({
        uid,
        phone_number_id: v.phone_number_id,
        access_token: v.access_token,
        waba_id: d.waba_id ?? undefined,
        display_phone: d.phone?.display_phone_number ?? undefined,
        business_name: d.business_name ?? d.phone?.verified_name ?? undefined,
        quality_rating: d.phone?.quality_rating ?? undefined,
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
      <p className="text-xs text-muted-foreground">
        WABA ID, business name, display phone, aur quality rating automatically
        detect ho jain ge.
      </p>
      <WbButton type="submit" loading={m.isPending}>
        Connect & auto-detect
      </WbButton>
    </form>
  );
}