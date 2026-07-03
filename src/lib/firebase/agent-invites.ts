/**
 * Agent-invite flow: owner generates a short-code invite token, invitee
 * opens `/join/{code}`, signs up/in with any email, and joins the workspace
 * as an agent or supervisor. Complements (does NOT replace) the connect-flow
 * consent path — see Batch 3 for that.
 *
 * Two mirrored docs per invite:
 *   users/{ownerId}/agent_invites/{inviteId}   — owner-facing list
 *   agent_invites/{code}                        — global lookup for the invitee
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

export type InviteRole = "agent" | "supervisor";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type AgentInvite = {
  id: string;
  code: string;
  email: string | null;
  role: InviteRole;
  status: InviteStatus;
  createdAt: number | null;
  expiresAt: number | null;
  acceptedBy?: string | null;
  acceptedAt?: number | null;
  createdByEmail?: string | null;
};

export type GlobalInvite = {
  code: string;
  ownerId: string;
  inviteId: string;
  role: InviteRole;
  status: InviteStatus;
  email: string | null;
  expiresAt: number | null;
  ownerEmail?: string | null;
  ownerBusinessName?: string | null;
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function tsToMillis(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  return null;
}

export async function createAgentInvite(input: {
  ownerUid: string;
  ownerEmail: string | null;
  ownerBusinessName?: string | null;
  role: InviteRole;
  email?: string | null;
  ttlDays?: number;
}): Promise<{ invite: AgentInvite; link: string }> {
  const db = fbDb();
  const ttl = Math.max(1, Math.min(60, input.ttlDays ?? 14));
  const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
  const email = (input.email ?? "").trim().toLowerCase() || null;
  const role: InviteRole = input.role === "supervisor" ? "supervisor" : "agent";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = generateCode();
    const globalRef = doc(db, `agent_invites/${code}`);
    const existing = await getDoc(globalRef).catch(() => null);
    if (existing?.exists()) continue;

    const inviteRef = await addDoc(collection(db, `users/${input.ownerUid}/agent_invites`), {
      code,
      email,
      role,
      status: "pending" as InviteStatus,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
      createdByEmail: input.ownerEmail ?? null,
    });

    const batch = writeBatch(db);
    batch.set(globalRef, {
      code,
      ownerId: input.ownerUid,
      inviteId: inviteRef.id,
      role,
      status: "pending" as InviteStatus,
      email,
      expiresAt: Timestamp.fromDate(expiresAt),
      ownerEmail: input.ownerEmail ?? null,
      ownerBusinessName: input.ownerBusinessName ?? null,
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://web.wabees.live";
    return {
      invite: {
        id: inviteRef.id,
        code,
        email,
        role,
        status: "pending",
        createdAt: Date.now(),
        expiresAt: expiresAt.getTime(),
        createdByEmail: input.ownerEmail ?? null,
      },
      link: `${origin}/join/${code}`,
    };
  }
  throw new Error("Could not allocate a unique invite code — please retry.");
}

export async function revokeAgentInvite(input: {
  ownerUid: string;
  inviteId: string;
  code: string;
}): Promise<void> {
  const db = fbDb();
  const batch = writeBatch(db);
  batch.update(doc(db, `users/${input.ownerUid}/agent_invites/${input.inviteId}`), {
    status: "revoked" as InviteStatus,
    revokedAt: serverTimestamp(),
  });
  batch.delete(doc(db, `agent_invites/${input.code}`));
  await batch.commit();
}

export async function lookupInviteByCode(code: string): Promise<GlobalInvite | null> {
  const db = fbDb();
  const snap = await getDoc(doc(db, `agent_invites/${code.trim().toUpperCase()}`));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    code: (d.code as string) ?? code,
    ownerId: (d.ownerId as string) ?? "",
    inviteId: (d.inviteId as string) ?? "",
    role: (d.role as InviteRole) ?? "agent",
    status: (d.status as InviteStatus) ?? "pending",
    email: (d.email as string) ?? null,
    expiresAt: tsToMillis(d.expiresAt),
    ownerEmail: (d.ownerEmail as string) ?? null,
    ownerBusinessName: (d.ownerBusinessName as string) ?? null,
  };
}

export async function acceptAgentInvite(input: {
  code: string;
  selfUid: string;
  selfEmail: string | null;
  /**
   * When true, the caller has already been shown the "you are switching
   * workspaces" warning and confirmed it. Without this flag we refuse to
   * overwrite an existing `dataOwner` on the invitee's user doc.
   */
  confirmSwitch?: boolean;
}): Promise<{ ownerId: string; role: InviteRole }> {
  const db = fbDb();
  const invite = await lookupInviteByCode(input.code);
  if (!invite) throw new Error("Invite code not found.");
  if (invite.status !== "pending") {
    throw new Error(
      invite.status === "accepted"
        ? "This invite has already been used."
        : invite.status === "revoked"
          ? "This invite has been revoked by the owner."
          : "This invite has expired.",
    );
  }
  if (invite.expiresAt && invite.expiresAt < Date.now()) {
    throw new Error("This invite has expired.");
  }
  if (invite.ownerId === input.selfUid) {
    throw new Error("You cannot accept an invite you sent to yourself.");
  }
  if (
    invite.email &&
    input.selfEmail &&
    invite.email.toLowerCase() !== input.selfEmail.toLowerCase()
  ) {
    throw new Error(
      `This invite is for ${invite.email}. Please sign in with that email to accept.`,
    );
  }

  // H-2: don't silently overwrite a previous workspace membership. If the
  // invitee already has `dataOwner` pointing at a DIFFERENT owner, force
  // the caller to pass `confirmSwitch: true` after showing an explicit
  // "you will leave workspace X and join workspace Y" confirmation.
  const selfSnap = await getDoc(doc(db, `users/${input.selfUid}`));
  const priorRaw = selfSnap.exists() ? (selfSnap.data() as Record<string, unknown>).dataOwner : null;
  const priorOwner =
    typeof priorRaw === "string" && priorRaw.trim() && priorRaw !== invite.ownerId
      ? priorRaw.trim()
      : null;
  if (priorOwner && !input.confirmSwitch) {
    const err = new Error(
      "You are already an agent in another workspace. Confirm the switch to continue.",
    ) as Error & { code?: string; priorOwner?: string; nextOwner?: string; nextRole?: InviteRole };
    err.code = "AGENT_SWITCH_REQUIRED";
    err.priorOwner = priorOwner;
    err.nextOwner = invite.ownerId;
    err.nextRole = invite.role;
    throw err;
  }

  // Order matters: firestore rules on users/{ownerId}/agents/{agentId}
  // require that the global invite mirror already shows acceptedBy == self.
  // So we flip the invite to 'accepted' FIRST, then create the agent doc.
  const acceptPatch = {
    status: "accepted" as InviteStatus,
    acceptedBy: input.selfUid,
    acceptedAt: serverTimestamp(),
  };
  await updateDoc(doc(db, `agent_invites/${invite.code}`), {
    ...acceptPatch,
    ownerId: invite.ownerId,
    inviteId: invite.inviteId,
    role: invite.role,
  });

  await setDoc(
    doc(db, `users/${invite.ownerId}/agents/${input.selfUid}`),
    {
      email: input.selfEmail ?? null,
      role: invite.role,
      status: "active",
      joinedAt: serverTimestamp(),
      joinedVia: "invite",
      inviteCode: invite.code,
      skills: [],
    },
    { merge: true },
  );

  await setDoc(
    doc(db, `users/${input.selfUid}`),
    {
      dataOwner: invite.ownerId,
      dataOwnerJoinedAt: serverTimestamp(),
      dataOwnerJoinedVia: "invite",
    },
    { merge: true },
  );

  // Best-effort mirror update on the owner-scoped invite doc. Rules
  // reject writes from the invitee here (owner-only), so this is only
  // effective when the invitee happens to also be the owner (impossible
  // — we guarded against that above) — kept for the admin path.
  await updateDoc(
    doc(db, `users/${invite.ownerId}/agent_invites/${invite.inviteId}`),
    acceptPatch,
  ).catch(() => undefined);

  try {
    await addDoc(collection(db, `users/${invite.ownerId}/notifications`), {
      type: "agent_invite_accepted",
      title: "New agent joined your workspace",
      message: `${input.selfEmail ?? "A new agent"} accepted your invite and joined as ${invite.role}.`,
      inviteCode: invite.code,
      agentUid: input.selfUid,
      agentEmail: input.selfEmail ?? null,
      role: invite.role,
      createdAt: serverTimestamp(),
      read: false,
    });
  } catch {
    /* best-effort */
  }

  return { ownerId: invite.ownerId, role: invite.role };
}

export async function deleteGlobalInviteMirror(code: string): Promise<void> {
  try {
    await deleteDoc(doc(fbDb(), `agent_invites/${code}`));
  } catch {
    /* rules will reject for non-owners; fine */
  }
}

export const PENDING_INVITE_KEY = "wabees.pendingInviteCode";
