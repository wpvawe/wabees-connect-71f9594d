import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faLocationDot,
  faSquareCaretRight,
  faLink,
  faListUl,
  faPlus,
  faTrash,
  faPaperPlane,
  faCircleNotch,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import {
  sendLocationMessage,
  sendReplyButtonsMessage,
  sendCtaUrlMessage,
  sendListMessage,
} from "@/lib/wabees/api";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { whatsappRecipientId, normalizePhone, phoneDocId } from "@/lib/firebase/normalizers";
import { fbDb } from "@/integrations/firebase/client";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { releaseQuota, reserveQuota } from "@/lib/plans/limits";

type Kind = "menu" | "location" | "buttons" | "cta" | "list";

/**
 * Modal that composes and sends WhatsApp Cloud API interactive messages
 * (location / quick-reply buttons / CTA URL / list). Writes an optimistic
 * Firestore row so the outgoing bubble appears immediately.
 */
export function InteractiveDialog({
  open,
  onClose,
  phone,
  uid,
  selfUid,
  contextMessageId,
}: {
  open: boolean;
  onClose: () => void;
  phone: string;
  uid: string;
  selfUid: string;
  contextMessageId?: string | null;
}) {
  const [kind, setKind] = useState<Kind>("menu");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl border border-border bg-card p-4 pb-6 shadow-xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">
            {kind === "menu" && "Send interactive"}
            {kind === "location" && "Send location"}
            {kind === "buttons" && "Quick reply buttons"}
            {kind === "cta" && "Call-to-action button"}
            {kind === "list" && "List message"}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
          </button>
        </div>

        {kind === "menu" && (
          <div className="grid grid-cols-2 gap-3">
            <Tile icon={faLocationDot} label="Location" color="bg-red-500" onClick={() => setKind("location")} />
            <Tile icon={faSquareCaretRight} label="Reply Buttons" color="bg-blue-500" onClick={() => setKind("buttons")} />
            <Tile icon={faLink} label="CTA URL" color="bg-emerald-500" onClick={() => setKind("cta")} />
            <Tile icon={faListUl} label="List" color="bg-purple-500" onClick={() => setKind("list")} />
          </div>
        )}

        {kind === "location" && (
          <LocationForm
            onCancel={() => setKind("menu")}
            onDone={onClose}
            phone={phone}
            uid={uid}
            selfUid={selfUid}
            contextMessageId={contextMessageId ?? null}
          />
        )}
        {kind === "buttons" && (
          <ButtonsForm
            onCancel={() => setKind("menu")}
            onDone={onClose}
            phone={phone}
            uid={uid}
            selfUid={selfUid}
            contextMessageId={contextMessageId ?? null}
          />
        )}
        {kind === "cta" && (
          <CtaForm
            onCancel={() => setKind("menu")}
            onDone={onClose}
            phone={phone}
            uid={uid}
            selfUid={selfUid}
            contextMessageId={contextMessageId ?? null}
          />
        )}
        {kind === "list" && (
          <ListForm
            onCancel={() => setKind("menu")}
            onDone={onClose}
            phone={phone}
            uid={uid}
            selfUid={selfUid}
            contextMessageId={contextMessageId ?? null}
          />
        )}
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  color,
  onClick,
}: {
  icon: import("@fortawesome/fontawesome-svg-core").IconDefinition;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted"
    >
      <span className={`grid h-10 w-10 place-items-center rounded-full text-white ${color}`}>
        <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Actions({
  disabled,
  onCancel,
  onSend,
  loading,
}: {
  disabled?: boolean;
  onCancel: () => void;
  onSend: () => void;
  loading?: boolean;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
      >
        Back
      </button>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onSend}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
      >
        {loading ? (
          <FontAwesomeIcon icon={faCircleNotch} className="h-3 w-3 animate-spin" />
        ) : (
          <FontAwesomeIcon icon={faPaperPlane} className="h-3 w-3" />
        )}
        Send
      </button>
    </div>
  );
}

// Common helper: after a successful Meta send, write matching Firestore row.
async function persistOutgoing(
  uid: string,
  phone: string,
  data: Record<string, unknown>,
  wamid: string | null,
  preview: string,
  type: string,
) {
  const db = fbDb();
  const normalized = normalizePhone(phone);
  const convId = phoneDocId(phone);
  const ref = await addDoc(collection(db, "users", uid, "messages"), {
    contactPhone: normalized,
    contactName: normalized,
    type,
    direction: "outgoing",
    status: wamid ? "sent" : "failed",
    whatsappMessageId: wamid,
    ...data,
    createdAt: serverTimestamp(),
  });
  await setDoc(
    doc(db, "users", uid, "conversations", convId),
    {
      contactPhone: normalized,
      lastMessage: preview,
      lastMessageType: type,
      lastMessageAt: serverTimestamp(),
    },
    { merge: true },
  );
  return ref;
}

function LocationForm(p: {
  onCancel: () => void;
  onDone: () => void;
  phone: string;
  uid: string;
  selfUid: string;
  contextMessageId: string | null;
}) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [loading, setLoading] = useState(false);

  async function useMyLocation() {
    if (!navigator.geolocation) return toast.error("Geolocation not available");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      () => toast.error("Could not read location"),
    );
  }

  async function send() {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return toast.error("Enter valid latitude & longitude");
    }
    setLoading(true);
    let quotaReserved = false;
    try {
      try {
        await reserveQuota(p.uid, "messages", 1);
        quotaReserved = true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Message limit reached");
        return;
      }
      const creds = await loadWaConnection(p.selfUid);
      if (!creds) return toast.error("Connect WhatsApp first");
      const res = await sendLocationMessage({
        phone_number_id: creds.phone_number_id,
        access_token: "",
        to: whatsappRecipientId(p.phone),
        latitude,
        longitude,
        name: name || undefined,
        address: addr || undefined,
        context_message_id: p.contextMessageId,
      });
      const wamid = extractId(res.raw);
      if (!res.success) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
        return toast.error(res.message ?? "Send failed");
      }
      if (quotaReserved) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
      }
      await persistOutgoing(
        p.uid,
        p.phone,
        {
          latitude,
          longitude,
          location: { latitude, longitude, name: name || null, address: addr || null },
          body: name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        },
        wamid,
        `📍 ${name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}`,
        "location",
      );
      p.onDone();
    } catch (e) {
      if (quotaReserved) await releaseQuota(p.uid, "messages", 1).catch(() => {});
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={useMyLocation}
        className="w-full rounded-md border border-dashed border-border px-3 py-2 text-xs hover:bg-muted"
      >
        Use my current location
      </button>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Latitude">
          <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="24.8607" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Longitude">
          <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="67.0011" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </Field>
      </div>
      <Field label="Name (optional)">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Address (optional)">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Actions onCancel={p.onCancel} onSend={send} loading={loading} />
    </div>
  );
}

function ButtonsForm(p: {
  onCancel: () => void;
  onDone: () => void;
  phone: string;
  uid: string;
  selfUid: string;
  contextMessageId: string | null;
}) {
  const [body, setBody] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<Array<{ id: string; title: string }>>([
    { id: "b1", title: "" },
  ]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!body.trim()) return toast.error("Body text required");
    const filled = buttons.filter((b) => b.title.trim());
    if (filled.length === 0) return toast.error("At least one button required");
    setLoading(true);
    let quotaReserved = false;
    try {
      try {
        await reserveQuota(p.uid, "messages", 1);
        quotaReserved = true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Message limit reached");
        return;
      }
      const creds = await loadWaConnection(p.selfUid);
      if (!creds) return toast.error("Connect WhatsApp first");
      const res = await sendReplyButtonsMessage({
        phone_number_id: creds.phone_number_id,
        access_token: "",
        to: whatsappRecipientId(p.phone),
        body_text: body.trim(),
        header_text: header || undefined,
        footer_text: footer || undefined,
        buttons: filled,
        context_message_id: p.contextMessageId,
      });
      const wamid = extractId(res.raw);
      if (!res.success) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
        return toast.error(res.message ?? "Send failed");
      }
      if (quotaReserved) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
      }
      await persistOutgoing(
        p.uid,
        p.phone,
        {
          body: body.trim(),
          headerText: header || null,
          footerText: footer || null,
          interactiveType: "button",
          quickReplies: filled,
        },
        wamid,
        `🔘 ${body.trim()}`,
        "interactive",
      );
      p.onDone();
    } catch (e) {
      if (quotaReserved) await releaseQuota(p.uid, "messages", 1).catch(() => {});
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Header (optional)">
        <input value={header} onChange={(e) => setHeader(e.target.value)} maxLength={60} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Body text *">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1024} className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Buttons ({buttons.length}/3, ≤20 chars)</p>
        {buttons.map((b, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              value={b.title}
              onChange={(e) => {
                const next = [...buttons];
                next[i] = { ...b, title: e.target.value };
                setButtons(next);
              }}
              placeholder={`Button ${i + 1}`}
              maxLength={20}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
            {buttons.length > 1 && (
              <button
                type="button"
                onClick={() => setButtons(buttons.filter((_, j) => j !== i))}
                className="grid h-8 w-8 place-items-center rounded-md text-destructive hover:bg-destructive/10"
              >
                <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {buttons.length < 3 && (
          <button
            type="button"
            onClick={() => setButtons([...buttons, { id: `b${buttons.length + 1}`, title: "" }])}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faPlus} className="h-3 w-3" /> Add button
          </button>
        )}
      </div>
      <Field label="Footer (optional)">
        <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Actions onCancel={p.onCancel} onSend={send} loading={loading} />
    </div>
  );
}

function CtaForm(p: {
  onCancel: () => void;
  onDone: () => void;
  phone: string;
  uid: string;
  selfUid: string;
  contextMessageId: string | null;
}) {
  const [body, setBody] = useState("");
  const [displayText, setDisplayText] = useState("");
  const [url, setUrl] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!body.trim()) return toast.error("Body text required");
    if (!displayText.trim()) return toast.error("Button text required");
    if (!/^https?:\/\//i.test(url)) return toast.error("URL must start with http(s)://");
    setLoading(true);
    let quotaReserved = false;
    try {
      try {
        await reserveQuota(p.uid, "messages", 1);
        quotaReserved = true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Message limit reached");
        return;
      }
      const creds = await loadWaConnection(p.selfUid);
      if (!creds) return toast.error("Connect WhatsApp first");
      const res = await sendCtaUrlMessage({
        phone_number_id: creds.phone_number_id,
        access_token: "",
        to: whatsappRecipientId(p.phone),
        body_text: body.trim(),
        display_text: displayText.trim(),
        url: url.trim(),
        header_text: header || undefined,
        footer_text: footer || undefined,
        context_message_id: p.contextMessageId,
      });
      const wamid = extractId(res.raw);
      if (!res.success) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
        return toast.error(res.message ?? "Send failed");
      }
      if (quotaReserved) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
      }
      await persistOutgoing(
        p.uid,
        p.phone,
        {
          body: body.trim(),
          headerText: header || null,
          footerText: footer || null,
          interactiveType: "cta_url",
          ctaUrl: url.trim(),
          ctaButton: { display_text: displayText.trim(), url: url.trim() },
        },
        wamid,
        `🔗 ${body.trim()}`,
        "interactive",
      );
      p.onDone();
    } catch (e) {
      if (quotaReserved) await releaseQuota(p.uid, "messages", 1).catch(() => {});
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Header (optional)">
        <input value={header} onChange={(e) => setHeader(e.target.value)} maxLength={60} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Body text *">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Button text * (≤20)">
        <input value={displayText} onChange={(e) => setDisplayText(e.target.value)} maxLength={20} placeholder="Open" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="URL *">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Footer (optional)">
        <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Actions onCancel={p.onCancel} onSend={send} loading={loading} />
    </div>
  );
}

function ListForm(p: {
  onCancel: () => void;
  onDone: () => void;
  phone: string;
  uid: string;
  selfUid: string;
  contextMessageId: string | null;
}) {
  const [body, setBody] = useState("");
  const [buttonText, setButtonText] = useState("Choose");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [rows, setRows] = useState<Array<{ id: string; title: string; description: string }>>([
    { id: "r1", title: "", description: "" },
  ]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!body.trim()) return toast.error("Body text required");
    const filled = rows.filter((r) => r.title.trim());
    if (filled.length === 0) return toast.error("At least one row required");
    setLoading(true);
    let quotaReserved = false;
    try {
      try {
        await reserveQuota(p.uid, "messages", 1);
        quotaReserved = true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Message limit reached");
        return;
      }
      const creds = await loadWaConnection(p.selfUid);
      if (!creds) return toast.error("Connect WhatsApp first");
      const res = await sendListMessage({
        phone_number_id: creds.phone_number_id,
        access_token: "",
        to: whatsappRecipientId(p.phone),
        body_text: body.trim(),
        button_text: buttonText.trim() || "Choose",
        header_text: header || undefined,
        footer_text: footer || undefined,
        sections: [
          {
            title: header || "Options",
            rows: filled.map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
        context_message_id: p.contextMessageId,
      });
      const wamid = extractId(res.raw);
      if (!res.success) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
        return toast.error(res.message ?? "Send failed");
      }
      if (quotaReserved) {
        await releaseQuota(p.uid, "messages", 1).catch(() => {});
        quotaReserved = false;
      }
      await persistOutgoing(
        p.uid,
        p.phone,
        {
          body: body.trim(),
          headerText: header || null,
          footerText: footer || null,
          interactiveType: "list",
          quickReplies: filled,
        },
        wamid,
        `📋 ${body.trim()}`,
        "interactive",
      );
      p.onDone();
    } catch (e) {
      if (quotaReserved) await releaseQuota(p.uid, "messages", 1).catch(() => {});
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Header (optional)">
        <input value={header} onChange={(e) => setHeader(e.target.value)} maxLength={60} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Body text *">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Button text (≤20)">
        <input value={buttonText} onChange={(e) => setButtonText(e.target.value)} maxLength={20} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Rows ({rows.length}/10)</p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              value={r.title}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...r, title: e.target.value };
                setRows(next);
              }}
              placeholder={`Row ${i + 1} title`}
              maxLength={24}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={r.description}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...r, description: e.target.value };
                setRows(next);
              }}
              placeholder="Description"
              maxLength={72}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="grid h-8 w-8 place-items-center rounded-md text-destructive hover:bg-destructive/10"
              >
                <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {rows.length < 10 && (
          <button
            type="button"
            onClick={() => setRows([...rows, { id: `r${rows.length + 1}`, title: "", description: "" }])}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faPlus} className="h-3 w-3" /> Add row
          </button>
        )}
      </div>
      <Field label="Footer (optional)">
        <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </Field>
      <Actions onCancel={p.onCancel} onSend={send} loading={loading} />
    </div>
  );
}

function extractId(raw: Record<string, unknown> | undefined | null): string | null {
  if (!raw) return null;
  const messages = Array.isArray(raw.messages) ? (raw.messages as Array<Record<string, unknown>>) : null;
  const first = messages?.[0];
  const id = (first?.id as string | undefined) ?? (raw.id as string | undefined);
  return typeof id === "string" && id.trim() ? id : null;
}

// avoid unused import warning
void updateDoc;