import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";

const DEFAULT_MESSAGE =
  "Sorry, we missed your call. Please send us a message and we'll get back to you shortly.";

/**
 * Missed-call auto-reply setting. Persists to
 * `users/{ownerUid}/settings/missed_call_reply` — the webhook reads this
 * on every terminal call event (missed / not_answered / rejected) and
 * sends the text via WhatsApp.
 */
export function MissedCallReplySection() {
  const uid = useEffectiveUid();
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    const ref = doc(fbDb(), `users/${uid}/settings/missed_call_reply`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as { enabled?: boolean; message?: string };
          setEnabled(Boolean(data.enabled));
          if (typeof data.message === "string" && data.message.trim() !== "") {
            setMessage(data.message);
          }
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [uid]);

  async function save() {
    if (!uid) return;
    setSaving(true);
    try {
      await setDoc(
        doc(fbDb(), `users/${uid}/settings/missed_call_reply`),
        {
          enabled,
          message: message.trim() || DEFAULT_MESSAGE,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Missed-call auto-reply"
        subtitle="Send a WhatsApp text automatically when a call is missed, not answered, or rejected."
      />
      <WbCardBody className="space-y-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={loading}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Enable missed-call auto-reply
            </span>
            <span className="block text-xs text-muted-foreground">
              The caller receives this message on WhatsApp seconds after the call ends.
            </span>
          </span>
        </label>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reply message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={!enabled || loading}
            rows={3}
            maxLength={500}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-soft focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {message.length}/500 · Each auto-reply counts toward your monthly message quota.
          </p>
        </div>
        <div className="flex justify-end">
          <WbButton onClick={save} loading={saving} disabled={loading}>
            Save
          </WbButton>
        </div>
      </WbCardBody>
    </WbCard>
  );
}