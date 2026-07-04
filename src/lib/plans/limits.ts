import { doc, getDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

export type LimitKind = "campaigns" | "contacts" | "bots" | "templates";

type LimitConfig = {
  label: string;
  maxField: string;
  usedField?: string; // on subscription doc
  profileField?: string; // fallback counter on users/{uid}
};

const CONFIG: Record<LimitKind, LimitConfig> = {
  campaigns: {
    label: "campaigns",
    maxField: "maxCampaigns",
    usedField: "campaignsUsed",
    profileField: "totalCampaigns",
  },
  contacts: {
    label: "contacts",
    maxField: "maxContacts",
    usedField: "contactsUsed",
    profileField: "totalContacts",
  },
  bots: {
    label: "bots",
    maxField: "maxBots",
    usedField: "botsUsed",
    profileField: "totalBots",
  },
  templates: {
    label: "templates",
    maxField: "maxTemplates",
    usedField: "templatesUsed",
  },
};

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
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
  const [subSnap, profSnap] = await Promise.all([
    getDoc(doc(db, "users", uid, "subscription", "current")),
    getDoc(doc(db, "users", uid)),
  ]);
  if (!subSnap.exists()) return; // no active plan doc — don't block
  const sub = subSnap.data() as Record<string, unknown>;
  const max = num(sub[cfg.maxField]);
  if (max <= 0) return; // unlimited

  const subUsed = cfg.usedField ? num(sub[cfg.usedField]) : 0;
  const profileUsed =
    cfg.profileField && profSnap.exists()
      ? num((profSnap.data() as Record<string, unknown>)[cfg.profileField])
      : 0;
  const used = Math.max(subUsed, profileUsed);

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