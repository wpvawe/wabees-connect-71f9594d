import { useState, useMemo } from "react";
import { format } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faTrash, faMagnifyingGlass, faAddressBook } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { useContacts } from "@/hooks/useContacts";
import { deleteContact } from "@/lib/firebase/contacts";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { WbEmpty } from "@/components/wb/WbEmpty";

export function ContactsTable() {
  const { data, error } = useContacts();
  const uid = useEffectiveUid();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!data) return data;
    if (!q.trim()) return data;
    const n = q.toLowerCase();
    return data.filter(
      (c) => c.name.toLowerCase().includes(n) || c.phone.includes(n) || c.tags.some((t) => t.toLowerCase().includes(n)),
    );
  }, [data, q]);

  async function remove(id: string, name: string) {
    if (!uid) return;
    if (!confirm(`Delete ${name}?`)) return;
    try {
      await deleteContact(uid, id);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="relative">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, phone, or tag"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
        </div>
      </div>
      {error ? (
        <p className="p-4 text-sm text-destructive">{error}</p>
      ) : filtered === null ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-6">
          <WbEmpty
            icon={faAddressBook}
            title={q ? "No matches" : "No contacts yet"}
            description={q ? undefined : "Add a contact or import a CSV to get started."}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Tags</th>
                <th className="px-4 py-2">Added</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-border/60 hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium text-foreground">{c.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {c.createdAt ? format(new Date(c.createdAt), "MMM d, yyyy") : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(c.id, c.name)}
                      className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete contact"
                    >
                      <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}