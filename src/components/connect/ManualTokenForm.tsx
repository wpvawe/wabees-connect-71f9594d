import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCircleInfo,
  faLock,
  faPhone,
  faSitemap,
} from "@fortawesome/free-solid-svg-icons";
import { manualConnectSchema, type ManualConnectValues } from "@/lib/schemas/meta";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { useMutation } from "@tanstack/react-query";
import { saveWhatsAppConfig } from "@/lib/firebase/whatsapp-config";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { fbAuth } from "@/integrations/firebase/client";
import { checkExistingWhatsAppOwner } from "@/lib/firebase/owner-repair.functions";
import { smartConnectWhatsApp, verifyWhatsAppToken } from "@/lib/wabees/api";
import { toast } from "sonner";
import { useState } from "react";

type PhoneInfo = {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
};

/**
 * Auto-detect connect — user enters only Phone Number ID + Access Token.
 * Backend (`whatsapp-smart-connect.php`) discovers WABA, business name,
 * display phone, and quality rating, mirroring the mobile app.
 *
 * Before saving, we check if this phone_number_id is already owned by
 * another account. If so we BLOCK the connect (invite-only policy) and
 * tell the user to ask the existing owner for an invite link — matching
 * how Wati / Interakt handle multi-tenant WhatsApp numbers.
 */
export function ManualTokenForm() {
  const uid = useFirebaseUid();
  const [checking, setChecking] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ManualConnectValues>({
    resolver: zodResolver(manualConnectSchema),
  });

  const runConnect = async (v: ManualConnectValues) => {
    if (!uid) throw new Error("Not signed in");
    let phone: PhoneInfo = {};
    let waba_id = v.waba_id?.trim() || undefined;
    let businessName: string | undefined;
    try {
      const smart = await smartConnectWhatsApp({
        phone_number_id: v.phone_number_id,
        access_token: v.access_token,
      });
      if (smart.success && smart.data) {
        phone = smart.data.phone ?? {};
        if (!waba_id && smart.data.waba_id) waba_id = smart.data.waba_id;
        businessName = smart.data.business_name || phone.verified_name;
      } else if (smart.message) {
        toast.message(`Auto-detect skipped: ${smart.message}`);
      }
    } catch (e) {
      toast.message(
        e instanceof Error ? `Auto-detect skipped: ${e.message}` : "Auto-detect skipped",
      );
    }

    if (!phone.display_phone_number || !phone.verified_name || !phone.quality_rating) {
      try {
        const verified = await verifyWhatsAppToken({
          phone_number_id: v.phone_number_id,
          access_token: v.access_token,
        });
        if (verified.raw.error && typeof verified.raw.error === "object") {
          const msg = (verified.raw.error as { message?: string }).message;
          if (msg) toast.message(`Phone verify skipped: ${msg}`);
        } else {
          phone = {
            display_phone_number:
              (verified.raw.display_phone_number as string | undefined) ??
              phone.display_phone_number,
            verified_name:
              (verified.raw.verified_name as string | undefined) ?? phone.verified_name,
            quality_rating:
              (verified.raw.quality_rating as string | undefined) ?? phone.quality_rating,
          };
          if (!waba_id) waba_id = verified.raw.business_account_id as string | undefined;
          businessName = businessName ?? phone.verified_name;
        }
      } catch (e) {
        toast.message(
          e instanceof Error ? `Phone verify skipped: ${e.message}` : "Phone verify skipped",
        );
      }
    }

    await saveWhatsAppConfig({
      uid,
      phone_number_id: v.phone_number_id.trim(),
      access_token: v.access_token.trim(),
      waba_id,
      display_phone: phone.display_phone_number,
      business_name: businessName ?? phone.verified_name,
      quality_rating: phone.quality_rating,
    });
  };

  const m = useMutation({
    mutationFn: runConnect,
    onSuccess: () => toast.success("WhatsApp connected — details auto-detected"),
    onError: (e: Error) => toast.error(e.message),
  });

  const onSubmit = async (v: ManualConnectValues) => {
    if (!uid) {
      toast.error("Please sign in again");
      return;
    }
    setChecking(true);
    try {
      const idToken = await fbAuth().currentUser?.getIdToken();
      if (!idToken) {
        toast.error("Please sign in again");
        return;
      }
      let check: Awaited<ReturnType<typeof checkExistingWhatsAppOwner>> | null = null;
      try {
        check = await checkExistingWhatsAppOwner({
          data: { idToken, phoneNumberId: v.phone_number_id.trim() },
        });
      } catch (e) {
        // Fail-closed: if the security precheck cannot run (backend down,
        // credentials missing, network error), do NOT let the connect
        // proceed silently — otherwise a second account could grab a phone
        // number that already belongs to another workspace.
        // Log the raw reason for debugging, but never surface internal
        // infra terms (Firebase, credentials, backend) to the user.
        if (e instanceof Error) console.warn("ownership precheck failed:", e.message);
        toast.error(
          "We couldn't verify this number right now. Please try again in a moment.",
          { duration: 6000 },
        );
        return;
      }
      if (check?.existingOwnerId && !check.isSelf) {
        const who = check.existingOwnerEmail || check.existingOwnerBusinessName || "another account";
        toast.error(
          `This WhatsApp number is already connected to ${who}. Ask the workspace owner to send you an invite link to join as an agent.`,
          { duration: 8000 },
        );
        return;
      }
    } finally {
      setChecking(false);
    }
    m.mutate(v);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <WbInput
            label="Phone Number ID"
            placeholder="e.g. 1234567890"
            {...register("phone_number_id")}
            error={errors.phone_number_id?.message}
            hint="Found in Meta Business Settings → WhatsApp → API Setup."
          />
          <WbInput
            label="Permanent access token"
            type="password"
            placeholder="EAAG…"
            {...register("access_token")}
            error={errors.access_token?.message}
            hint="Your token is verified only through our secure backend proxy."
          />
        </div>
        <div className="rounded-lg border border-border bg-background p-4">
          <WbInput
            label="WABA ID (optional but recommended)"
            placeholder="Auto-detected when permitted; otherwise paste it here"
            {...register("waba_id")}
            error={errors.waba_id?.message}
            hint="A WABA ID is required for templates, quality insights, limits and account-level sync. Basic send/receive works with just the Phone Number ID and token."
          />
        </div>
        <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
          <MiniNote
            icon={faPhone}
            title="Phone verify"
            text="Display phone, verified name and quality are fetched on a best-effort basis."
          />
          <MiniNote
            icon={faSitemap}
            title="WABA dependent"
            text="Templates and business details are limited without a WABA ID."
          />
          <MiniNote
            icon={faLock}
            title="App parity"
            text="The website now uses the same PHP backend as the mobile app."
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <FontAwesomeIcon icon={faCircleInfo} className="mt-0.5 h-3.5 w-3.5 text-primary" />
            If WABA auto-detect fails, your connection is still saved. Adding a WABA ID later
            unlocks templates and insights.
          </p>
          <WbButton type="submit" loading={m.isPending || checking} className="shrink-0">
            Connect account
          </WbButton>
        </div>
    </form>
  );
}

function MiniNote({ icon, title, text }: { icon: IconDefinition; title: string; text: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-border bg-card p-3">
      <FontAwesomeIcon icon={icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
