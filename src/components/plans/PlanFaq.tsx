import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";

const ITEMS: { q: string; a: string }[] = [
  {
    q: "How does subscription approval work?",
    a: "Choose a plan and click Request. Your request lands in the support chat with payment instructions. Once you pay and share the receipt, admin activates your plan — usually within a few hours during business hours.",
  },
  {
    q: "What payment methods are accepted?",
    a: "Bank transfer, JazzCash, Easypaisa, and other local methods listed in the payment instructions message. International cards can be arranged on request — write to support.",
  },
  {
    q: "Can I upgrade or downgrade later?",
    a: "Yes. Request any other plan from this page — the new plan takes effect after admin approval. Unused days on your current plan are credited toward the new plan on a pro-rata basis.",
  },
  {
    q: "What happens when I hit a message or contact limit?",
    a: "Outbound sends will pause once your monthly quota is used up. Incoming messages continue as normal. Upgrade to a higher plan or wait for the next billing cycle — quotas reset automatically.",
  },
  {
    q: "Do I need my own WhatsApp Business API access?",
    a: "No. Wabees is fully integrated with WhatsApp Cloud API — just connect your business number from the Connect page and you're live. Each subscription activates one WhatsApp number.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Absolutely. Subscriptions are month-to-month with no lock-in contract. Cancel by writing to support at any time — your access continues until the end of the current paid period.",
  },
];

/**
 * FAQ accordion shown at the bottom of /plans. Uses a controlled `useState`
 * open index so keyboard/screen readers get a single-open semantic.
 */
export function PlanFaq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section aria-labelledby="plan-faq-heading" className="space-y-3">
      <div className="text-center">
        <h2
          id="plan-faq-heading"
          className="text-xl font-bold tracking-tight text-foreground sm:text-2xl"
        >
          Frequently asked questions
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you need to know before subscribing.
        </p>
      </div>
      <div className="mx-auto max-w-3xl divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        {ITEMS.map((it, i) => {
          const isOpen = open === i;
          return (
            <div key={it.q}>
              <button
                type="button"
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/50"
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span className="text-sm font-semibold text-foreground">{it.q}</span>
                <FontAwesomeIcon
                  icon={faChevronDown}
                  className={`h-3 w-3 text-muted-foreground transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">
                  {it.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}