import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faDownload, faSave } from "@fortawesome/free-solid-svg-icons";
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function load() {
    if (!wa?.phone_number_id) return;
    setLoading(true);
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
      toast.success("Loaded from WhatsApp");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!wa?.phone_number_id) return;
    setSaving(true);
    try {
      const idToken = await fbAuth().currentUser!.getIdToken();
      const res = await fetch(`${WABEES_API_BASE}/business-profile.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          phone_number_id: wa.phone_number_id,
          id_token: idToken,
          about: form.about,
          description: form.description,
          email: form.email,
          address: form.address,
          websites: form.website ? [form.website] : [],
          vertical: form.vertical,
        }),
      });
      const raw = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || raw.error)
        throw new Error(typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`);
      toast.success("Saved to WhatsApp");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!wa) return null;

  return (
    <WbCard>
      <WbCardHeader
        title="WhatsApp Business Profile"
        subtitle="This info is visible to customers on WhatsApp."
      />
      <WbCardBody className="space-y-3">
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
          <WbButton variant="secondary" onClick={load} loading={loading}>
            <FontAwesomeIcon
              icon={loading ? faCircleNotch : faDownload}
              className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
            />{" "}
            Load from WhatsApp
          </WbButton>
          <WbButton onClick={save} loading={saving}>
            <FontAwesomeIcon icon={faSave} className="h-3.5 w-3.5" /> Save to WhatsApp
          </WbButton>
        </div>
      </WbCardBody>
    </WbCard>
  );
}
