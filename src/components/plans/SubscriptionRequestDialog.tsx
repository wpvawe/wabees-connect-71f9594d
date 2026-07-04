import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCircleCheck,
  faComments,
  faCopy,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbButton } from "@/components/wb/WbButton";
import { Link } from "@tanstack/react-router";
import type { Plan } from "@/hooks/usePlans";
import { resolvePricing } from "@/lib/plans/pricing";
import {
  renderSubscriptionMessage,
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
              Request sent for {plan.name}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Your request and payment instructions have been posted to the support chat.
              Continue the conversation there — admin will confirm your payment and activate
              the plan.
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

        <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <FontAwesomeIcon icon={faCircleCheck} className="mt-0.5 h-3.5 w-3.5" />
          <span>
            Request delivered to support. An auto-reply with payment details is already
            waiting for you in the support chat.
          </span>
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
          <Link
            to="/support"
            onClick={onClose}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <FontAwesomeIcon icon={faComments} className="h-4 w-4" />
            Open support chat
          </Link>
          <WbButton variant="secondary" onClick={onClose} className="flex-1">
            Close
          </WbButton>
        </div>
      </div>
    </div>
  );
}