import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faRotateRight,
  faSave,
  faWhatsapp as _ignored,
} from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { fbAuth, WABEES_API_BASE } from "@/integrations/firebase/client";
import { toast } from "sonner";

const VERTICALS = [
  "UNDEFINED",
  "OTHER",
  "AUTO",
  "BEAUTY",
  "APPAREL",
  "EDU",
  "ENTERTAIN",
  "EVENT_PLAN",
  "FINANCE",
  "GROCERY",
  "GOVT",
  "HOTEL",
  "HEALTH",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
];

type ProfileForm = {
  about: string;
  description: string;
  email: string;
  address: string;
  website: string;
  vertical: string;
};

const EMPTY: ProfileForm = {
  about: "",
  description: "",
  email: "",
  address: "",
  website: "",
  vertical: "UNDEFINED",
};

export function BusinessProfileSection() {
  const { data: wa } = useWhatsAppConfig();
  const [form, setForm] = useState<ProfileForm>(EMPTY);
  const [profilePic, setProfilePic] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadedFor = useRef<string | null>(null);

  function set<K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const load = useCallback(async (silent = false) => {
    if (!wa?.phone_number_id) return;
    if (!silent) setLoading(true);
    try {
      const idToken = await fbAuth().currentUser!.getIdToken();
      const res = await fetch(`${WABEES_API_BASE}/business-profile.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get",
          phone_number_id: wa.phone_number_id,
          id_token: idToken,
        }),
      });
      const raw = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || raw.error)
        throw new Error(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
      const websites = Array.isArray(raw.websites) ? (raw.websites as string[]) : [];
      setForm({
        about: String(raw.about ?? ""),
        description: String(raw.description ?? ""),
        email: String(raw.email ?? ""),
        address: String(raw.address ?? ""),
        website: websites[0] ?? "",
        vertical: String(raw.vertical ?? "UNDEFINED"),
      });
      setProfilePic(String(raw.profile_picture_url ?? ""));
      if (!silent) toast.success("Loaded from WhatsApp");
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [wa?.phone_number_id]);

  // Auto-fetch once per connected phone_number_id.
  useEffect(() => {
    const pid = wa?.phone_number_id;
    if (!pid) return;
    if (loadedFor.current === pid) return;
    loadedFor.current = pid;
    void load(true);
  }, [wa?.phone_number_id, load]);

  async function save() {
    if (!wa?.phone_number_id) return;
    setSaving(true);
    try {
      const idToken = await fbAuth().currentUser!.getIdToken();
      // Meta Graph rejects empty strings for some fields — only send non-empty.
      const body: Record<string, unknown> = {
        action: "update",
        phone_number_id: wa.phone_number_id,
        id_token: idToken,
        vertical: form.vertical || "UNDEFINED",
        websites: form.website ? [form.website] : [],
      };
      if (form.about.trim()) body.about = form.about.trim();
      if (form.description.trim()) body.description = form.description.trim();
      if (form.email.trim()) body.email = form.email.trim();
      if (form.address.trim()) body.address = form.address.trim();
      const res = await fetch(`${WABEES_API_BASE}/business-profile.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || raw.error)
        throw new Error(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
      toast.success("Saved to WhatsApp");
      // Re-pull fresh values (silent) so UI shows what Meta now reports.
      void load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!wa) return null;

  const initial = (wa.business_name || form.about || "?").trim().charAt(0).toUpperCase();

  return (
    <WbCard>
      <WbCardHeader
        title="WhatsApp Business Profile"
        subtitle="This info is visible to customers on WhatsApp."
        right={
          <WbButton variant="ghost" size="sm" onClick={() => void load(false)} loading={loading}>
            <FontAwesomeIcon
              icon={loading ? faCircleNotch : faRotateRight}
              className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
            />
            Refresh
          </WbButton>
        }
      />
      <WbCardBody className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
          {profilePic ? (
            <img
              src={profilePic}
              alt="WhatsApp profile"
              className="h-14 w-14 rounded-full border border-border object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
              {initial !== "?" ? initial : <FontAwesomeIcon icon={faWhatsapp} className="h-6 w-6" />}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {wa.business_name || "WhatsApp Business"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {wa.display_phone || wa.phone_number_id || ""}
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">About</label>
          <textarea
            rows={2}
            maxLength={139}
            value={form.about}
            onChange={(e) => set("about", e.target.value)}
            className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">{form.about.length} / 139</p>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Description</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          />
        </div>
        <WbInput
          type="email"
          label="Email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
        />
        <WbInput
          label="Address"
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
        />
        <WbInput
          label="Website URL"
          value={form.website}
          onChange={(e) => set("website", e.target.value)}
        />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Business category</label>
          <select
            value={form.vertical}
            onChange={(e) => set("vertical", e.target.value)}
            className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {VERTICALS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes take effect within a few minutes on WhatsApp.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <WbButton onClick={save} loading={saving}>
            <FontAwesomeIcon icon={faSave} className="h-3.5 w-3.5" /> Save to WhatsApp
          </WbButton>
        </div>
      </WbCardBody>
    </WbCard>
  );
}
