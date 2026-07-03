/**
 * Central Meta Graph API constants — TS mirror of `config/meta.php` on
 * the PHP backend. Both sides must be bumped together when Meta releases
 * a new stable Graph version.
 *
 * Override at build time with `VITE_META_GRAPH_VERSION`.
 */
export const META_GRAPH_VERSION: string =
  (import.meta.env.VITE_META_GRAPH_VERSION as string | undefined) ?? "v21.0";

export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Canonical public web app URL — used for canonical/OG tags and email links. */
export const WEB_APP_URL: string =
  (import.meta.env.VITE_WEB_APP_URL as string | undefined) ?? "https://wabees.live";

/** Re-export the PHP backend base for convenience. */
export { WABEES_API_BASE } from "@/integrations/firebase/client";