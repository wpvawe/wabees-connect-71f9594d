/**
 * Public HTTP endpoint for auto-triage — called by the Flutter app.
 *
 * POST /api/public/triage-message
 *   body: { idToken, text, categories: string[], contactName?: string }
 *
 * Auth: caller passes a Firebase idToken. `runTriage` verifies it via the
 * Identity Toolkit before doing anything else, so this is not an open AI
 * credit sink. Same classifier as the web `classifyMessage` server fn so
 * results are identical across web + app.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/triage-message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = (await request.json().catch(() => null)) as unknown;
          const { parseTriageInput, runTriage } = await import(
            "@/lib/ai/triage.server"
          );
          const input = parseTriageInput(raw);
          const result = await runTriage(input);
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Triage failed";
          const status =
            msg.includes("verified") || msg.includes("idToken") ? 401 : 400;
          return new Response(JSON.stringify({ error: msg }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});