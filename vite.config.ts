// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          // Split heavy vendor deps out of the main entry chunk so the
          // auth landing page doesn't need to download firestore up front.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("@firebase/firestore") || id.includes("firebase/firestore")) {
              return "firebase-firestore";
            }
            if (id.includes("@firebase/auth") || id.includes("firebase/auth")) {
              return "firebase-auth";
            }
            if (id.includes("@firebase/") || id.includes("firebase/")) {
              return "firebase-core";
            }
            if (id.includes("recharts") || id.includes("/d3-")) {
              return "recharts";
            }
            return undefined;
          },
        },
      },
    },
  },
});
