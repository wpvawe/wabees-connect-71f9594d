import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCopy,
  faEnvelope,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import { toast } from "sonner";
import { WbButton } from "@/components/wb/WbButton";
import type { Plan } from "@/hooks/usePlans";
import { resolvePricing } from "@/lib/plans/pricing";
import {
  renderSubscriptionMessage,
  whatsappDeepLink,
  type SubscriptionMessages,
} from "@/lib/firebase/subscriptionMessages";

export function SubscriptionRequestDialog({
  open,
  onClose,
  plan,
  messages,
  user,
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan | null;
  messages: SubscriptionMessages;
  user: { name: string; email: string; phone: string };
}) {
  const [copied, setCopied] = useState(false);
  const priced = plan ? resolvePricing(plan) : null;

  const requestText = useMemo(() => {
    if (!plan || !priced) return "";
    return renderSubscriptionMessage(messages.requestTemplate, {
      plan: plan.name,
      price: priced.effectivePrice,
      currency: plan.currency,
      user: user.name,
      email: user.email,
      phone: user.phone,
    });
  }, [plan, priced, messages.requestTemplate, user]);

  if (!open || !plan) return null;

  const waUrl = whatsappDeepLink(messages.adminContact.whatsapp, requestText);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(requestText);
      setCopied(true);
      toast.success("Message copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Complete your {plan.name} request
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Send the message below to admin on WhatsApp and complete payment. Your
              request is already saved; we activate the plan once payment is confirmed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
          </button>
        </div>

        <section className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Message to admin
            </p>
            <button
              type="button"
              onClick={copyMessage}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs text-foreground">
            {requestText}
          </pre>
        </section>

        <section className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Payment instructions
          </p>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
            {messages.paymentInstructions}
          </pre>
        </section>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <FontAwesomeIcon icon={faWhatsapp} className="h-4 w-4" />
            Send on WhatsApp
          </a>
          <a
            href={`mailto:${messages.adminContact.email}?subject=${encodeURIComponent(
              `Subscription request: ${plan.name}`,
            )}&body=${encodeURIComponent(requestText)}`}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faEnvelope} className="h-4 w-4" />
            Email admin
          </a>
        </div>
      </div>
    </div>
  );
}