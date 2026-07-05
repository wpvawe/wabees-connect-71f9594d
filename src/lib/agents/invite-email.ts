import { sendEmail } from "@/lib/wabees/api";
import type { AgentInvite } from "@/lib/firebase/agent-invites";

export type InviteEmailResult =
  | { kind: "sent"; to: string }
  | { kind: "failed"; to: string; message: string };

export function formatInviteExpiry(ttlDays: number | null | undefined): string {
  if (ttlDays === null) return "Never expires";
  const days = ttlDays ?? 14;
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendAgentInviteEmail(input: {
  recipient: string;
  ownerEmail: string | null;
  ownerBusinessName?: string | null;
  invite: AgentInvite;
  link: string;
  ttlDays: number | null;
}): Promise<InviteEmailResult> {
  const recipient = input.recipient.trim();
  const workspaceName = input.ownerBusinessName || input.ownerEmail || "our";
  const expiry = formatInviteExpiry(input.ttlDays);
  const subject = `You're invited to join ${workspaceName} Wabees workspace`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="margin:0 0 12px;">You're invited</h2>
      <p>You've been invited to join
        <b>${escapeHtml(workspaceName)}</b>
        as a <b>${escapeHtml(input.invite.role)}</b>.</p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${escapeHtml(input.link)}"
           style="background:#25D366;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">
          Accept invite
        </a>
      </p>
      <p style="font-size:13px;color:#555;">Or open this link:<br>
        <a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>
      <p style="font-size:13px;color:#555;">If prompted, enter this code after signing in:
        <b style="letter-spacing:2px;">${escapeHtml(input.invite.code)}</b></p>
      <p style="font-size:12px;color:#888;">${escapeHtml(expiry)}.</p>
    </div>`;
  const text = [
    `You've been invited to join ${workspaceName} Wabees workspace as a ${input.invite.role}.`,
    "",
    `Accept the invite: ${input.link}`,
    `Or enter this code after signing in: ${input.invite.code}`,
    "",
    `${expiry}.`,
  ].join("\n");

  try {
    const res = await sendEmail({
      to: recipient,
      subject,
      html,
      text,
      from_name: input.ownerBusinessName || "Wabees",
      reply_to: input.ownerEmail ?? undefined,
    });
    if (res.success) return { kind: "sent", to: recipient };
    return { kind: "failed", to: recipient, message: res.message ?? "Email delivery failed" };
  } catch (e) {
    return {
      kind: "failed",
      to: recipient,
      message: e instanceof Error ? e.message : "Email delivery failed",
    };
  }
}