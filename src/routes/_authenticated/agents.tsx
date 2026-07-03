import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faPlus,
  faTrash,
  faUsers,
  faBan,
  faCircleCheck,
  faUserShield,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgents } from "@/hooks/useAgents";
import { useFirebaseUid, useEffectiveUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { useOwnerInfo } from "@/hooks/useOwnerInfo";
import { fbAuth, WABEES_API_BASE } from "@/integrations/firebase/client";
import { revokeAgent, reinstateAgent, updateAgentRole } from "@/lib/firebase/assignments";
import { updateAgentSkills } from "@/lib/firebase/assignments";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({ meta: [{ title: "Agents — Wabees" }] }),
  component: AgentsPage,
});

function AgentsPage() {
  const selfUid = useFirebaseUid();
  const ownerUid = useEffectiveUid();
  const session = useFirebaseSession();
  const dataOwner = session.status === "ready" ? session.dataOwner : null;
  const { data: agents, error } = useAgents();
  const isOwner = !dataOwner && selfUid === ownerUid;
  const owner = useOwnerInfo();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [skillsDraft, setSkillsDraft] = useState<Record<string, string>>({});
  const [savingSkills, setSavingSkills] = useState<string | null>(null);
  const currentEmail = session.status === "ready" ? session.user.email ?? null : null;

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
      const raw = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || raw.error)
        throw new Error(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
      toast.success("Agent added");
      setEmail("");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeAgent(agentId: string) {
    if (!selfUid) return;
    if (!confirm("Permanently remove this agent? Their access is revoked immediately.")) return;
    setRemoving(agentId);
    try {
      // Instant client-side revoke first — cuts off access before the PHP
      // delete round-trip. If PHP fails the agent is still locked out.
      try {
        await revokeAgent(isOwner ? selfUid : ownerUid!, agentId, {
          uid: selfUid,
          email: currentEmail,
        });
      } catch {
        /* fall through to PHP delete */
      }
      const idToken = await fbAuth().currentUser!.getIdToken();
      const res = await fetch(`${WABEES_API_BASE}/remove-agent.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner_id: isOwner ? selfUid : ownerUid,
          agent_id: agentId,
          id_token: idToken,
        }),
      });
      const raw = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || raw.error)
        throw new Error(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
      toast.success("Removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemoving(null);
    }
  }

  async function handleRevoke(agentId: string) {
    if (!selfUid || !isOwner) return;
    setActioning(agentId);
    try {
      await revokeAgent(selfUid, agentId, { uid: selfUid, email: currentEmail });
      toast.success("Access revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setActioning(null);
    }
  }

  async function handleReinstate(agentId: string) {
    if (!selfUid || !isOwner) return;
    setActioning(agentId);
    try {
      await reinstateAgent(selfUid, agentId);
      toast.success("Access restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reinstate failed");
    } finally {
      setActioning(null);
    }
  }

  async function handleRoleChange(agentId: string, role: "agent" | "supervisor") {
    if (!selfUid || !isOwner) return;
    setActioning(agentId);
    try {
      await updateAgentRole(selfUid, agentId, role);
      toast.success(role === "supervisor" ? "Promoted to supervisor" : "Set as agent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Role update failed");
    } finally {
      setActioning(null);
    }
  }

  async function handleSaveSkills(agentId: string, current: string[]) {
    if (!selfUid || !isOwner) return;
    const raw = skillsDraft[agentId] ?? current.join(", ");
    const list = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    setSavingSkills(agentId);
    try {
      await updateAgentSkills(selfUid, agentId, list);
      toast.success("Skills updated");
      setSkillsDraft((d) => {
        const { [agentId]: _, ...rest } = d;
        return rest;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingSkills(null);
    }
  }

  return (
    <>
      <TopBar
        title="Agents"
        subtitle="Team members sharing this WhatsApp number"
        right={
          isOwner ? (
            <WbButton size="sm" onClick={() => setOpen(true)}>
              <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> Add Agent
            </WbButton>
          ) : undefined
        }
      />
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
        <WbCard>
          <WbCardBody>
            {isOwner ? (
              <p className="text-sm text-foreground">
                <strong>You are the owner.</strong> Add team members below to share access to this
                WhatsApp number.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  {owner?.profileImageUrl ? (
                    <img
                      src={owner.profileImageUrl}
                      alt=""
                      className="h-11 w-11 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {((owner?.businessName || owner?.displayName || owner?.email || "?")
                        .trim()
                        .charAt(0)
                        .toUpperCase()) || "?"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      You are an <strong>agent</strong> connected to:
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                      {owner?.businessName || owner?.displayName || owner?.email || "Owner"}
                    </p>
                    {owner?.email && (
                      <p className="truncate text-xs text-muted-foreground">{owner.email}</p>
                    )}
                  </div>
                </div>
                {selfUid && (
                  <WbButton
                    variant="danger"
                    size="sm"
                    loading={removing === selfUid}
                    onClick={() => removeAgent(selfUid)}
                  >
                    Disconnect from owner
                  </WbButton>
                )}
              </div>
            )}
          </WbCardBody>
        </WbCard>

        <WbCard>
          <WbCardHeader
            title="Agents"
            subtitle="Real-time list of agents connected to this account."
          />
          <WbCardBody>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : agents === null ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />{" "}
                Loading…
              </div>
            ) : agents.length === 0 ? (
              <WbEmpty
                icon={faUsers}
                title="No agents yet"
                description="Add agents to let teammates respond to messages on this number."
              />
            ) : (
              <ul className="divide-y divide-border">
                {agents.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {a.email || a.id}
                        </p>
                        {a.status === "revoked" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                            <FontAwesomeIcon icon={faBan} className="h-2.5 w-2.5" /> Revoked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-600">
                            <FontAwesomeIcon icon={faCircleCheck} className="h-2.5 w-2.5" /> Active
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            a.role === "supervisor"
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <FontAwesomeIcon
                            icon={a.role === "supervisor" ? faUserShield : faUser}
                            className="h-2.5 w-2.5"
                          />
                          {a.role === "supervisor" ? "Supervisor" : "Agent"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {a.joinedAt ? `Joined ${format(new Date(a.joinedAt), "PP")}` : "—"}
                        {a.status === "revoked" && a.revokedAt
                          ? ` · Revoked ${format(new Date(a.revokedAt), "PP")}`
                          : ""}
                      </p>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1">
                        {a.status !== "revoked" && (
                          <select
                            value={a.role === "supervisor" ? "supervisor" : "agent"}
                            onChange={(e) =>
                              handleRoleChange(a.id, e.target.value as "agent" | "supervisor")
                            }
                            disabled={actioning === a.id}
                            className="h-8 rounded border border-input bg-background px-2 text-xs"
                            aria-label="Role"
                          >
                            <option value="agent">Agent</option>
                            <option value="supervisor">Supervisor</option>
                          </select>
                        )}
                        {a.status === "revoked" ? (
                          <WbButton
                            variant="secondary"
                            size="sm"
                            loading={actioning === a.id}
                            onClick={() => handleReinstate(a.id)}
                          >
                            Reinstate
                          </WbButton>
                        ) : (
                          <WbButton
                            variant="ghost"
                            size="sm"
                            loading={actioning === a.id}
                            onClick={() => handleRevoke(a.id)}
                            aria-label="Revoke access"
                            title="Revoke access (keeps audit trail)"
                          >
                            <FontAwesomeIcon icon={faBan} className="h-3.5 w-3.5" />
                          </WbButton>
                        )}
                        <WbButton
                          variant="ghost"
                          size="sm"
                          loading={removing === a.id}
                          onClick={() => removeAgent(a.id)}
                          aria-label="Remove agent"
                          title="Permanently remove"
                        >
                          <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5 text-destructive" />
                        </WbButton>
                      </div>
                    )}
                    {isOwner && a.status !== "revoked" && (
                      <div className="mt-2 flex w-full flex-wrap items-center gap-2">
                        <label
                          htmlFor={`skills-${a.id}`}
                          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          Skills
                        </label>
                        <input
                          id={`skills-${a.id}`}
                          type="text"
                          value={skillsDraft[a.id] ?? a.skills.join(", ")}
                          onChange={(e) =>
                            setSkillsDraft((d) => ({ ...d, [a.id]: e.target.value }))
                          }
                          placeholder="sales, billing, urdu, tier-2"
                          className="h-8 min-w-[220px] flex-1 rounded border border-input bg-background px-2 text-xs outline-none ring-ring focus-visible:ring-2"
                        />
                        <WbButton
                          size="sm"
                          variant="secondary"
                          loading={savingSkills === a.id}
                          disabled={
                            skillsDraft[a.id] === undefined ||
                            skillsDraft[a.id] === a.skills.join(", ")
                          }
                          onClick={() => handleSaveSkills(a.id, a.skills)}
                        >
                          Save
                        </WbButton>
                      </div>
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
            <DialogDescription>
              Agent must have a Wabees account with the same email.
            </DialogDescription>
          </DialogHeader>
          <WbInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="agent@example.com"
          />
          <DialogFooter>
            <WbButton variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </WbButton>
            <WbButton onClick={addAgent} loading={busy}>
              Add
            </WbButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
