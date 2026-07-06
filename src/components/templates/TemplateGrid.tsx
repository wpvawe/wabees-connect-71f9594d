import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faFileLines,
  faMagnifyingGlass,
  faRotate,
  faCircleCheck,
  faClock,
  faCircleXmark,
  faTrash,
  faPaperPlane,
  faPlus,
  faXmark,
  faPencil,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { useTemplates, type Template } from "@/hooks/useTemplates";
import { syncTemplatesFromMeta } from "@/lib/firebase/templates";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { deleteDoc, doc } from "firebase/firestore";
import { addDoc, collection, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { deleteMetaTemplate, extractWamid, sendTemplateMessage } from "@/lib/wabees/api";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { normalizePhone, phoneDocId, whatsappRecipientId } from "@/lib/firebase/normalizers";
import { WbInput } from "@/components/wb/WbInput";
import { WhatsAppPreview } from "@/components/shared/WhatsAppPreview";
import { cn } from "@/lib/utils";
import { useCan } from "@/lib/auth/permissions";

export function TemplateGrid() {
  const { data, error } = useTemplates();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const can = useCan();
  const canWrite = can("templates.write");
  const canDelete = can("templates.delete");
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  async function onSync() {
    if (!uid || !selfUid) return;
    setSyncing(true);
    try {
      const r = await syncTemplatesFromMeta(uid, selfUid);
      toast.success(
        `Synced ${r.synced} templates${r.deleted ? ` — ${r.deleted} removed` : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return data;
    if (!q.trim()) return data;
    const n = q.toLowerCase();
    return data.filter((t) => t.name.toLowerCase().includes(n) || t.body.toLowerCase().includes(n));
  }, [data, q]);

  // Auto-select first template when list loads / filter changes.
  useEffect(() => {
    if (!filtered || filtered.length === 0) return;
    if (!selectedId || !filtered.some((t) => t.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = useMemo(
    () => (data ?? []).find((t) => t.id === selectedId) ?? null,
    [data, selectedId],
  );

  // Reset the send composer when template changes.
  useEffect(() => {
    setVars({});
    setPhone("");
    setShowSend(false);
  }, [selectedId]);

  // Live-render body/header using the variable inputs so the preview updates
  // as the user types (mirroring WhatsApp Meta's realtime behavior).
  const previewBody = useMemo(() => {
    if (!selected) return "";
    return selected.body.replace(/\{\{\s*([\w\d]+)\s*\}\}/g, (_, k) =>
      vars[k] && vars[k].trim() ? vars[k] : `{{${k}}}`,
    );
  }, [selected, vars]);
  const previewHeader = useMemo(() => {
    if (!selected?.header) return null;
    return selected.header.replace(/\{\{\s*([\w\d]+)\s*\}\}/g, (_, k) =>
      vars[k] && vars[k].trim() ? vars[k] : `{{${k}}}`,
    );
  }, [selected, vars]);

  async function removeTemplate(t: Template) {
    if (!uid || !selfUid) return;
    if (
      !confirm(
        `Delete template "${t.name}" from Meta AND this workspace? This cannot be undone.`,
      )
    )
      return;
    try {
      // 1) Meta delete — mirrors the Flutter app so the template also goes
      //    away in Business Manager. If WABA ID or creds are missing (e.g.
      //    the account was disconnected), fall back to a local-only cleanup
      //    so ghost rows can still be removed from this workspace.
      let metaMessage = "Template deleted";
      try {
        const creds = await loadWaConnection(selfUid);
        const cfg = await getDoc(doc(fbDb(), "users", selfUid, "whatsapp_config", "config"));
        const userDoc = await getDoc(doc(fbDb(), "users", selfUid));
        const wabaId =
          (cfg.data()?.businessAccountId as string | undefined) ||
          (userDoc.data()?.whatsappBusinessAccountId as string | undefined) ||
          "";
        if (!creds || !wabaId) {
          metaMessage = "Removed locally (WhatsApp not connected — Meta copy untouched)";
        } else {
          const metaRes = await deleteMetaTemplate({
            business_account_id: wabaId,
            access_token: "",
            name: t.name,
            hsm_id: t.metaTemplateId ?? null,
          });
          const errMsg =
            (metaRes.raw?.error && typeof metaRes.raw.error === "object"
              ? (metaRes.raw.error as { message?: string }).message
              : undefined) || metaRes.message;
          const notFoundOk =
            typeof errMsg === "string" && /not found|does not exist|no such/i.test(errMsg);
          if (!metaRes.success && !notFoundOk) {
            throw new Error(errMsg || "Meta delete failed");
          }
          metaMessage = notFoundOk ? "Removed (was already gone on Meta)" : "Template deleted from Meta";
        }
      } catch (metaErr) {
        // Re-throw only if it's a real Meta failure; missing config already handled above.
        throw metaErr;
      }
      // 2) Firestore delete — always attempted so the workspace stays clean.
      await deleteDoc(doc(fbDb(), "users", uid, "templates", t.id));
      toast.success(metaMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function sendTest() {
    if (!selected || !selfUid) return;
    if (!phone.trim()) {
      toast.error("Enter a recipient phone number");
      return;
    }
    setSending(true);
    let quotaReserved = false;
    try {
      const creds = await loadWaConnection(selfUid);
      if (!creds) throw new Error("Connect WhatsApp first");
      if (uid) {
        const { reserveQuota } = await import("@/lib/plans/limits");
        await reserveQuota(uid, "messages", 1);
        quotaReserved = true;
      }
      const components: Array<Record<string, unknown>> =
        selected.variables.length > 0
          ? [
              {
                type: "body",
                parameters: selected.variables.map((v) => ({
                  type: "text",
                  text: vars[v] ?? "",
                })),
              },
            ]
          : [];
      const res = await sendTemplateMessage({
        phone_number_id: creds.phone_number_id,
        access_token: "",
        to: whatsappRecipientId(phone),
        template_name: selected.name,
        language_code: selected.languageCode || "en_US",
        components,
        quota_reserved: true,
      });
      if (!res.success) {
        if (uid && quotaReserved) {
          const { releaseQuota } = await import("@/lib/plans/limits");
          await releaseQuota(uid, "messages", 1).catch(() => {});
          quotaReserved = false;
        }
        throw new Error(res.message ?? "Send failed");
      }
      if (uid) {
        try {
          const db = fbDb();
          const normalized = normalizePhone(phone);
          const convId = phoneDocId(phone);
          let knownName = normalized;
          try {
            const snap = await getDoc(doc(db, "users", uid, "conversations", convId));
            const existing = snap.data()?.contactName;
            if (typeof existing === "string" && existing && existing !== normalized) {
              knownName = existing;
            }
          } catch {
            /* fall back */
          }
          const wamid = extractWamid(res.raw);
          await addDoc(collection(db, "users", uid, "messages"), {
            contactPhone: normalized,
            contactName: knownName,
            type: "template",
            direction: "outgoing",
            status: "sent",
            body: previewBody,
            templateName: selected.name,
            templateLanguage: selected.languageCode || "en_US",
            whatsappMessageId: wamid,
            sentVia: "template",
            createdAt: serverTimestamp(),
          });
          await setDoc(
            doc(db, "users", uid, "conversations", convId),
            {
              contactPhone: normalized,
              contactName: knownName,
              lastMessage: previewBody.slice(0, 100),
              lastMessageType: "template",
              lastMessageAt: serverTimestamp(),
            },
            { merge: true },
          );
        } catch {
          /* non-fatal */
        }
      }
      toast.success("Template sent");
      setShowSend(false);
      setPhone("");
    } catch (e) {
      if (uid && quotaReserved) {
        const { releaseQuota } = await import("@/lib/plans/limits");
        await releaseQuota(uid, "messages", 1).catch(() => {});
      }
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-5",
        showSend && selected
          ? "lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]"
          : "lg:grid-cols-[minmax(0,1fr)_420px]",
      )}
    >
      {/* LEFT — searchable template list */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search templates"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
            />
          </div>
          <WbButton onClick={() => void onSync()} loading={syncing} variant="secondary">
            <FontAwesomeIcon icon={faRotate} className="h-3.5 w-3.5" />
            Sync from Meta
          </WbButton>
          {canWrite && (<Link to="/templates/new">
            <WbButton>
              <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
              New template
            </WbButton>
          </Link>)}
        </div>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : filtered === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <WbEmpty
            icon={faFileLines}
            title={q ? "No matches" : "No templates yet"}
            description={q ? undefined : "Click 'Sync from Meta' to pull approved templates."}
          />
        ) : (
          <div className="grid gap-2">
            {filtered.map((t) => (
              <TemplateRow
                key={t.id}
                t={t}
                active={t.id === selectedId}
                onSelect={() => setSelectedId(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* RIGHT — sticky preview + actions. When Send Test is open, splits
          into two columns so the preview stays visible next to the form. */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        {selected ? (
          <div
            className={cn(
              "grid gap-4",
              showSend ? "md:grid-cols-2" : "grid-cols-1",
            )}
          >
            <div className="space-y-4">
              <WhatsAppPreview
                header={previewHeader}
                headerFormat={selected.headerFormat ?? (selected.header ? "TEXT" : null)}
                headerMediaUrl={selected.headerMediaUrl ?? null}
                body={previewBody}
                footer={selected.footer || null}
                buttons={selected.buttons ?? []}
                title={selected.name}
              />
            </div>
            <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Details
              </p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <DetailRow label="Name" value={selected.name} />
                <DetailRow label="Category" value={selected.category} />
                <DetailRow label="Language" value={selected.languageCode} />
                <DetailRow label="Status" value={selected.status} />
              </dl>
              {selected.variables.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Variables
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selected.variables.map((v) => (
                      <span
                        key={v}
                        className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground"
                      >{`{{${v}}}`}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {selected.status.toUpperCase() === "APPROVED" && (
                  <WbButton size="sm" onClick={() => setShowSend((s) => !s)}>
                    <FontAwesomeIcon icon={showSend ? faXmark : faPaperPlane} className="h-3 w-3" />
                    {showSend ? "Close send" : "Send test"}
                  </WbButton>
                )}
                {canWrite && selected.metaTemplateId && (
                  <Link to="/templates/$id/edit" params={{ id: selected.id }}>
                    <WbButton size="sm" variant="secondary">
                      <FontAwesomeIcon icon={faPencil} className="h-3 w-3" />
                      Edit
                    </WbButton>
                  </Link>
                )}
                {canDelete && (<WbButton
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeTemplate(selected)}
                >
                  <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                  Delete
                </WbButton>)}
              </div>
            </div>

            {showSend && selected.status.toUpperCase() === "APPROVED" && (
              <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Send test message
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Fill values below — the preview above updates in real time, then send.
                </p>
                <div className="mt-3 space-y-2">
                  <WbInput
                    label="Recipient phone (with country code)"
                    placeholder="+92300…"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  {selected.variables.map((v) => (
                    <WbInput
                      key={v}
                      label={`{{${v}}}`}
                      value={vars[v] ?? ""}
                      onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))}
                    />
                  ))}
                  <div className="flex justify-end gap-2 pt-1">
                    <WbButton
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowSend(false)}
                    >
                      Cancel
                    </WbButton>
                    <WbButton size="sm" onClick={() => void sendTest()} loading={sending}>
                      <FontAwesomeIcon icon={faPaperPlane} className="h-3 w-3" />
                      Send
                    </WbButton>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            Select a template to preview it.
          </div>
        )}
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === "APPROVED") return { icon: faCircleCheck, cls: "text-primary", label: "Approved" };
  if (s === "PENDING") return { icon: faClock, cls: "text-muted-foreground", label: "Pending" };
  return { icon: faCircleXmark, cls: "text-destructive", label: s };
}

function TemplateRow({
  t,
  active,
  onSelect,
}: {
  t: Template;
  active: boolean;
  onSelect: () => void;
}) {
  const b = statusBadge(t.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-xl border p-3 text-left transition-all",
        active
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{t.name}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t.category} · {t.languageCode}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-[11px] font-medium ${b.cls}`}>
          <FontAwesomeIcon icon={b.icon} className="h-3 w-3" />
          {b.label}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
        {t.body}
      </p>
      {t.variables.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {t.variables.slice(0, 4).map((v) => (
            <span
              key={v}
              className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
            >{`{{${v}}}`}</span>
          ))}
          {t.variables.length > 4 && (
            <span className="text-[10px] text-muted-foreground">
              +{t.variables.length - 4}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}
