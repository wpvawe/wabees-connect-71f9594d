/**
 * Owner-only CSAT settings: enable auto-send on resolve, tweak the survey
 * question / footer / follow-up comment prompt, and preview recent ratings.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faSmile, faFrown } from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useCsatSettings } from "@/hooks/useCsatSettings";
import { useCsatSurveys } from "@/hooks/useCsatSurveys";
import {
  DEFAULT_CSAT,
  saveCsatSettings,
  type CsatSettings,
} from "@/lib/firebase/csat";

export function CsatSettingsSection() {
  const uid = useFirebaseUid();
  const current = useCsatSettings();
  const { stats, data } = useCsatSurveys(50);
  const [draft, setDraft] = useState<CsatSettings>(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(current);
  }, [current]);

  async function onSave() {
    if (!uid) return;
    setSaving(true);
    try {
      await saveCsatSettings(uid, draft);
      toast.success("CSAT settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const recent = (data ?? []).filter((s) => s.rating).slice(0, 6);

  return (
    <WbCard>
      <WbCardHeader
        title="Customer satisfaction (CSAT)"
        subtitle="After a conversation is marked resolved, send an interactive 1–5 star survey and capture ratings automatically."
      />
      <WbCardBody className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Response rate"
            value={
              stats.sent > 0
                ? `${Math.round(stats.responseRate * 100)}%`
                : "—"
            }
            hint={`${stats.responded} / ${stats.sent} sent`}
          />
          <Metric
            label="Avg rating"
            value={
              stats.averageRating != null
                ? stats.averageRating.toFixed(2)
                : "—"
            }
            hint="1 (poor) — 5 (excellent)"
            icon={faStar}
            accent="text-amber-500"
          />
          <Metric
            label="CSAT score"
            value={stats.csatPct != null ? `${Math.round(stats.csatPct)}%` : "—"}
            hint="% rating 4★ or higher"
            icon={stats.csatPct != null && stats.csatPct >= 70 ? faSmile : faFrown}
            accent={
              stats.csatPct != null && stats.csatPct >= 70
                ? "text-emerald-500"
                : "text-red-500"
            }
          />
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            <span>
              <div className="text-sm font-medium">Enable CSAT surveys</div>
              <div className="text-xs text-muted-foreground">
                Turn the feature on to start sending surveys.
              </div>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={draft.autoOnResolve}
              disabled={!draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, autoOnResolve: e.target.checked })
              }
            />
            <span>
              <div className="text-sm font-medium">
                Auto-send when a conversation is marked resolved
              </div>
              <div className="text-xs text-muted-foreground">
                Agents can also trigger a manual send from the inbox menu.
              </div>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={draft.askComment}
              disabled={!draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, askComment: e.target.checked })
              }
            />
            <span>
              <div className="text-sm font-medium">Follow up for a written comment</div>
              <div className="text-xs text-muted-foreground">
                After the customer rates, send a short prompt inviting extra feedback.
              </div>
            </span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <WbInput
            label="Survey question"
            value={draft.question}
            onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            hint="Sent as the body of the interactive message."
          />
          <WbInput
            label="Footer text"
            value={draft.footer}
            onChange={(e) => setDraft({ ...draft, footer: e.target.value })}
            hint="Small text under the survey."
          />
          <div className="md:col-span-2">
            <WbInput
              label="Comment prompt"
              value={draft.commentPrompt}
              onChange={(e) =>
                setDraft({ ...draft, commentPrompt: e.target.value })
              }
              hint="Sent right after a rating when follow-up is enabled."
            />
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Live preview
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-3 text-sm">
            <div className="whitespace-pre-wrap text-foreground">
              {draft.question || DEFAULT_CSAT.question}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {draft.footer || DEFAULT_CSAT.footer}
            </div>
            <button
              type="button"
              disabled
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm"
            >
              Rate 1–5 ▾
            </button>
          </div>
        </div>

        {recent.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent ratings
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-[52px] text-amber-500">
                    {"★".repeat(r.rating ?? 0)}
                    <span className="text-muted-foreground">
                      {"★".repeat(Math.max(0, 5 - (r.rating ?? 0)))}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.phone}</span>
                    {r.comment && (
                      <span className="block text-xs text-muted-foreground">
                        “{r.comment}”
                      </span>
                    )}
                  </span>
                  {r.agentEmail && (
                    <span className="hidden max-w-[160px] truncate text-xs text-muted-foreground sm:inline">
                      {r.agentEmail}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end">
          <WbButton onClick={onSave} loading={saving}>
            Save CSAT settings
          </WbButton>
        </div>
      </WbCardBody>
    </WbCard>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: typeof faStar;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        {icon && (
          <FontAwesomeIcon icon={icon} className={`h-4 w-4 ${accent ?? ""}`} />
        )}
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
      </div>
      {hint && (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}