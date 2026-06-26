import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safeError } from "@/lib/security/safe-error";

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  phone: z.string().min(8).max(20),
  email: z.string().email().max(160).optional().or(z.literal("")),
  company: z.string().max(160).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
  tags: z.array(z.string().max(40)).max(20).default([]),
  group: z.string().max(40).optional().or(z.literal("")),
});

export const upsertContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles").select("firebase_uid").eq("id", context.userId).maybeSingle();
      if (!profile?.firebase_uid) throw new Error("Not configured: no firebase_uid");
      const { firestoreCreateDoc, firestoreSetDoc } = await import(
        "@/integrations/firebase/admin.server"
      );
      const digits = data.phone.replace(/[^0-9]/g, "");
      const phone = `+${digits}`;
      const payload = {
        name: data.name,
        phone,
        email: data.email || null,
        company: data.company || null,
        notes: data.notes || null,
        tags: data.tags,
        group: data.group || null,
        createdAt: new Date(),
      };
      if (data.id) {
        await firestoreSetDoc(`users/${profile.firebase_uid}/contacts/${data.id}`, payload);
        return { id: data.id };
      }
      const id = await firestoreCreateDoc(`users/${profile.firebase_uid}/contacts`, payload);
      return { id };
    } catch (err) {
      throw safeError(err, "Could not save contact");
    }
  });

const idSchema = z.object({ id: z.string().min(1) });

export const deleteContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles").select("firebase_uid").eq("id", context.userId).maybeSingle();
      if (!profile?.firebase_uid) throw new Error("Not configured: no firebase_uid");
      const { firestoreDeleteDoc } = await import("@/integrations/firebase/admin.server");
      await firestoreDeleteDoc(`users/${profile.firebase_uid}/contacts/${data.id}`);
      return { ok: true as const };
    } catch (err) {
      throw safeError(err, "Could not delete contact");
    }
  });

const bulkSchema = z.object({
  contacts: z.array(z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(8).max(20),
    email: z.string().max(160).optional(),
    company: z.string().max(160).optional(),
    tags: z.array(z.string().max(40)).max(20).default([]),
  })).min(1).max(2000),
});

export const bulkImportContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bulkSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
      await assertRateLimit("contacts:import", context.userId, 5, 600);

      const { data: profile } = await context.supabase
        .from("profiles").select("firebase_uid").eq("id", context.userId).maybeSingle();
      if (!profile?.firebase_uid) throw new Error("Not configured: no firebase_uid");
      const { firestoreCreateDoc } = await import("@/integrations/firebase/admin.server");
      let imported = 0;
      for (const c of data.contacts) {
        const digits = c.phone.replace(/[^0-9]/g, "");
        if (digits.length < 8) continue;
        await firestoreCreateDoc(`users/${profile.firebase_uid}/contacts`, {
          name: c.name,
          phone: `+${digits}`,
          email: c.email || null,
          company: c.company || null,
          tags: c.tags,
          createdAt: new Date(),
        });
        imported += 1;
      }
      return { ok: true as const, imported };
    } catch (err) {
      throw safeError(err, "Could not import contacts");
    }
  });