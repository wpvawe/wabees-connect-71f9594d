import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faPlus, faTrash, faUsers } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAgents } from "@/hooks/useAgents";
import { useProfile } from "@/hooks/useProfile";
import { useFirebaseUid, useEffectiveUid } from "@/hooks/useFirebaseSession";
import { fbAuth, WABEES_API_BASE } from "@/integrations/firebase/client";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({ meta: [{ title: "Agents — Wabees" }] }),
  component: AgentsPage,
});

function AgentsPage() {
  const selfUid = useFirebaseUid();
  const ownerUid = useEffectiveUid();
  const { data: profile } = useProfile();
  const { data: agents, error } = useAgents();
  const isOwner = !profile?.dataOwner && selfUid === ownerUid;

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function addAgent() {
    if (!selfUid || !email.trim()) return;
    setBusy(true);
    try {
      const idToken = await fbAuth().currentUser!.getIdToken();
      const res = await fetch(`${WABEES_API_BASE}/add-agent.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: selfUid, agent_email: email.trim(), id_token: idToken }),
      });
      const raw = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || raw.error) throw new Error(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
      toast.success("Agent added");
      setEmail("");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    } finally { setBusy(false); }
  }

  async function removeAgent(agentId: string) {
    if (!selfUid) return;
    setRemoving(agentId);
    try {
      const idToken = await fbAuth().currentUser!.getIdToken();
      const res = await fetch(`${WABEES_API_BASE}/remove-agent.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: isOwner ? selfUid : ownerUid, agent_id: agentId, id_token: idToken }),
      });
      const raw = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || raw.error) throw new Error(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
      toast.success("Removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally { setRemoving(null); }
  }

  return (
    <>
      <TopBar
        title="Agents"
        subtitle="Team members sharing this WhatsApp number"
        right={isOwner ? (
          <WbButton size="sm" onClick={() => setOpen(true)}><FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> Add Agent</WbButton>
        ) : undefined}
      />
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
        <WbCard>
          <WbCardBody>
            {isOwner ? (
              <p className="text-sm text-foreground"><strong>You are the owner.</strong> Add team members below to share access to this WhatsApp number.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-foreground">You are an <strong>agent</strong> connected to owner <span className="font-mono text-xs">{profile?.dataOwner}</span>.</p>
                {selfUid && (
                  <WbButton variant="danger" size="sm" loading={removing === selfUid} onClick={() => removeAgent(selfUid)}>Disconnect from owner</WbButton>
                )}
              </div>
            )}
          </WbCardBody>
        </WbCard>

        <WbCard>
          <WbCardHeader title="Agents" subtitle="Real-time list of agents connected to this account." />
          <WbCardBody>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : agents === null ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : agents.length === 0 ? (
              <WbEmpty icon={faUsers} title="No agents yet" description="Add agents to let teammates respond to messages on this number." />
            ) : (
              <ul className="divide-y divide-border">
                {agents.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{a.email || a.id}</p>
                      <p className="text-[11px] text-muted-foreground">{a.joinedAt ? `Joined ${format(new Date(a.joinedAt), "PP")}` : "—"} · {a.role ?? "agent"}</p>
                    </div>
                    {isOwner && (
                      <WbButton variant="ghost" size="sm" loading={removing === a.id} onClick={() => removeAgent(a.id)} aria-label="Remove agent">
                        <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5 text-destructive" />
                      </WbButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </WbCardBody>
        </WbCard>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Agent</DialogTitle>
            <DialogDescription>Agent must have a Wabees account with the same email.</DialogDescription>
          </DialogHeader>
          <WbInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agent@example.com" />
          <DialogFooter>
            <WbButton variant="secondary" onClick={() => setOpen(false)}>Cancel</WbButton>
            <WbButton onClick={addAgent} loading={busy}>Add</WbButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}