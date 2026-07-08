/**
 * TanStack server function: classify a WhatsApp inbound message via Lovable
 * AI. Owner web client calls this per new inbound; the Flutter app uses the
 * companion server route at `/api/public/triage-message`. Both share the
 * classifier in `triage.server.ts` so the results are identical.
 */
import { createServerFn } from "@tanstack/react-start";
import type { TriageInput } from "./triage.server";

/**
 * Client-safe input validation. Pure data-shape checks — no env / secret
 * reads, so it's fine that this ships in client bundles.
 */
function parseTriageInput(raw: unknown): TriageInput {
  if (!raw || typeof raw !== "object") throw new Error("Invalid input");
  const r = raw as Record<string, unknown>;
  const idToken = typeof r.idToken === "string" ? r.idToken : "";
  const text = typeof r.text === "string" ? r.text : "";
  const contactName = typeof r.contactName === "string" ? r.contactName : null;
  const categoriesRaw = Array.isArray(r.categories) ? r.categories : [];
  const categories = categoriesRaw
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 25);
  if (!idToken) throw new Error("Missing idToken");
  if (!text.trim()) throw new Error("Missing text");
  if (categories.length === 0)
    throw new Error("At least one category is required");
  return { idToken, text: text.slice(0, 2000), categories, contactName };
}

export const classifyMessage = createServerFn({ method: "POST" })
  .inputValidator(parseTriageInput)
  .handler(async ({ data }) => {
    const { runTriage } = await import("./triage.server");
    return runTriage(data);
  });