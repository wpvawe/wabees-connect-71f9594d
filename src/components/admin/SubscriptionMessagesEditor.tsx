import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faFloppyDisk, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import {
  DEFAULT_SUBSCRIPTION_MESSAGES,
  loadSubscriptionMessages,
  saveSubscriptionMessages,
  type SubscriptionMessages,
} from "@/lib/firebase/subscriptionMessages";

const PLACEHOLDER_HINT = "{plan} {price} {currency} {user} {email} {phone} {status}";

export function SubscriptionMessagesEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [m, setM] = useState<SubscriptionMessages>(DEFAULT_SUBSCRIPTION_MESSAGES);

  useEffect(() => {
    let cancelled = false;
    void loadSubscriptionMessages().then((loaded) => {
      if (!cancelled) {
        setM(loaded);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await saveSubscriptionMessages(m);
      toast.success("Subscription messages saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <WbCard>
        <WbCardBody>
          <div className="flex items-center py-6 text-sm text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        </WbCardBody>
      </WbCard>
    );
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Subscription messages"
        subtitle="Templates and payment details shown to users when they request a plan"
        right={
          <div className="flex gap-2">
            <WbButton
              size="sm"
              variant="secondary"
              onClick={() => setM(DEFAULT_SUBSCRIPTION_MESSAGES)}
            >
              <FontAwesomeIcon icon={faRotateLeft} className="h-3 w-3" /> Reset
            </WbButton>
            <WbButton size="sm" onClick={save} disabled={saving}>
              <FontAwesomeIcon
                icon={saving ? faCircleNotch : faFloppyDisk}
                className={saving ? "h-3 w-3 animate-spin" : "h-3 w-3"}
              />
              {saving ? "Saving…" : "Save"}
            </WbButton>
          </div>
        }
      />
      <WbCardBody className="space-y-5">
        <Field
          label="Request template"
          hint={`Sent to admin on WhatsApp when a user requests a plan. Placeholders: ${PLACEHOLDER_HINT}`}
          value={m.requestTemplate}
          rows={6}
          onChange={(v) => setM({ ...m, requestTemplate: v })}
        />
        <Field
          label="Admin reply template"
          hint="Canned reply admin can copy when approving a request."
          value={m.replyTemplate}
          rows={5}
          onChange={(v) => setM({ ...m, replyTemplate: v })}
        />
        <Field
          label="Payment instructions"
          hint="Shown in the confirmation dialog after a user submits a request."
          value={m.paymentInstructions}
          rows={6}
          onChange={(v) => setM({ ...m, paymentInstructions: v })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Admin WhatsApp (E.164, digits only)"
            hint="e.g. 923001234567 — becomes wa.me/923001234567"
            value={m.adminContact.whatsapp}
            single
            onChange={(v) =>
              setM({
                ...m,
                adminContact: { ...m.adminContact, whatsapp: v.replace(/[^\d]/g, "") },
              })
            }
          />
          <Field
            label="Admin email"
            hint="Fallback contact channel"
            value={m.adminContact.email}
            single
            onChange={(v) => setM({ ...m, adminContact: { ...m.adminContact, email: v } })}
          />
        </div>
      </WbCardBody>
    </WbCard>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  single = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  single?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {single ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
      ) : (
        <textarea
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
        />
      )}
      <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}