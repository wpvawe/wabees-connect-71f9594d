import { useMemo, useState } from "react";
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
  faEllipsisVertical,
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
import { extractWamid, sendTemplateMessage } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { normalizePhone, phoneDocId, whatsappRecipientId } from "@/lib/firebase/normalizers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { WbInput } from "@/components/wb/WbInput";

export function TemplateGrid() {
  const { data, error } = useTemplates();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [sendingTpl, setSendingTpl] = useState<Template | null>(null);

  async function onSync() {
    if (!uid || !selfUid) return;
    setSyncing(true);
    try {
      const r = await syncTemplatesFromMeta(uid, selfUid);
      toast.success(`Synced ${r.synced} templates`);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <TemplateCard key={t.id} t={t} onSend={() => setSendingTpl(t)} />
          ))}
        </div>
      )}
      <SendTemplateDialog
        template={sendingTpl}
        onClose={() => setSendingTpl(null)}
        credentialUid={selfUid}
        ownerUid={uid}
      />
    </div>
  );
}

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === "APPROVED") return { icon: faCircleCheck, cls: "text-primary", label: "Approved" };
  if (s === "PENDING") return { icon: faClock, cls: "text-muted-foreground", label: "Pending" };
  return { icon: faCircleXmark, cls: "text-destructive", label: s };
}

function TemplateCard({ t, onSend }: { t: Template; onSend: () => void }) {
  const b = statusBadge(t.status);
  const uid = useEffectiveUid();
  const [menuOpen, setMenuOpen] = useState(false);
  async function remove() {
    if (!uid) return;
    if (
      !confirm(
        `Delete template "${t.name}" from this workspace? (Meta-approved templates can be re-synced.)`,
      )
    )
      return;
    try {
      await deleteDoc(doc(fbDb(), "users", uid, "templates", t.id));
      toast.success("Template removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }
  return (
    <div className="relative flex flex-col rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{t.name}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t.category} · {t.languageCode}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`flex items-center gap-1 text-[11px] font-medium ${b.cls}`}>
            <FontAwesomeIcon icon={b.icon} className="h-3 w-3" />
            {b.label}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted"
              aria-label="More"
            >
              <FontAwesomeIcon icon={faEllipsisVertical} className="h-3 w-3" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-7 z-10 min-w-[140px] rounded-lg border border-border bg-card p-1 text-sm shadow-md"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={remove}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
                >
                  <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {t.header && <p className="mt-3 text-xs font-semibold text-foreground">{t.header}</p>}
      <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs text-muted-foreground">
        {t.body}
      </p>
      {t.footer && <p className="mt-2 text-[11px] italic text-muted-foreground">{t.footer}</p>}
      {t.variables.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {t.variables.map((v) => (
            <span
              key={v}
              className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
            >{`{{${v}}}`}</span>
          ))}
        </div>
      )}
      {t.status.toUpperCase() === "APPROVED" && (
        <WbButton size="sm" className="mt-3 self-start" onClick={onSend}>
          <FontAwesomeIcon icon={faPaperPlane} className="h-3 w-3" /> Send
        </WbButton>
      )}
    </div>
  );
}

function SendTemplateDialog({
  template,
  onClose,
  credentialUid,
}: {
  template: Template | null;
  onClose: () => void;
  credentialUid: string | null;
}) {
  const [phone, setPhone] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  function reset() {
    setPhone("");
    setVars({});
    onClose();
  }

  async function send() {
    if (!template || !credentialUid) return;
    if (!phone.trim()) {
      toast.error("Enter recipient phone number");
      return;
    }
    setSending(true);
    try {
      const creds = await loadWaCredentials(credentialUid);
      if (!creds) throw new Error("Connect WhatsApp first");
      const components: Array<Record<string, unknown>> =
        template.variables.length > 0
          ? [
              {
                type: "body",
                parameters: template.variables.map((v) => ({
                  type: "text",
                  text: vars[v] ?? "",
                })),
              },
            ]
          : [];
      const res = await sendTemplateMessage({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        to: whatsappRecipientId(phone),
        template_name: template.name,
        language_code: template.languageCode || "en_US",
        components,
      });
      if (!res.success) throw new Error(res.message ?? "Send failed");
      toast.success("Template sent");
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!template} onOpenChange={(open) => !open && reset()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send template</DialogTitle>
          <DialogDescription>{template?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <WbInput
            label="Recipient phone (with country code)"
            placeholder="+92300…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {template?.variables.map((v) => (
            <WbInput
              key={v}
              label={`{{${v}}}`}
              value={vars[v] ?? ""}
              onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))}
            />
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <WbButton variant="secondary" onClick={reset}>
              Cancel
            </WbButton>
            <WbButton onClick={send} loading={sending}>
              Send
            </WbButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
