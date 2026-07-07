import {
  collection,
  doc,
  getDoc,
  getCountFromServer,
  increment,
  runTransaction,
  updateDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

export type LimitKind =
  | "campaigns"
  | "contacts"
  | "bots"
  | "templates"
  | "messages"
  | "aiMessages"
  | "agents";

type LimitConfig = {
  label: string;
  maxField: string;
  collectionName?: string;
  usedField?: string; // on subscription doc
  profileField?: string; // fallback counter on users/{uid}
};

const CONFIG: Record<LimitKind, LimitConfig> = {
  campaigns: {
    label: "campaigns",
    maxField: "maxCampaigns",
    collectionName: "campaigns",
    usedField: "campaignsUsed",
    profileField: "totalCampaigns",
  },
  contacts: {
    label: "contacts",
    maxField: "maxContacts",
    collectionName: "contacts",
    usedField: "contactsUsed",
    profileField: "totalContacts",
  },
  bots: {
    label: "bots",
    maxField: "maxBots",
    collectionName: "bots",
    usedField: "botsUsed",
    profileField: "totalBots",
  },
  templates: {
    label: "templates",
    maxField: "maxTemplates",
    collectionName: "templates",
    usedField: "templatesUsed",
    profileField: "totalTemplates",
  },
  messages: {
    label: "messages",
    maxField: "maxMessages",
    usedField: "messagesUsed",
    profileField: "totalMessages",
  },
  aiMessages: {
    label: "AI messages",
    maxField: "maxAiMessages",
    usedField: "aiMessagesUsed",
  },
  agents: {
    label: "team members",
    maxField: "maxAgents",
    collectionName: "agents",
    usedField: "agentsUsed",
  },
};

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/**
 * Toleration window for clock skew when comparing endDate to now.
 * A few minutes prevents "just expired" flapping between client/server clocks.
 */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "object" && v !== null) {
    const o = v as { toMillis?: () => number; seconds?: number };
    if (typeof o.toMillis === "function") return o.toMillis();
    if (typeof o.seconds === "number") return o.seconds * 1000;
  }
  return null;
}

/**
 * Throws a friendly error if the user's plan is expired or inactive.
 * Lifetime plans (`expiryType === "lifetime"` or no endDate) never expire.
 * Callers should invoke this before any billable action.
 */
export async function assertPlanActive(uid: string): Promise<void> {
  const db = fbDb();
  const subSnap = await getDoc(doc(db, "users", uid, "subscription", "current"));
  if (!subSnap.exists()) return; // no plan doc — legacy accounts, don't block
  const sub = subSnap.data() as Record<string, unknown>;
  const status = String(sub.status ?? "active").toLowerCase();
  if (status === "cancelled" || status === "canceled" || status === "expired") {
    throw new Error(
      "Your subscription is inactive. Please renew or upgrade your plan to continue.",
    );
  }
  const expiryType = String(sub.expiryType ?? "").toLowerCase();
  if (expiryType === "lifetime") return;
  const endMs = toMillis(sub.endDate);
  if (endMs === null) return; // no endDate stored — treat as unlimited window
  if (Date.now() - EXPIRY_SKEW_MS > endMs) {
    throw new Error(
      "Your plan has expired. Please renew or upgrade to continue using this feature.",
    );
  }
}

/**
 * Reads live subscription + user doc and throws a friendly error if creating
 * `count` more of `kind` would exceed the current plan's cap.
 * A max of 0 or less is treated as Unlimited.
 */
export async function assertWithinPlanLimit(
  uid: string,
  kind: LimitKind,
  count = 1,
): Promise<void> {
  const cfg = CONFIG[kind];
  const db = fbDb();
  // Step 1: block if plan is expired/cancelled — irrespective of counters.
  await assertPlanActive(uid);
  const [subSnap, profSnap] = await Promise.all([
    getDoc(doc(db, "users", uid, "subscription", "current")),
    getDoc(doc(db, "users", uid)),
  ]);
  if (!subSnap.exists()) return; // no active plan doc — don't block
  const sub = subSnap.data() as Record<string, unknown>;
  const max = num(sub[cfg.maxField]);
  if (max <= 0) return; // unlimited

  const liveUsed = cfg.collectionName
    ? await getCountFromServer(collection(db, "users", uid, cfg.collectionName))
        .then((snap) => snap.data().count)
        .catch(() => null)
    : null;
  const subUsed = cfg.usedField ? num(sub[cfg.usedField]) : 0;
  const profileUsed =
    cfg.profileField && profSnap.exists()
      ? num((profSnap.data() as Record<string, unknown>)[cfg.profileField])
      : 0;
  const used = typeof liveUsed === "number" ? liveUsed : Math.max(subUsed, profileUsed);

  if (used + count > max) {
    const remaining = Math.max(0, max - used);
    const planName = (sub.planName as string) || (sub.planId as string) || "current plan";
    if (count === 1) {
      throw new Error(
        `Your ${planName} allows ${max} ${cfg.label} (${used}/${max} used). Upgrade to create more.`,
      );
    }
    throw new Error(
      `Your ${planName} allows ${max} ${cfg.label}. Only ${remaining} slot(s) left — tried to add ${count}. Upgrade to add more.`,
    );
  }
}

/**
 * Bumps both `subscription.current.messagesUsed` and `users/{uid}.totalMessages`
 * by `n`. Every outbound WhatsApp send path — text, media, template,
 * interactive, forward, resend, CSAT, scheduled — MUST call this after a
 * successful Meta send so per-plan quotas stay accurate. Silently swallows
 * failures because Firestore permission hiccups shouldn't block the UI.
 */
export async function incrementMessagesUsed(uid: string, n = 1): Promise<void> {
  if (!uid || n <= 0) return;
  const db = fbDb();
  await Promise.all([
    updateDoc(doc(db, "users", uid), { totalMessages: increment(n) }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("incrementMessagesUsed: totalMessages update failed", err);
    }),
    updateDoc(doc(db, "users", uid, "subscription", "current"), {
      messagesUsed: increment(n),
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("incrementMessagesUsed: subscription.messagesUsed update failed", err);
    }),
  ]);
}

/**
 * Bumps subscription.contactsUsed AND users/{uid}.totalContacts by `n`.
 * Call from any code path that creates or imports contacts.
 */
export async function incrementContactsUsed(uid: string, n = 1): Promise<void> {
  if (!uid || n === 0) return;
  const db = fbDb();
  await Promise.all([
    updateDoc(doc(db, "users", uid), { totalContacts: increment(n) }).catch(() => {}),
    updateDoc(doc(db, "users", uid, "subscription", "current"), {
      contactsUsed: increment(n),
    }).catch(() => {}),
  ]);
}

export async function incrementBotsUsed(uid: string, n = 1): Promise<void> {
  if (!uid || n === 0) return;
  const db = fbDb();
  await Promise.all([
    updateDoc(doc(db, "users", uid), { totalBots: increment(n) }).catch(() => {}),
    updateDoc(doc(db, "users", uid, "subscription", "current"), {
      botsUsed: increment(n),
    }).catch(() => {}),
  ]);
}

/** Bumps subscription.aiMessagesUsed by `n`. */
export async function incrementAiMessagesUsed(uid: string, n = 1): Promise<void> {
  if (!uid || n <= 0) return;
  const db = fbDb();
  await updateDoc(doc(db, "users", uid, "subscription", "current"), {
    aiMessagesUsed: increment(n),
  }).catch(() => {});
}

/**
 * ATOMIC reserve-and-increment. Wraps the cap check + counter increment in a
 * single Firestore transaction so N parallel requests can't all pass the
 * check and slip past `maxMessages`. This closes the race window that
 * `assertWithinPlanLimit` + separate `incrementMessagesUsed` had.
 *
 * Usage pattern for a send path:
 *   const released = { done: false };
 *   await reserveQuota(uid, "messages", 1);   // throws if over cap / expired
 *   try {
 *     const res = await sendToMeta(...);
 *     if (!res.success) throw new Error(res.message);
 *   } catch (err) {
 *     if (!released.done) await releaseQuota(uid, "messages", 1);
 *     throw err;
 *   }
 *
 * For kinds that have a `profileField` (messages/contacts/campaigns/bots),
 * we also update the mirrored counter on the users doc so admin dashboards
 * stay in sync with subscription.usedField.
 */
export async function reserveQuota(
  uid: string,
  kind: LimitKind,
  n = 1,
): Promise<void> {
  if (!uid || n <= 0) return;
  const cfg = CONFIG[kind];
  const db = fbDb();
  const subRef = doc(db, "users", uid, "subscription", "current");
  const userRef = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const subSnap = await tx.get(subRef);
    if (!subSnap.exists()) {
      // Legacy account without a subscription doc — don't block the action
      // (otherwise every legacy user gets stuck). These users are surfaced
      // in the admin panel via `useUsersWithoutSubscription` so an admin
      // can back-fill a plan without seeing DevTools noise.
      return;
    }
    const sub = subSnap.data() as Record<string, unknown>;

    // Expiry / status guard (same rules as assertPlanActive).
    const status = String(sub.status ?? "active").toLowerCase();
    if (status === "cancelled" || status === "canceled" || status === "expired") {
      throw new Error(
        "Your subscription is inactive. Please renew or upgrade your plan to continue.",
      );
    }
    const expiryType = String(sub.expiryType ?? "").toLowerCase();
    if (expiryType !== "lifetime") {
      const endMs = toMillis(sub.endDate);
      if (endMs !== null && Date.now() - EXPIRY_SKEW_MS > endMs) {
        throw new Error(
          "Your plan has expired. Please renew or upgrade to continue using this feature.",
        );
      }
    }

    const max = num(sub[cfg.maxField]);
    if (max > 0) {
        const liveUsed = cfg.collectionName
          ? await getCountFromServer(collection(db, "users", uid, cfg.collectionName))
              .then((snap) => snap.data().count)
              .catch(() => null)
          : null;
        const subUsed = cfg.usedField ? num(sub[cfg.usedField]) : 0;
        const used = typeof liveUsed === "number" ? liveUsed : subUsed;
      if (used + n > max) {
        const remaining = Math.max(0, max - used);
        const planName =
          (sub.planName as string) || (sub.planId as string) || "current plan";
        throw new Error(
          n === 1
            ? `Your ${planName} allows ${max} ${cfg.label} (${used}/${max} used). Upgrade to create more.`
            : `Your ${planName} allows ${max} ${cfg.label}. Only ${remaining} slot(s) left — tried to add ${n}. Upgrade to add more.`,
        );
      }
    }

    // Atomic increment inside the same transaction — no race window.
    if (cfg.usedField) {
      tx.update(subRef, { [cfg.usedField]: increment(n) });
    }
  });

  // Mirror to the profile counter (best-effort, outside tx — the sub doc
  // is the source of truth for enforcement).
  if (cfg.profileField) {
    await updateDoc(userRef, { [cfg.profileField]: increment(n) }).catch(() => {});
  }
}

/**
 * Compensating write for reserveQuota when the downstream action failed
 * (Meta rejected the send, media upload crashed, etc.). Decrements both
 * the subscription counter and the mirrored profile counter.
 */
export async function releaseQuota(
  uid: string,
  kind: LimitKind,
  n = 1,
): Promise<void> {
  if (!uid || n <= 0) return;
  const cfg = CONFIG[kind];
  const db = fbDb();
  const jobs: Promise<unknown>[] = [];
  if (cfg.usedField) {
    jobs.push(
      updateDoc(doc(db, "users", uid, "subscription", "current"), {
        [cfg.usedField]: increment(-n),
      }).catch(() => {}),
    );
  }
  if (cfg.profileField) {
    jobs.push(
      updateDoc(doc(db, "users", uid), {
        [cfg.profileField]: increment(-n),
      }).catch(() => {}),
    );
  }
  await Promise.all(jobs);
}