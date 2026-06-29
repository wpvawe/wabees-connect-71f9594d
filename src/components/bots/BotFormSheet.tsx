import { useEffect, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { fbDb } from "@/integrations/firebase/client";
import type { Bot } from "@/hooks/useBots";
import { toast } from "sonner";

type FormState = {
  name: string;
  description: string;
  isActive: boolean;
  triggerType: string;
  triggerKeywords: string;
  caseSensitive: boolean;
  responseText: string;
  headerText: string;
  footerText: string;
  delaySeconds: number;
};

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    isActive: true,
    triggerType: "keyword",
    triggerKeywords: "",
    caseSensitive: false,
    responseText: "",
    headerText: "",
    footerText: "",
    delaySeconds: 0,
  };
}

export function BotFormSheet({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Bot | null;
}) {
  const uid = useEffectiveUid();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description,
        isActive: editing.isActive,
        triggerType: editing.triggerType,
        triggerKeywords: editing.triggerKeywords.join(", "),
        caseSensitive: editing.caseSensitive,
        responseText: editing.responseText,
        headerText: editing.headerText ?? "",
        footerText: editing.footerText ?? "",
        delaySeconds: editing.delaySeconds,
      });
    } else if (open) {
      setForm(emptyForm());
    }
  }, [editing, open]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!uid || !form.name.trim() || !form.responseText.trim()) {
      toast.error("Name and reply text required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        isActive: form.isActive,
        triggerType: form.triggerType,
        triggerKeywords: form.triggerKeywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        caseSensitive: form.caseSensitive,
        responseText: form.responseText,
        headerText: form.headerText || null,
        footerText: form.footerText || null,
        delaySeconds: Number(form.delaySeconds) || 0,
        quickReplies: [],
        ctaButton: null,
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(fbDb(), "users", uid, "bots", editing.id), payload);
        toast.success("Bot updated");
      } else {
        await addDoc(collection(fbDb(), "users", uid, "bots"), {
          ...payload,
          totalTriggered: 0,
          createdAt: serverTimestamp(),
        });
        toast.success("Bot created");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit bot" : "New bot"}</SheetTitle>
          <SheetDescription>
            Auto-reply rules sync with the mobile app in realtime.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <WbInput label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <WbInput
            label="Description"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">Active</span>
            <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Trigger type</label>
            <select
              value={form.triggerType}
              onChange={(e) => set("triggerType", e.target.value)}
              className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="keyword">Keyword</option>
              <option value="all_messages">All messages</option>
              <option value="first_message">First message</option>
              <option value="button_reply">Button reply</option>
            </select>
          </div>
          <WbInput
            label="Trigger keywords"
            hint="Comma-separated"
            value={form.triggerKeywords}
            onChange={(e) => set("triggerKeywords", e.target.value)}
          />
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">Case sensitive</span>
            <Switch checked={form.caseSensitive} onCheckedChange={(v) => set("caseSensitive", v)} />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Reply text</label>
            <textarea
              rows={4}
              value={form.responseText}
              onChange={(e) => set("responseText", e.target.value)}
              className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
          </div>
          <WbInput
            label="Header (optional)"
            value={form.headerText}
            onChange={(e) => set("headerText", e.target.value)}
          />
          <WbInput
            label="Footer (optional)"
            value={form.footerText}
            onChange={(e) => set("footerText", e.target.value)}
          />
          <WbInput
            type="number"
            label="Delay (seconds)"
            value={String(form.delaySeconds)}
            onChange={(e) => set("delaySeconds", Number(e.target.value) || 0)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <WbButton variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </WbButton>
            <WbButton onClick={save} loading={saving}>
              {editing ? "Update" : "Create"}
            </WbButton>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
