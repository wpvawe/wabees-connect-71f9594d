/**
 * TanStack server function: classify a WhatsApp inbound message via Lovable
 * AI Gateway. Owner client calls this per new inbound; the returned JSON is
 * merged into the conversation doc client-side.
 *
 * Auth: caller passes their Firebase idToken. We verify it (same helper
 * pattern as owner-repair) so the endpoint isn't a wide-open AI credit sink.
 */
import { createServerFn } from "@tanstack/react-start";

type Input = {
  idToken: string;
  text: string;
  categories: string[];
  contactName?: string | null;
};

type Output = {
  intent: string;
  sentiment: "positive" | "neutral" | "negative";
  priority: "urgent" | "high" | "normal" | "low";
  summary: string;
  tags: string[];
  confidence: number;
};

function parseInput(raw: unknown): Input {
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
  if (categories.length === 0) throw new Error("At least one category is required");
  return { idToken, text: text.slice(0, 2000), categories, contactName };
}

function readRuntimeEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

async function verifyFirebaseUser(idToken: string): Promise<string> {
  const apiKey = readRuntimeEnv("FIREBASE_WEB_API_KEY", "VITE_FIREBASE_API_KEY");
  if (!apiKey) throw new Error("Firebase web API key is not configured");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    users?: Array<{ localId?: string }>;
  };
  const uid = json.users?.[0]?.localId;
  if (!res.ok || !uid) throw new Error("Firebase session could not be verified");
  return uid;
}

function normalizePriority(v: unknown): Output["priority"] {
  if (v === "urgent" || v === "high" || v === "normal" || v === "low") return v;
  return "normal";
}

function normalizeSentiment(v: unknown): Output["sentiment"] {
  if (v === "positive" || v === "negative") return v;
  return "neutral";
}

function pickString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.slice(0, 240) : fallback;
}

export const classifyMessage = createServerFn({ method: "POST" })
  .inputValidator(parseInput)
  .handler(async ({ data }): Promise<Output> => {
    // Verify caller (cheap identitytoolkit call). Runs in parallel with
    // building the prompt so cold start latency stays low.
    const uidPromise = verifyFirebaseUser(data.idToken);

    const apiKey = readRuntimeEnv("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("Lovable AI is not configured");

    const catList = data.categories.map((c) => `- ${c}`).join("\n");
    const system = [
      "You are a WhatsApp inbox triage assistant.",
      "Classify a single inbound customer message.",
      "Return STRICT JSON matching this TypeScript type:",
      "{ intent: string; sentiment: 'positive'|'neutral'|'negative'; priority: 'urgent'|'high'|'normal'|'low'; summary: string; tags: string[]; confidence: number }",
      "Rules:",
      "- `tags` MUST be a subset of the allowed categories provided by the user; do not invent new tags.",
      "- `intent` is a short 1-4 word label (e.g. 'Refund request', 'Pricing question').",
      "- `summary` is one sentence, max 120 chars, plain text.",
      "- `priority` = 'urgent' for angry, at-risk, or time-sensitive requests; 'high' for revenue-blocking or complaints; 'low' for greetings/thanks/spam.",
      "- `confidence` is 0..1.",
      "- Detect the message language automatically. Never translate; keep summary in the same language.",
      "Reply with ONLY the JSON object, no markdown fences.",
    ].join("\n");

    const userPrompt = [
      `Allowed categories:\n${catList}`,
      data.contactName ? `Contact name: ${data.contactName}` : null,
      `Message:\n"""${data.text}"""`,
    ]
      .filter(Boolean)
      .join("\n\n");

    await uidPromise; // throws on invalid token

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        response_format: { type: "json_object" },
        temperature: 0.1,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI rate limit reached. Try again in a moment.");
      if (res.status === 402) throw new Error("Lovable AI credits exhausted. Add credits to continue auto-triage.");
      throw new Error(`AI gateway error ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Some models wrap JSON in ```json fences even with response_format set.
      const stripped = raw.replace(/```json\s*|\s*```/g, "").trim();
      try {
        parsed = JSON.parse(stripped) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }

    const allowed = new Set(data.categories.map((c) => c.toLowerCase()));
    const tagsRaw = Array.isArray(parsed.tags) ? parsed.tags : [];
    const tags = tagsRaw
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t && allowed.has(t.toLowerCase()))
      // Preserve the case of the owner's original catalog entries.
      .map((t) => data.categories.find((c) => c.toLowerCase() === t.toLowerCase()) ?? t)
      .slice(0, 4);

    const confidenceRaw = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));

    return {
      intent: pickString(parsed.intent, "Unclassified"),
      sentiment: normalizeSentiment(parsed.sentiment),
      priority: normalizePriority(parsed.priority),
      summary: pickString(parsed.summary),
      tags,
      confidence,
    };
  });