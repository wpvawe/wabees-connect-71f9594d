import { useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileImport, faFileExport, faPlus } from "@fortawesome/free-solid-svg-icons";
import { WbButton } from "@/components/wb/WbButton";
import { bulkImportContacts, upsertContact } from "@/lib/firebase/contacts";
import { useContacts } from "@/hooks/useContacts";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

type CsvRow = { name?: string; phone?: string; email?: string; company?: string; tags?: string };

export function ImportExportBar() {
  const { data } = useContacts();
  const uid = useEffectiveUid();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uid) return;
    setBusy(true);
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const contacts = results.data
            .filter((r) => r.name && r.phone)
            .map((r) => ({
              name: String(r.name).trim(),
              phone: String(r.phone).trim(),
              email: r.email ? String(r.email).trim() : undefined,
              company: r.company ? String(r.company).trim() : undefined,
              tags: r.tags
                ? String(r.tags)
                    .split(/[,;]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            }));
          if (contacts.length === 0) {
            toast.error("CSV needs columns: name, phone (also email, company, tags)");
            return;
          }
          const res = await bulkImportContacts(uid, contacts);
          toast.success(`Imported ${res.imported} contacts`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Import failed");
        } finally {
          setBusy(false);
          if (fileRef.current) fileRef.current.value = "";
        }
      },
      error: () => {
        toast.error("Could not parse CSV");
        setBusy(false);
      },
    });
  }

  function onExport() {
    if (!data || data.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const csv = Papa.unparse(
      data.map((c) => ({
        name: c.name,
        phone: c.phone,
        email: c.email ?? "",
        company: c.company ?? "",
        tags: c.tags.join(","),
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wabees-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <WbButton size="sm" onClick={() => setShowAdd(true)}>
        <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
        Add contact
      </WbButton>
      <WbButton
        variant="secondary"
        size="sm"
        onClick={() => fileRef.current?.click()}
        loading={busy}
      >
        <FontAwesomeIcon icon={faFileImport} className="h-3.5 w-3.5" />
        Import CSV
      </WbButton>
      <WbButton variant="secondary" size="sm" onClick={onExport}>
        <FontAwesomeIcon icon={faFileExport} className="h-3.5 w-3.5" />
        Export CSV
      </WbButton>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        className="hidden"
      />
      {showAdd && (
        <QuickAdd
          onClose={() => setShowAdd(false)}
          onSave={(args) => upsertContact(uid!, args.data)}
        />
      )}
    </div>
  );
}

function QuickAdd({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (args: {
    data: { name: string; phone: string; tags: string[] };
  }) => Promise<{ id: string }>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !phone.trim()) return;
    setBusy(true);
    try {
      await onSave({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          tags: tags
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      toast.success("Contact added");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">Add contact</h3>
        <div className="mt-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+923001234567"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <WbButton variant="ghost" onClick={onClose}>
            Cancel
          </WbButton>
          <WbButton onClick={() => void save()} loading={busy}>
            Save
          </WbButton>
        </div>
      </div>
    </div>
  );
}
