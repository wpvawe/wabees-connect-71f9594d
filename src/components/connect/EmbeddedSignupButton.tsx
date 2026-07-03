import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faBolt } from "@fortawesome/free-solid-svg-icons";
import { faFacebook } from "@fortawesome/free-brands-svg-icons";
import { toast } from "sonner";
import { WbButton } from "@/components/wb/WbButton";
import { saveWhatsAppConfig } from "@/lib/firebase/whatsapp-config";
import {
  exchangeWhatsAppCode,
  listWhatsAppAccounts,
  type BusinessOption,
} from "@/lib/wabees/api";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { AccountPickerDialog, type PickedAccount } from "./AccountPickerDialog";

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
      scope: string;
      response_type: "code";
      override_default_response_type: boolean;
      extras?: Record<string, unknown>;
    },
  ) => void;
};
type EmbeddedSignupSessionInfo = {
  event?: "FINISH" | "ERROR" | "CANCEL";
  phone_number_id?: string;
  waba_id?: string;
  error_message?: string;
  current_step?: string;
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
        window.FB!.init({
          appId: FB_APP_ID,
          cookie: true,
          xfbml: false,
          version: FB_GRAPH_VERSION,
        });
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerBusinesses, setPickerBusinesses] = useState<BusinessOption[]>([]);
  const pendingTokenRef = useRef<string | null>(null);
  // Capture the WA_EMBEDDED_SIGNUP postMessage (carries phone_number_id +
  // waba_id even before our server-side discovery runs). Useful for logging
  // / fallback, not required for success.
  const sessionInfoRef = useRef<EmbeddedSignupSessionInfo | null>(null);
  const getSessionInfo = () => sessionInfoRef.current as EmbeddedSignupSessionInfo | null;
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (!String(ev.origin).endsWith("facebook.com")) return;
      if (typeof ev.data !== "string") return;
      try {
        const d = JSON.parse(ev.data);
        if (d?.type === "WA_EMBEDDED_SIGNUP") {
          if (d?.event === "FINISH") {
            sessionInfoRef.current = {
              event: "FINISH",
              phone_number_id: d?.data?.phone_number_id,
              waba_id: d?.data?.waba_id,
            };
          } else if (d?.event === "ERROR") {
            sessionInfoRef.current = {
              event: "ERROR",
              error_message: d?.data?.error_message ?? d?.data?.error,
            };
          } else if (d?.event === "CANCEL") {
            sessionInfoRef.current = {
              event: "CANCEL",
              current_step: d?.data?.current_step ?? d?.data?.current,
            };
          }
        }
      } catch {
        /* not our message */
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  async function start() {
    if (!uid) {
      toast.error("Sign in first");
      return;
    }
    setBusy(true);
    sessionInfoRef.current = null;
    try {
      const FB = await loadFbSdk();
      const resp: FBLoginResponse = await new Promise((res) =>
        FB.login(res, {
          config_id: FB_CONFIG_ID,
          scope:
            "public_profile,business_management,whatsapp_business_management,whatsapp_business_messaging",
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            feature: "whatsapp_embedded_signup",
            featureType: "",
            sessionInfoVersion: "3",
          },
        }),
      );
      const code = resp?.authResponse?.code;
      if (!code) {
        const sessionInfo = getSessionInfo();
        if (sessionInfo?.event === "ERROR" && sessionInfo.error_message) {
          toast.error(sessionInfo.error_message);
        } else if (resp?.status === "not_authorized" || resp?.status === "unknown") {
          toast.error(
            "Facebook Login blocked by Meta. If the popup shows Feature Unavailable, the Meta app still needs public_profile Advanced Access / Live access.",
          );
        } else {
          toast.error("Sign-up cancelled before Meta returned a code");
        }
        return;
      }
      const ex = await exchangeWhatsAppCode({ code });
      if (!ex.success || !ex.data) {
        throw new Error(ex.message ?? "Token exchange failed");
      }
      const d = ex.data;

      // Discover every business/WABA/phone the token can see. If there is
      // more than one phone total, open the multi-step picker so the user
      // chooses which number to link.
      let totalPhones = 0;
      let businesses: BusinessOption[] = [];
      try {
        const list = await listWhatsAppAccounts({ access_token: d.access_token });
        if (list.success && list.data?.businesses) {
          businesses = list.data.businesses;
          for (const b of businesses)
            for (const w of b.wabas) totalPhones += w.phones.length;
        }
      } catch {
        /* fall through to single-phone save */
      }

      if (totalPhones > 1) {
        pendingTokenRef.current = d.access_token;
        setPickerBusinesses(businesses);
        setPickerOpen(true);
        return; // save happens after the user picks
      }

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

  async function handlePick(a: PickedAccount) {
    if (!uid) return;
    const token = pendingTokenRef.current;
    if (!token) {
      toast.error("Session expired, please retry");
      setPickerOpen(false);
      return;
    }
    setPickerBusy(true);
    try {
      await saveWhatsAppConfig({
        uid,
        phone_number_id: a.phone.id,
        access_token: token,
        waba_id: a.waba.id,
        display_phone: a.phone.display_phone_number || undefined,
        business_name: a.phone.verified_name || a.business.name || undefined,
        quality_rating: a.phone.quality_rating || undefined,
      });
      toast.success(`Connected ${a.phone.display_phone_number || a.phone.id}`);
      setPickerOpen(false);
      pendingTokenRef.current = null;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save selected number");
    } finally {
      setPickerBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <WbButton onClick={start} loading={busy} className="w-full">
        <FontAwesomeIcon
          icon={busy ? faCircleNotch : faFacebook}
          className={busy ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"}
        />
        Continue with Facebook
      </WbButton>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <FontAwesomeIcon icon={faBolt} className="mt-0.5 h-3 w-3 text-primary" />
        One popup — select your business, pick a phone number, done. No tokens to copy, no IDs to
        find. Same auto-flow as the mobile app.
      </p>
      <AccountPickerDialog
        open={pickerOpen}
        onOpenChange={(v) => {
          setPickerOpen(v);
          if (!v) pendingTokenRef.current = null;
        }}
        businesses={pickerBusinesses}
        onPick={handlePick}
        busy={pickerBusy}
      />
    </div>
  );
}
