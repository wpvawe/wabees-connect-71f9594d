import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WbButton } from "@/components/wb/WbButton";
import type { BusinessOption, WabaPhoneOption } from "@/lib/wabees/api";

export type PickedAccount = {
  business: { id: string; name: string };
  waba: { id: string; name: string };
  phone: WabaPhoneOption;
};

type Row = PickedAccount & { key: string };

/**
 * Multi-step Meta account picker. Flattens Business → WABA → Phone into
 * one radio list so a user with multiple numbers can pick which one to
 * finish connecting after Embedded Signup.
 */
export function AccountPickerDialog({
  open,
  onOpenChange,
  businesses,
  onPick,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businesses: BusinessOption[];
  onPick: (a: PickedAccount) => void;
  busy?: boolean;
}) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const b of businesses) {
      for (const w of b.wabas) {
        for (const p of w.phones) {
          out.push({
            key: `${b.id}:${w.id}:${p.id}`,
            business: { id: b.id, name: b.name },
            waba: { id: w.id, name: w.name },
            phone: p,
          });
        }
      }
    }
    return out;
  }, [businesses]);

  const [selected, setSelected] = useState<string>(rows[0]?.key ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select WhatsApp number to connect</DialogTitle>
          <DialogDescription>
            Aap ke Meta account me multiple numbers hain. Jis number ko is workspace se link karna
            hai, wo choose karein.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            No WhatsApp phone numbers found under the granted businesses.
          </p>
        ) : (
          <RadioGroup
            value={selected}
            onValueChange={setSelected}
            className="max-h-[420px] space-y-2 overflow-y-auto pr-1"
          >
            {rows.map((r) => (
              <label
                key={r.key}
                htmlFor={r.key}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  selected === r.key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <RadioGroupItem value={r.key} id={r.key} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {r.phone.display_phone_number || r.phone.id}
                    </span>
                    {r.phone.quality_rating ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          r.phone.quality_rating === "GREEN"
                            ? "bg-emerald-500/15 text-emerald-600"
                            : r.phone.quality_rating === "YELLOW"
                              ? "bg-amber-500/15 text-amber-600"
                              : r.phone.quality_rating === "RED"
                                ? "bg-rose-500/15 text-rose-600"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.phone.quality_rating}
                      </span>
                    ) : null}
                  </div>
                  {r.phone.verified_name ? (
                    <p className="mt-0.5 text-sm text-foreground/80">{r.phone.verified_name}</p>
                  ) : null}
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {r.business.name} · WABA {r.waba.name || r.waba.id}
                  </p>
                </div>
              </label>
            ))}
          </RadioGroup>
        )}

        <DialogFooter>
          <WbButton variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </WbButton>
          <WbButton
            onClick={() => {
              const row = rows.find((r) => r.key === selected);
              if (row) onPick(row);
            }}
            loading={busy}
            disabled={!selected || rows.length === 0}
          >
            Connect this number
          </WbButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}