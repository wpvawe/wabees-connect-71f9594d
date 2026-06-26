import { createServerFn } from "@tanstack/react-start";

/**
 * Returns the PUBLIC Meta values the browser needs to initialize the
 * Facebook SDK + Embedded Signup. Secret values (APP_SECRET) stay server-side.
 */
export const getMetaPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    appId: process.env.META_APP_ID ?? "",
    configId: process.env.META_CONFIG_ID ?? "",
    graphVersion: process.env.META_GRAPH_VERSION ?? "v21.0",
    configured: Boolean(process.env.META_APP_ID && process.env.META_CONFIG_ID && process.env.META_APP_SECRET),
  };
});