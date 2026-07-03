/**
 * Owner-only Auto-triage settings. Toggle AI classification of new inbound
 * messages, manage the AI's allowed tag catalog, and choose which fields
 * the AI is allowed to write (tags vs priority).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWandMagicSparkles, faXmark, faPlus } from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useTriageSettings } from "@/hooks/useTriageSettings";
import { saveTriageSettings } from "@/lib/firebase/triage";

export function AutoTriageSection() {
  const uid = useFirebaseUid();
  const current = useTriageSettings();
  const [enabled, setEnabled] = useState(current.enabled);
  const [autoApplyTags, setAutoApplyTags] = useState(current.autoApplyTags);
  const [autoSetPriority, setAutoSetPriority] = useState(current.autoSetPriority);
  const [categories, setCategories] = useState<string[]>(current.categories);
  const [newCat, setNewCat] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(current.enabled);
    setAutoApplyTags(current.autoApplyTags);
    setAutoSetPriority(current.autoSetPriority);
    setCategories(current.categories);
  }, [current.enabled, current.autoApplyTags, current.autoSetPriority, current.categories]);

  function addCat() {
    const val = newCat.trim();
    if (!val) return;
    if (categories.some((c) => c.toLowerCase() === val.toLowerCase())) {
      toast.error("Tag already in the list");
      return;
    }
    if (categories.length >= 25) {
      toast.error("Maximum 25 categories");
      return;
    }
    setCategories((cs) => [...cs, val]);
    setNewCat("");
  }

  function removeCat(cat: string) {
    setCategories((cs) => cs.filter((c) => c !== cat));
  }

  async function save() {
    if (!uid) return;
    if (enabled && categories.length === 0) {
      toast.error("Add at least one category before enabling auto-triage");
      return;
    }
    setSaving(true);
    try {
      await saveTriageSettings(uid, { enabled, autoApplyTags, autoSetPriority, categories });
      toast.success("Auto-triage settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WbCard>
      <WbCardHeader>
        <div className="flex items-center gap-2">
          <FontAwesomeIcon icon={faWandMagicSparkles} className="h-4 w-4 text-violet-500" />
          <div>
            <div className="text-sm font-semibold">AI Auto-triage</div>
            <div className="text-xs text-muted-foreground">
              Automatically tag, prioritize, and summarize new customer messages.
            </div>
          </div>
        </div>
      </WbCardHeader>
      <WbCardBody>
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-border/60 p-3 hover:bg-muted/30">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-violet-600"
            />
            <div>
              <div className="text-sm font-medium">Enable auto-triage</div>
              <div className="text-xs text-muted-foreground">
                Runs on every new inbound text message. Uses Lovable AI credits.
              </div>
            </div>
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
              <input
                type="checkbox"
                checked={autoApplyTags}
                onChange={(e) => setAutoApplyTags(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-violet-600"
              />
              <div>
                <div className="text-sm font-medium">Apply tags automatically</div>
                <div className="text-xs text-muted-foreground">
                  When off, AI still shows suggestions but doesn't write tags.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
              <input
                type="checkbox"
                checked={autoSetPriority}
                onChange={(e) => setAutoSetPriority(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-violet-600"
              />
              <div>
                <div className="text-sm font-medium">Set priority automatically</div>
                <div className="text-xs text-muted-foreground">
                  Never downgrades a manually-set high/urgent priority.
                </div>
              </div>
            </label>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Allowed tag catalog</div>
            <div className="mb-2 text-xs text-muted-foreground">
              The AI can only pick tags from this list. Empty the list to disable tagging.
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {categories.length === 0 && (
                <span className="text-xs text-muted-foreground">No categories yet.</span>
              )}
              {categories.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => removeCat(c)}
                    className="text-violet-500 hover:text-red-500"
                    aria-label={`Remove ${c}`}
                  >
                    <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <WbInput
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCat();
                  }
                }}
                placeholder="e.g. Refunds"
              />
              <WbButton type="button" variant="secondary" onClick={addCat}>
                <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
                Add
              </WbButton>
            </div>
          </div>

          <div className="flex justify-end">
            <WbButton onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </WbButton>
          </div>
        </div>
      </WbCardBody>
    </WbCard>
  );
}