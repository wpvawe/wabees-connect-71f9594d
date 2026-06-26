import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFacebook } from "@fortawesome/free-brands-svg-icons";
import { useFacebookSdk } from "./FacebookSdkLoader";
import { WbButton } from "@/components/wb/WbButton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { exchangeMetaToken } from "@/lib/meta/connect.functions";
import { toast } from "sonner";

interface Props {
  appId: string;
  configId: string;
  graphVersion: string;
  disabled?: boolean;
}

export function MetaConnectButton({ appId, configId, graphVersion, disabled }: Props) {
  const ready = useFacebookSdk(appId, graphVersion);
  const [pn, setPn] = useState<{ phone_number_id?: string; waba_id?: string }>({});
  const qc = useQueryClient();
  const exchangeFn = useServerFn(exchangeMetaToken);

  const exchange = useMutation({
    mutationFn: (input: { code: string; phone_number_id: string; waba_id: string }) =>
      exchangeFn({ data: input }),
    onSuccess: () => {
      toast.success("WhatsApp connected");
      qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (typeof ev.data !== "string") return;
      if (!/facebook\.com$/i.test(new URL(ev.origin).hostname)) return;
      try {
        const data = JSON.parse(ev.data) as { type?: string; event?: string; data?: Record<string, string> };
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH" && data.data) {
          setPn({ phone_number_id: data.data.phone_number_id, waba_id: data.data.waba_id });
        }
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function onClick() {
    if (!window.FB) return;
    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          toast.error("Facebook sign-in was cancelled");
          return;
        }
        if (!pn.phone_number_id || !pn.waba_id) {
          toast.error("Could not read phone number / WABA. Try again.");
          return;
        }
        exchange.mutate({ code, phone_number_id: pn.phone_number_id, waba_id: pn.waba_id });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <WbButton
      variant="facebook"
      size="lg"
      fullWidth
      onClick={onClick}
      disabled={disabled || !ready}
      loading={exchange.isPending}
    >
      <FontAwesomeIcon icon={faFacebook} className="h-5 w-5" />
      Connect with Facebook
    </WbButton>
  );
}