import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Wabees" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      setEmail(u.user?.email ?? "");
      if (u.user) {
        const { data: p } = await supabase.from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
        setName(p?.display_name ?? "");
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", u.user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  return (
    <>
      <TopBar title="Settings" subtitle="Your account & profile" />
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6">
        <WbCard>
          <WbCardHeader title="Profile" />
          <WbCardBody className="space-y-4">
            <WbInput label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
            <WbInput label="Email" value={email} disabled />
            <div className="flex justify-end">
              <WbButton onClick={save} loading={saving}>Save changes</WbButton>
            </div>
          </WbCardBody>
        </WbCard>
        <WbCard>
          <WbCardHeader title="Session" />
          <WbCardBody>
            <WbButton variant="danger" onClick={signOut}>Sign out</WbButton>
          </WbCardBody>
        </WbCard>
      </div>
    </>
  );
}