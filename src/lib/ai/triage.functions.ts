/**
 * TanStack server function: classify a WhatsApp inbound message via Lovable
 * AI. Owner web client calls this per new inbound; the Flutter app uses the
 * companion server route at `/api/public/triage-message`. Both share the
 * classifier in `triage.server.ts` so the results are identical.
 */
import { createServerFn } from "@tanstack/react-start";

export const classifyMessage = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => {
    // Import inside the validator to keep server-only code out of the
    // client bundle (only handler bodies are stripped by default).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./triage.server") as typeof import("./triage.server");
    return mod.parseTriageInput(raw);
  })
  .handler(async ({ data }) => {
    const { runTriage } = await import("./triage.server");
    return runTriage(data);
  });