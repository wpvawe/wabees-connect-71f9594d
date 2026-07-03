/**
 * Single source of truth for role-based UI capabilities.
 *
 * Roles resolve from `useAgentRole()`:
 *   - "owner"       — signed-in user owns the data tree (no `dataOwner`)
 *   - "supervisor"  — agent with role='supervisor' under an owner
 *   - "agent"       — regular agent under an owner
 *
 * Firestore rules mirror this matrix. Keep them in sync when adding a new
 * capability — the UI gate hides the button, the rule blocks the write.
 */
import { useAgentRole, type AgentRole } from "@/hooks/useAgentRole";

export type Capability =
  // Billing & connection
  | "billing.manage"
  | "whatsapp.connect"
  | "whatsapp.disconnect"
  | "developer.api"
  | "business.profile.edit"
  | "support.chat"
  // Content
  | "contacts.write"
  | "contacts.delete"
  | "templates.write"
  | "templates.delete"
  | "templates.send"
  | "campaigns.write"
  | "campaigns.delete"
  | "bots.write"
  | "aiBot.manage"
  | "canned.write"
  // Inbox
  | "conversation.delete"
  | "conversation.block"
  | "conversation.assign"
  | "conversation.message"
  | "conversation.state"
  // Team
  | "team.manage"
  | "analytics.agents";

const MATRIX: Record<Capability, ReadonlyArray<AgentRole>> = {
  "billing.manage": ["owner"],
  "whatsapp.connect": ["owner"],
  "whatsapp.disconnect": ["owner"],
  "developer.api": ["owner"],
  "business.profile.edit": ["owner"],
  "support.chat": ["owner"],

  "contacts.write": ["owner"],
  "contacts.delete": ["owner"],
  "templates.write": ["owner"],
  "templates.delete": ["owner"],
  "templates.send": ["owner", "supervisor", "agent"],
  "campaigns.write": ["owner"],
  "campaigns.delete": ["owner"],
  "bots.write": ["owner"],
  "aiBot.manage": ["owner"],
  "canned.write": ["owner"],

  "conversation.delete": ["owner"],
  "conversation.block": ["owner", "supervisor"],
  "conversation.assign": ["owner", "supervisor"],
  "conversation.message": ["owner", "supervisor", "agent"],
  "conversation.state": ["owner", "supervisor", "agent"],

  "team.manage": ["owner"],
  "analytics.agents": ["owner", "supervisor"],
};

export function can(role: AgentRole | null, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[capability].includes(role);
}

/** Hook — resolves role once and returns a stable checker. */
export function useCan(): (capability: Capability) => boolean {
  const role = useAgentRole();
  return (capability) => can(role, capability);
}

export function useIsOwner(): boolean {
  return useAgentRole() === "owner";
}

export function useIsSupervisorOrOwner(): boolean {
  const r = useAgentRole();
  return r === "owner" || r === "supervisor";
}