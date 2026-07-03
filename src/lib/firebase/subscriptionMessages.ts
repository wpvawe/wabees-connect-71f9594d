/**
 * Central Firestore config for subscription-related copy:
 *   settings/subscription_messages
 *
 * - requestTemplate: message the user sends to admin on WhatsApp when
 *   they click "Request subscription". Supports {plan}, {price},
 *   {currency}, {user}, {email}, {phone} placeholders.
 * - replyTemplate: canned reply the admin sends after approval.
 *   Same placeholders + {status}.
 * - paymentInstructions: shown on the confirmation dialog after a
 *   request is submitted (bank accounts, easypaisa, etc.).
 * - adminContact.whatsapp: E.164 (no + or spaces) — used to build the
 *   wa.me deep-link for the request message.
 * - adminContact.email: fallback contact channel.
 */
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

export type SubscriptionMessages = {
  requestTemplate: string;
  replyTemplate: string;
  paymentInstructions: string;
  adminContact: {
    whatsapp: string;
    email: string;
  };
};

export const DEFAULT_SUBSCRIPTION_MESSAGES: SubscriptionMessages = {
  requestTemplate:
    "Assalam-o-Alaikum Wabees team,\n\nI would like to subscribe to the *{plan}* plan ({currency} {price}/mo).\n\nName: {user}\nEmail: {email}\nPhone: {phone}\n\nPlease share the payment details. Shukriya!",
  replyTemplate:
    "Wa alaikum assalam {user},\n\nYour request for the *{plan}* plan has been received. Please send payment using the details below and share the receipt so we can activate your subscription.\n\nJazakAllah khair.",
  paymentInstructions:
    "Bank Transfer\nAccount Title: WABEES\nBank: (add your bank)\nAccount / IBAN: (add your IBAN)\n\nEasyPaisa / JazzCash: (add number)\n\nAfter payment, please send the receipt on WhatsApp so we can activate your plan.",
  adminContact: {
    whatsapp: "923001234567",
    email: "support@wabees.live",
  },
};

export const SUBSCRIPTION_MESSAGES_PATH = "settings/subscription_messages";

function subscriptionMessagesRef() {
  return doc(fbDb(), "settings", "subscription_messages");
}

function normalize(raw: Record<string, unknown> | undefined): SubscriptionMessages {
  if (!raw) return DEFAULT_SUBSCRIPTION_MESSAGES;
  const admin = (raw.adminContact as Record<string, unknown> | undefined) ?? {};
  return {
    requestTemplate:
      typeof raw.requestTemplate === "string" && raw.requestTemplate.trim()
        ? (raw.requestTemplate as string)
        : DEFAULT_SUBSCRIPTION_MESSAGES.requestTemplate,
    replyTemplate:
      typeof raw.replyTemplate === "string" && raw.replyTemplate.trim()
        ? (raw.replyTemplate as string)
        : DEFAULT_SUBSCRIPTION_MESSAGES.replyTemplate,
    paymentInstructions:
      typeof raw.paymentInstructions === "string" && raw.paymentInstructions.trim()
        ? (raw.paymentInstructions as string)
        : DEFAULT_SUBSCRIPTION_MESSAGES.paymentInstructions,
    adminContact: {
      whatsapp:
        typeof admin.whatsapp === "string" && admin.whatsapp.trim()
          ? (admin.whatsapp as string).replace(/[^\d]/g, "")
          : DEFAULT_SUBSCRIPTION_MESSAGES.adminContact.whatsapp,
      email:
        typeof admin.email === "string" && admin.email.trim()
          ? (admin.email as string)
          : DEFAULT_SUBSCRIPTION_MESSAGES.adminContact.email,
    },
  };
}

export async function loadSubscriptionMessages(): Promise<SubscriptionMessages> {
  try {
    const snap = await getDoc(subscriptionMessagesRef());
    return normalize(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined);
  } catch {
    return DEFAULT_SUBSCRIPTION_MESSAGES;
  }
}

export function subscribeSubscriptionMessages(
  cb: (m: SubscriptionMessages) => void,
): () => void {
  return onSnapshot(
    subscriptionMessagesRef(),
    (snap) => cb(normalize(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined)),
    () => cb(DEFAULT_SUBSCRIPTION_MESSAGES),
  );
}

export async function saveSubscriptionMessages(m: SubscriptionMessages): Promise<void> {
  await setDoc(
    subscriptionMessagesRef(),
    { ...m, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Substitute {plan}, {price}, {currency}, {user}, {email}, {phone}, {status}. */
export function renderSubscriptionMessage(
  template: string,
  vars: {
    plan?: string;
    price?: number | string;
    currency?: string;
    user?: string;
    email?: string;
    phone?: string;
    status?: string;
  },
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = (vars as Record<string, unknown>)[key];
    return v === undefined || v === null || v === "" ? "" : String(v);
  });
}

/** Build a wa.me deep-link URL. */
export function whatsappDeepLink(phone: string, message: string): string {
  const cleaned = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}