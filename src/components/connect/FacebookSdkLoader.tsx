import { useEffect, useState } from "react";

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; version: string; xfbml?: boolean; cookie?: boolean }) => void;
      login: (
        cb: (response: { authResponse?: { code?: string }; status?: string }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

/** Loads the Facebook JS SDK exactly once. */
export function useFacebookSdk(appId: string | undefined, graphVersion: string) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!appId) return;
    if (window.FB) {
      setReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: graphVersion, xfbml: false, cookie: false });
      setReady(true);
    };
    const id = "facebook-jssdk";
    if (document.getElementById(id)) return;
    const s = document.createElement("script");
    s.id = id;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    document.body.appendChild(s);
  }, [appId, graphVersion]);
  return ready;
}