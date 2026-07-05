import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCopy,
  faCircleCheck,
  faLink,
  faPaperPlane,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
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
import { formatInviteExpiry, sendAgentInviteEmail } from "@/lib/agents/invite-email";

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
  const [ttlDays, setTtlDays] = useState<number | null>(7);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [emailStatus, setEmailStatus] = useState<
    | { kind: "sent"; to: string }
    | { kind: "failed"; to: string; message: string }
    | { kind: "skipped" }
    | null
  >(null);

  function reset() {
    setEmail("");
    setRole("agent");
    setTtlDays(7);
    setLink(null);
    setCode(null);
    setCopied(null);
    setEmailStatus(null);
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

      // Auto-send the invite email when a recipient address is provided.
      // No more "open Gmail / Mail app / Copy email" manual steps — the
      // PHP backend delivers it directly. Link + code remain visible so
      // owner can copy/share them out-of-band if needed.
      const recipient = email.trim();
      if (recipient) {
        const result = await sendAgentInviteEmail({
          recipient,
          ownerEmail,
          ownerBusinessName,
          invite,
          link: url,
          ttlDays,
        });
        setEmailStatus(result);
        if (result.kind === "sent") toast.success(`Invite emailed to ${recipient}`);
      } else {
        setEmailStatus({ kind: "skipped" });
      }
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
            Enter the invitee's email and we'll send the invite for you automatically.
            You can also share the link/code manually if needed.
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
              label="Send invite to"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              hint="We'll email the invite here. Leave blank to skip sending — you can still copy the link/code after generating."
            />

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Expires in
              </label>
              <select
                value={ttlDays === null ? "never" : String(ttlDays)}
                onChange={(e) =>
                  setTtlDays(e.target.value === "never" ? null : Number(e.target.value))
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {emailStatus?.kind === "sent" && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                <FontAwesomeIcon icon={faPaperPlane} className="mt-0.5 h-3.5 w-3.5" />
                <span>
                  Invite emailed to <b>{emailStatus.to}</b>. They can also use the link/code
                  below.
                </span>
              </div>
            )}
            {emailStatus?.kind === "failed" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <FontAwesomeIcon
                  icon={faTriangleExclamation}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span>
                  Couldn't email <b>{emailStatus.to}</b> ({emailStatus.message}). Please share
                  the link/code below manually.
                </span>
              </div>
            )}
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
              {" · "} {formatInviteExpiry(ttlDays)}
            </div>
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
