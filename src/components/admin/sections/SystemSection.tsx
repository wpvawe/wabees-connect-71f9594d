import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBullhorn,
  faDownload,
  faRobot,
  faFloppyDisk,
  faCircleXmark,
  faCircleNotch,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { useConfigDoc } from "@/hooks/admin/useAdminData";
import { saveConfigDoc } from "@/lib/admin/mutations";

export function SystemSection() {
  return (
    <div className="space-y-6">
      <AnnouncementCard />
      <AppVersionCard />
      <AiMasterCard />
    </div>
  );
}

function AnnouncementCard() {
  const { data, loading } = useConfigDoc<{ message?: string; active?: boolean }>([
    "config",
    "announcement",
  ]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setMsg((data.message as string) ?? "");
  }, [data]);

  async function save(active: boolean) {
    const trimmed = msg.trim().slice(0, 500);
    if (active && !trimmed) {
      toast.error("Announcement message is required");
      return;
    }
    setSaving(true);
    try {
      await saveConfigDoc(["config", "announcement"], { message: trimmed, active });
      toast.success(active ? "Announcement sent to all users" : "Announcement disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Global announcement"
        subtitle="Shown to every signed-in user until disabled"
      />
      <WbCardBody className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Message</label>
              <textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Scheduled maintenance tonight at 11pm PKT…"
                className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">{msg.length}/500</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <WbButton onClick={() => void save(true)} loading={saving}>
                <FontAwesomeIcon icon={faBullhorn} className="h-3 w-3" /> Send to all
              </WbButton>
              {data?.active && (
                <WbButton variant="secondary" onClick={() => void save(false)} loading={saving}>
                  <FontAwesomeIcon icon={faCircleXmark} className="h-3 w-3" /> Disable current
                </WbButton>
              )}
              {data?.active && (
                <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                  Currently active
                </span>
              )}
            </div>
          </>
        )}
      </WbCardBody>
    </WbCard>
  );
}

function AppVersionCard() {
  const { data, loading } = useConfigDoc<{ minVersion?: string; downloadUrl?: string }>([
    "config",
    "app_version",
  ]);
  const [minVersion, setMinVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setMinVersion((data.minVersion as string) ?? "");
    setDownloadUrl((data.downloadUrl as string) ?? "");
  }, [data]);

  async function save() {
    const mv = minVersion.trim();
    const du = downloadUrl.trim();
    if (!mv || !du) {
      toast.error("Both fields are required");
      return;
    }
    try {
      new URL(du);
    } catch {
      toast.error("Download URL is not valid");
      return;
    }
    setSaving(true);
    try {
      await saveConfigDoc(["config", "app_version"], { minVersion: mv, downloadUrl: du });
      toast.success("App version config saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Force app update"
        subtitle="Mobile app users below minVersion are forced to update"
      />
      <WbCardBody className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <WbInput
                label="Minimum version"
                placeholder="e.g. 1.1.3"
                value={minVersion}
                onChange={(e) => setMinVersion(e.target.value)}
              />
              <WbInput
                label="Download URL"
                placeholder="https://wabees.live"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
              />
            </div>
            <WbButton onClick={save} loading={saving}>
              <FontAwesomeIcon icon={faDownload} className="h-3 w-3" /> Save
            </WbButton>
          </>
        )}
      </WbCardBody>
    </WbCard>
  );
}

function AiMasterCard() {
  const { data, loading } = useConfigDoc<{ masterPrompt?: string }>([
    "app_config",
    "ai_bot_master",
  ]);
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setPrompt((data.masterPrompt as string) ?? "");
  }, [data]);

  async function save() {
    const p = prompt.trim().slice(0, 4000);
    setSaving(true);
    try {
      await saveConfigDoc(["app_config", "ai_bot_master"], { masterPrompt: p });
      toast.success("AI master prompt saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="AI Bot master prompt"
        subtitle="Global rules applied on top of every user's AI bot"
      />
      <WbCardBody className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              maxLength={4000}
              placeholder="e.g. Never discuss competitors. Always recommend visiting the office…"
              className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{prompt.length}/4000</p>
              <WbButton onClick={save} loading={saving}>
                <FontAwesomeIcon icon={faFloppyDisk} className="h-3 w-3" /> Save
              </WbButton>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs text-muted-foreground">
              <FontAwesomeIcon icon={faRobot} className="mt-0.5 h-3 w-3 text-primary" />
              These instructions apply to ALL users' AI bots as a system-level guardrail.
            </p>
          </>
        )}
      </WbCardBody>
    </WbCard>
  );
}