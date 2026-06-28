import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { manualConnectSchema, type ManualConnectValues } from "@/lib/schemas/meta";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { useMutation } from "@tanstack/react-query";
import { saveWhatsAppConfig } from "@/lib/firebase/whatsapp-config";
import { verifyWhatsAppToken } from "@/lib/wabees/api";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { toast } from "sonner";

export function ManualTokenForm() {
  const uid = useFirebaseUid();
  const { register, handleSubmit, formState: { errors } } = useForm<ManualConnectValues>({
    resolver: zodResolver(manualConnectSchema),
  });
  const m = useMutation({
    mutationFn: async (v: ManualConnectValues) => {
      if (!uid) throw new Error("Not signed in");
      const verify = await verifyWhatsAppToken({
        phone_number_id: v.phone_number_id,
        access_token: v.access_token,
      });
      if (!verify.success) {
        throw new Error(verify.message ?? "Token verification failed");
      }
      await saveWhatsAppConfig({ uid, ...v });
    },
    onSuccess: () => toast.success("WhatsApp connected"),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form onSubmit={handleSubmit((v) => m.mutate(v))} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <WbInput label="Phone Number ID" {...register("phone_number_id")} error={errors.phone_number_id?.message} />
        <WbInput label="WABA ID" {...register("waba_id")} error={errors.waba_id?.message} />
      </div>
      <WbInput label="Permanent Access Token" type="password" {...register("access_token")} error={errors.access_token?.message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <WbInput label="Display phone (optional)" {...register("display_phone")} />
        <WbInput label="Business name (optional)" {...register("business_name")} />
      </div>
      <WbButton type="submit" loading={m.isPending}>Save connection</WbButton>
    </form>
  );
}