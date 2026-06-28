import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faBolt } from "@fortawesome/free-solid-svg-icons";
import { faFacebook } from "@fortawesome/free-brands-svg-icons";
import { toast } from "sonner";
import { WbButton } from "@/components/wb/WbButton";
import { saveWhatsAppConfig } from "@/lib/firebase/whatsapp-config";
import { exchangeWhatsAppCode } from "@/lib/wabees/api";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

/**
 * Meta Embedded Signup — fully-auto WhatsApp Business onboarding.
 *  1. Load Facebook JS SDK (once) with our App ID.
 *  2. `FB.login` with our Embedded Signup `config_id` and
 *     `response_type: 'code'` so Meta returns a short-lived code (not a
 *     short-lived token) — the only flow that can be exchanged for a
 *     long-lived business token.
 *  3. POST the code to `whatsapp-exchange-code.php` (App Secret stays
 *     server-side) which returns the access_token + auto-discovered
 *     phone_number_id / waba_id / display_phone / business_name /
 *     quality_rating.
 *  4. Persist via `saveWhatsAppConfig` (mirrors `users/{uid}` + the
 *     `whatsapp_config/config` subcollection the Flutter app reads).
 */
const FB_APP_ID = "2156417868496811";
const FB_CONFIG_ID = "1546702853679300";
const FB_GRAPH_VERSION = "v21.0";

type FBLoginResponse = {
  authResponse?: { code?: string; accessToken?: string } | null;
  status?: string;
};
type FBStatic = {
  init: (opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
  login: (
    cb: (r: FBLoginResponse) => void,
    opts: {
      config_id: string;
      response_type: "code";
      override_default_response_type: boolean;
      extras?: Record<string, unknown>;
    },
  ) => void;
};
declare global {
  interface Window {
    FB?: FBStatic;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FBStatic> | null = null;
function loadFbSdk(): Promise<FBStatic> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.FB) return Promise.resolve(window.FB);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FBStatic>((resolve, reject) => {
    window.fbAsyncInit = () => {
      try {
        window.FB!.init({ appId: FB_APP_ID, cookie: true, xfbml: false, version: FB_GRAPH_VERSION });
        resolve(window.FB!);
      } catch (e) {
        reject(e);
      }
    };
    const s = document.createElement("script");
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.onerror = () => reject(new Error("Failed to load Facebook SDK"));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export function EmbeddedSignupButton() {
  const uid = useFirebaseUid();
  const [busy, setBusy] = useState(false);
  // Capture the WA_EMBEDDED_SIGNUP postMessage (carries phone_number_id +
  // waba_id even before our server-side discovery runs). Useful for logging
  // / fallback, not required for success.
  const sessionInfoRef = useRef<{ phone_number_id?: string; waba_id?: string } | null>(null);
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (typeof ev.data !== "string") return;
      try {
        const d = JSON.parse(ev.data);
        if (d?.type === "WA_EMBEDDED_SIGNUP" && d?.event === "FINISH") {
          sessionInfoRef.current = {
            phone_number_id: d?.data?.phone_number_id,
            waba_id: d?.data?.waba_id,
          };
        }
      } catch {
        /* not our message */
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  async function start() {
    if (!uid) { toast.error("Sign in first"); return; }
    setBusy(true);
    try {
      const FB = await loadFbSdk();
      const resp: FBLoginResponse = await new Promise((res) =>
        FB.login(res, {
          config_id: FB_CONFIG_ID,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
        }),
      );
      const code = resp?.authResponse?.code;
      if (!code) {
        toast.error("Sign-up cancelled");
        return;
      }
      const ex = await exchangeWhatsAppCode({ code });
      if (!ex.success || !ex.data) {
        throw new Error(ex.message ?? "Token exchange failed");
      }
      const d = ex.data;
      await saveWhatsAppConfig({
        uid,
        phone_number_id: d.phone_number_id,
        access_token: d.access_token,
        waba_id: d.waba_id,
        display_phone: d.display_phone ?? undefined,
        business_name: d.business_name ?? undefined,
        quality_rating: d.quality_rating ?? undefined,
      });
      toast.success("WhatsApp connected via Embedded Signup");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <WbButton onClick={start} loading={busy} className="w-full">
        <FontAwesomeIcon icon={busy ? faCircleNotch : faFacebook} className={busy ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
        Continue with Facebook
      </WbButton>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <FontAwesomeIcon icon={faBolt} className="mt-0.5 h-3 w-3 text-primary" />
        One popup — select your business, pick a phone number, done. No tokens
        to copy, no IDs to find. Same auto-flow as the mobile app.
      </p>
    </div>
  );
}