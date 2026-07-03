import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy, faCircleCheck, faEnvelope, faLink } from "@fortawesome/free-solid-svg-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { toast } from "sonner";
import { createAgentInvite, type InviteRole } from "@/lib/firebase/agent-invites";

export function InviteAgentDialog({
  open,
  onOpenChange,
  ownerUid,
  ownerEmail,
  ownerBusinessName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerUid: string;
  ownerEmail: string | null;
  ownerBusinessName?: string | null;
}) {
  const [role, setRole] = useState<InviteRole>("agent");
  const [email, setEmail] = useState("");
  const [ttlDays, setTtlDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  function reset() {
    setEmail("");
    setRole("agent");
    setTtlDays(14);
    setLink(null);
    setCode(null);
    setCopied(null);
  }

  async function generate() {
    setBusy(true);
    try {
      const { invite, link: url } = await createAgentInvite({
        ownerUid,
        ownerEmail,
        ownerBusinessName: ownerBusinessName ?? null,
        role,
        email: email || null,
        ttlDays,
      });
      setLink(url);
      setCode(invite.code);
      toast.success("Invite created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create invite");
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "link" | "code", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Copy failed — please copy manually");
    }
  }

  function openMail() {
    if (!link) return;
    const subject = encodeURIComponent(
      `You're invited to join ${ownerBusinessName || ownerEmail || "our"} Wabees workspace`,
    );
    const body = encodeURIComponent(
      [
        `Hi,`,
        ``,
        `You've been invited to join our Wabees workspace as a ${role}.`,
        ``,
        `Accept the invite here:`,
        link,
        ``,
        `Or enter this code after signing in: ${code}`,
        ``,
        `This link expires in ${ttlDays} day${ttlDays === 1 ? "" : "s"}.`,
      ].join("\n"),
    );
    const to = encodeURIComponent(email || "");
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_blank");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Generate an invite link. The invitee opens the link, signs in with any email, and
            instantly joins your workspace.
          </DialogDescription>
        </DialogHeader>

        {!link ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Role
              </label>
              <div className="inline-flex w-full rounded-md bg-muted p-1">
                {(["agent", "supervisor"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                      role === r
                        ? "bg-card text-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {role === "supervisor"
                  ? "Can reassign conversations and view team analytics."
                  : "Can reply to conversations and change ticket state."}
              </p>
            </div>

            <WbInput
              label="Email (optional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              hint="If set, only this email can accept. Leave blank to allow any email."
            />

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Expires in
              </label>
              <select
                value={ttlDays}
                onChange={(e) => setTtlDays(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Invite link
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={link}
                  className="h-9 flex-1 rounded-md border border-input bg-muted px-2 text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <WbButton
                  variant="secondary"
                  size="sm"
                  onClick={() => copy("link", link)}
                  aria-label="Copy link"
                >
                  <FontAwesomeIcon
                    icon={copied === "link" ? faCircleCheck : faCopy}
                    className="h-3.5 w-3.5"
                  />
                </WbButton>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Invite code
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={code ?? ""}
                  className="h-9 flex-1 rounded-md border border-input bg-muted px-2 font-mono text-sm tracking-widest"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <WbButton
                  variant="secondary"
                  size="sm"
                  onClick={() => copy("code", code ?? "")}
                  aria-label="Copy code"
                >
                  <FontAwesomeIcon
                    icon={copied === "code" ? faCircleCheck : faCopy}
                    className="h-3.5 w-3.5"
                  />
                </WbButton>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Invitee can enter this code on the join page if the link is blocked.
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <FontAwesomeIcon icon={faLink} className="mr-1.5 h-3 w-3" /> Role:{" "}
              <span className="font-semibold text-foreground capitalize">{role}</span>
              {email && (
                <>
                  {" · "} Restricted to:{" "}
                  <span className="font-semibold text-foreground">{email}</span>
                </>
              )}
              {" · "} Expires in {ttlDays} day{ttlDays === 1 ? "" : "s"}
            </div>

            <WbButton variant="secondary" onClick={openMail}>
              <FontAwesomeIcon icon={faEnvelope} className="mr-1.5 h-3.5 w-3.5" /> Send via email
            </WbButton>
          </div>
        )}

        <DialogFooter>
          {!link ? (
            <>
              <WbButton variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </WbButton>
              <WbButton onClick={generate} loading={busy}>
                Generate invite
              </WbButton>
            </>
          ) : (
            <>
              <WbButton
                variant="secondary"
                onClick={() => {
                  reset();
                }}
              >
                Create another
              </WbButton>
              <WbButton onClick={() => onOpenChange(false)}>Done</WbButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
