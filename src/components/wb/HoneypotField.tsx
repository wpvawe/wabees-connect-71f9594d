import { HONEYPOT_FIELD } from "@/lib/security/honeypot";

/** Visually hidden honeypot input. Bots fill it; humans don't see it. */
export function HoneypotField({
  register,
}: {
  register: (name: string) => Record<string, unknown>;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
    >
      <label>
        Company URL (leave empty)
        <input type="text" tabIndex={-1} autoComplete="off" {...register(HONEYPOT_FIELD)} />
      </label>
    </div>
  );
}
