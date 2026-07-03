import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faCode,
  faCopy,
  faEye,
  faEyeSlash,
  faKey,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { fbDb } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

/**
 * Batch 20 · A8 — Developer API key section (settings).
 * Generates and stores a `wbk_<32-hex>` key at `users/{uid}.apiKey`.
 * Mirrors the Flutter settings screen so external integrations can reuse the
 * same key across web + mobile.
 */
export function DeveloperApiSection() {
  const uid = useFirebaseUid();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(fbDb(), "users", uid), (snap) => {
      const d = snap.data() as Record<string, unknown> | undefined;
      setApiKey(typeof d?.apiKey === "string" ? (d.apiKey as string) : null);
      const ts = d?.apiKeyCreatedAt as { toDate?: () => Date } | undefined;
      if (ts && typeof ts.toDate === "function") {
        setCreatedAt(ts.toDate().toLocaleString());
      } else {
        setCreatedAt(null);
      }
    });
    return () => unsub();
  }, [uid]);

  async function generate() {
    if (!uid) return;
    setSaving(true);
    try {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const key = `wbk_${hex}`;
      await updateDoc(doc(fbDb(), "users", uid), {
        apiKey: key,
        apiKeyCreatedAt: serverTimestamp(),
      });
      setReveal(true);
      toast.success(apiKey ? "API key rotated" : "API key generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      toast.success("API key copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  const masked = apiKey ? `${apiKey.slice(0, 8)}${"•".repeat(20)}${apiKey.slice(-4)}` : null;

  return (
    <WbCard>
      <WbCardHeader
        title="Developer API"
        subtitle="Send WhatsApp messages programmatically using your own key"
      />
      <WbCardBody className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <FontAwesomeIcon icon={faKey} className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">API key</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Include it as the <code className="rounded bg-muted px-1 py-0.5">x-api-key</code>{" "}
              header when calling the Wabees REST API.
              {createdAt && <span className="ml-1">Created {createdAt}.</span>}
            </p>

            {apiKey ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="max-w-full flex-1 truncate rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground">
                  {reveal ? apiKey : masked}
                </code>
                <WbButton size="sm" variant="secondary" onClick={() => setReveal((v) => !v)}>
                  <FontAwesomeIcon icon={reveal ? faEyeSlash : faEye} className="h-3 w-3" />
                  {reveal ? "Hide" : "Reveal"}
                </WbButton>
                <WbButton size="sm" variant="secondary" onClick={copy}>
                  <FontAwesomeIcon icon={faCopy} className="h-3 w-3" /> Copy
                </WbButton>
                <WbButton
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (confirm("Rotate API key? The old key will stop working immediately."))
                      generate();
                  }}
                  loading={saving}
                >
                  <FontAwesomeIcon icon={faArrowsRotate} className="h-3 w-3" /> Rotate
                </WbButton>
              </div>
            ) : (
              <div className="mt-3">
                <WbButton size="sm" onClick={generate} loading={saving}>
                  <FontAwesomeIcon icon={faKey} className="h-3 w-3" /> Generate API key
                </WbButton>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-border bg-background/60 p-3 text-xs">
          <p className="mb-2 flex items-center gap-2 font-semibold text-foreground">
            <FontAwesomeIcon icon={faCode} className="h-3 w-3 text-primary" /> Example
          </p>
          <pre className="overflow-x-auto whitespace-pre text-[11px] leading-relaxed text-muted-foreground">
{`curl -X POST https://api.wabees.live/public-send.php \\
  -H "x-api-key: ${apiKey ?? "wbk_your_key_here"}" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"923001234567","type":"text","message":"Hello from API"}'`}
          </pre>
        </div>
      </WbCardBody>
    </WbCard>
  );
}