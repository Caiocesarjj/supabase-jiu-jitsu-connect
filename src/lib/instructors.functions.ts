import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getUserClient } from "@/lib/supabase-server";

const staffRoles = new Set(["admin", "instructor", "instrutor", "staff"]);

const orgAuthSchema = z.object({
  accessToken: z.string().min(10),
  organizationId: z.string().uuid(),
});

async function requireStaff(accessToken: string, organizationId?: string) {
  const supabase = getUserClient(accessToken);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sessão inválida. Faça login novamente.");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, full_name, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) throw new Error("Perfil não encontrado para este usuário.");
  if (organizationId && profile.organization_id !== organizationId) {
    throw new Error("Você não tem acesso a esta organização.");
  }
  if (!staffRoles.has(String(profile.role))) {
    throw new Error("Sem permissão para realizar este cadastro.");
  }

  return { supabase, user: authData.user, profile };
}

const pastBeltSchema = z.object({
  belt: z.string().min(2).max(40),
  degrees: z.number().int().min(0).max(10),
  startedAt: z.string().min(10).max(10),
  endedAt: z.string().min(10).max(10).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const detailsSchema = {
  fullName: z.string().trim().min(2).max(160),
  belt: z.string().min(2).max(40),
  degrees: z.number().int().min(0).max(10),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  photoUrl: z.string().trim().max(500).optional().nullable(),
  birthDate: z.string().min(10).max(10).optional().nullable(),
  gender: z.string().max(40).optional().nullable(),
  experienceYears: z.number().int().min(0).max(80).optional().nullable(),
  certifications: z.array(z.string().min(1).max(60)).max(20).optional(),
  specialties: z.array(z.string().min(1).max(60)).max(30).optional(),
  contractType: z.string().max(40).optional().nullable(),
  paymentModel: z.string().max(40).optional().nullable(),
  hourlyRate: z.number().min(0).max(100000).optional().nullable(),
  monthlySalary: z.number().min(0).max(1000000).optional().nullable(),
  availability: z.array(z.string().min(1).max(40)).max(50).optional(),
  active: z.boolean().optional(),
};

function toRow(data: z.infer<z.ZodObject<typeof detailsSchema>>) {
  return {
    full_name: data.fullName,
    belt: data.belt,
    degrees: data.degrees,
    phone: data.phone || null,
    email: data.email || null,
    notes: data.notes || null,
    photo_url: data.photoUrl || null,
    birth_date: data.birthDate || null,
    gender: data.gender || null,
    experience_years: data.experienceYears ?? null,
    certifications: data.certifications ?? [],
    specialties: data.specialties ?? [],
    contract_type: data.contractType || null,
    payment_model: data.paymentModel || null,
    hourly_rate: data.hourlyRate ?? null,
    monthly_salary: data.monthlySalary ?? null,
    availability: data.availability ?? [],
    active: data.active ?? true,
  };
}

function toBasicRow(data: z.infer<z.ZodObject<typeof detailsSchema>>) {
  return {
    full_name: data.fullName,
    belt: data.belt,
    degrees: data.degrees,
    phone: data.phone || null,
    email: data.email || null,
    notes: data.notes || null,
  };
}

function isMissingColumnError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : String(error);
  return message.includes("Could not find") || message.includes("column") || message.includes("schema cache");
}

export const createInstructor = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({ ...detailsSchema, pastBelts: z.array(pastBeltSchema).max(30).optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const row = { organization_id: data.organizationId, ...toRow(data) };
    let insertRes = await supabase
      .from("instructors")
      .insert(row)
      .select("id")
      .single();
    if (insertRes.error && isMissingColumnError(insertRes.error)) {
      insertRes = await supabase
        .from("instructors")
        .insert({ organization_id: data.organizationId, ...toBasicRow(data) })
        .select("id")
        .single();
    }
    const { data: ins, error } = insertRes;
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
      .extend({ instructorId: z.string().uuid(), ...detailsSchema })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    let updateRes = await supabase
      .from("instructors")
      .update(toRow(data))
      .eq("id", data.instructorId)
      .eq("organization_id", data.organizationId);
    if (updateRes.error && isMissingColumnError(updateRes.error)) {
      updateRes = await supabase
        .from("instructors")
        .update(toBasicRow(data))
        .eq("id", data.instructorId)
        .eq("organization_id", data.organizationId);
    }
    const { error } = updateRes;
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
