import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const staffRoles = new Set(["admin", "instructor", "instrutor", "staff"]);
const orgAuthSchema = z.object({
  accessToken: z.string().min(10),
  organizationId: z.string().uuid(),
});

function getAdminClient() {
  const url = process.env.APP_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase do servidor não configurado");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function requireStaff(accessToken: string, organizationId: string) {
  const supabase = getAdminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) throw new Error("Sessão inválida. Faça login novamente.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error("Perfil não encontrado.");
  if (profile.organization_id !== organizationId)
    throw new Error("Sem acesso a esta organização.");
  if (!staffRoles.has(String(profile.role))) throw new Error("Sem permissão.");
  return { supabase, user: authData.user };
}

const pastBeltSchema = z.object({
  belt: z.string().min(2).max(40),
  degrees: z.number().int().min(0).max(10),
  startedAt: z.string().min(10).max(10),
  endedAt: z.string().min(10).max(10).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const createInstructor = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        fullName: z.string().trim().min(2).max(160),
        belt: z.string().min(2).max(40),
        degrees: z.number().int().min(0).max(10),
        phone: z.string().trim().max(30).optional().nullable(),
        email: z.string().trim().max(255).optional().nullable(),
        notes: z.string().max(2000).optional().nullable(),
        pastBelts: z.array(pastBeltSchema).max(30).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { data: ins, error } = await supabase
      .from("instructors")
      .insert({
        organization_id: data.organizationId,
        full_name: data.fullName,
        belt: data.belt,
        degrees: data.degrees,
        phone: data.phone || null,
        email: data.email || null,
        notes: data.notes || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    if (data.pastBelts && data.pastBelts.length > 0) {
      const rows = data.pastBelts.map((b) => ({
        organization_id: data.organizationId,
        instructor_id: ins.id as string,
        belt: b.belt,
        degrees: b.degrees,
        started_at: b.startedAt,
        ended_at: b.endedAt || null,
        notes: b.notes || null,
      }));
      const { error: hErr } = await supabase.from("instructor_belt_history").insert(rows);
      if (hErr) throw hErr;
    }
    return { instructorId: ins.id as string };
  });

export const updateInstructor = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        instructorId: z.string().uuid(),
        fullName: z.string().trim().min(2).max(160),
        belt: z.string().min(2).max(40),
        degrees: z.number().int().min(0).max(10),
        phone: z.string().trim().max(30).optional().nullable(),
        email: z.string().trim().max(255).optional().nullable(),
        notes: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("instructors")
      .update({
        full_name: data.fullName,
        belt: data.belt,
        degrees: data.degrees,
        phone: data.phone || null,
        email: data.email || null,
        notes: data.notes || null,
      })
      .eq("id", data.instructorId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteInstructor = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ instructorId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    await supabase
      .from("instructor_belt_history")
      .delete()
      .eq("instructor_id", data.instructorId)
      .eq("organization_id", data.organizationId);
    const { error } = await supabase
      .from("instructors")
      .delete()
      .eq("id", data.instructorId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const addInstructorPastBelt = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({ instructorId: z.string().uuid() })
      .merge(pastBeltSchema)
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase.from("instructor_belt_history").insert({
      organization_id: data.organizationId,
      instructor_id: data.instructorId,
      belt: data.belt,
      degrees: data.degrees,
      started_at: data.startedAt,
      ended_at: data.endedAt || null,
      notes: data.notes || null,
    });
    if (error) throw error;
    return { ok: true };
  });

export const deleteInstructorPastBelt = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ historyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("instructor_belt_history")
      .delete()
      .eq("id", data.historyId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });
