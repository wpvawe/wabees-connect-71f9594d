/**
 * Owner-managed library of canned responses (quick replies). Agents can
 * trigger them from the composer with `/shortcut`. This section only
 * renders for the owner — gated by the parent via `Gated`.
 */
import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBolt,
  faPen,
  faPlus,
  faTrash,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useCannedResponses } from "@/hooks/useCannedResponses";
import {
  createCanned,
  deleteCanned,
  updateCanned,
  type CannedResponse,
} from "@/lib/firebase/canned";

type Draft = { id: string | null; shortcut: string; title: string; body: string };

const EMPTY: Draft = { id: null, shortcut: "", title: "", body: "" };

export function CannedResponsesSection() {
  const uid = useFirebaseUid();
  const { data } = useCannedResponses();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (c) =>
        c.shortcut.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q),
    );
  }, [data, query]);

  async function save() {
    if (!uid || !draft) return;
    const body = draft.body.trim();
    const title = draft.title.trim();
    const shortcut = draft.shortcut.trim();
    if (!body || !title || !shortcut) {
      toast.error("Shortcut, title and body are required");
      return;
    }
    setSaving(true);
    try {
      if (draft.id) {
        await updateCanned(uid, draft.id, { shortcut, title, body });
      } else {
        await createCanned(uid, { shortcut, title, body });
      }
      toast.success("Saved quick reply");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: CannedResponse) {
    if (!uid) return;
    if (!confirm(`Delete quick reply /${c.shortcut}?`)) return;
    try {
      await deleteCanned(uid, c.id);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Quick replies"
        subtitle="Save reusable messages your team can trigger with /shortcut in chat"
        right={
          <WbButton size="sm" onClick={() => setDraft({ ...EMPTY })}>
            <FontAwesomeIcon icon={faPlus} className="mr-1.5 h-3 w-3" />
            New
          </WbButton>
        }
      />
      <WbCardBody className="space-y-4">
        {(data?.length ?? 0) > 0 && (
          <WbInput
            placeholder="Search shortcut, title, body…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}

        {data === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-6 text-center">
            <FontAwesomeIcon
              icon={faBolt}
              className="mb-2 h-5 w-5 text-muted-foreground"
            />
            <p className="text-sm font-medium text-foreground">
              {query ? "No matches" : "No quick replies yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create one to speed up common replies like greetings, pricing or
              order status. Use <span className="font-mono">{"{{name}}"}</span>{" "}
              and <span className="font-mono">{"{{phone}}"}</span> to
              personalise.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {filtered.map((c) => (
              <li key={c.id} className="flex items-start gap-3 p-3">
                <span className="mt-0.5 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-mono font-semibold text-primary">
                  /{c.shortcut}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {c.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {c.body}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Edit"
                    onClick={() =>
                      setDraft({
                        id: c.id,
                        shortcut: c.shortcut,
                        title: c.title,
                        body: c.body,
                      })
                    }
                    className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <FontAwesomeIcon icon={faPen} className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    onClick={() => void remove(c)}
                    className="grid h-8 w-8 place-items-center rounded-md text-destructive hover:bg-destructive/10"
                  >
                    <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {draft && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">
                {draft.id ? "Edit quick reply" : "New quick reply"}
              </p>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <WbInput
                label="Shortcut"
                placeholder="hi"
                value={draft.shortcut}
                onChange={(e) =>
                  setDraft({ ...draft, shortcut: e.target.value })
                }
                hint="Trigger with /shortcut. Letters, digits, dashes only."
              />
              <WbInput
                label="Title"
                placeholder="Greeting"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Body
              </label>
              <textarea
                rows={4}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="Hi {{name}}, thanks for reaching out! How can we help?"
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Placeholders: <span className="font-mono">{"{{name}}"}</span>,{" "}
                <span className="font-mono">{"{{phone}}"}</span>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <WbButton variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </WbButton>
              <WbButton onClick={save} loading={saving}>
                Save quick reply
              </WbButton>
            </div>
          </div>
        )}
      </WbCardBody>
    </WbCard>
  );
}