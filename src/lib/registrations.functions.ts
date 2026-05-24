import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { slugify } from "@/lib/format";
import { getAdminClient, getUserClient } from "@/lib/supabase-server";

const staffRoles = new Set(["admin", "instructor", "instrutor", "staff"]);

const authSchema = z.object({ accessToken: z.string().min(10) });
const orgAuthSchema = authSchema.extend({ organizationId: z.string().uuid() });

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

export const createAcademyRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    authSchema
      .extend({
        userId: z.string().uuid(),
        academyName: z.string().trim().min(2).max(120),
        fullName: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().max(30).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = getAdminClient();
    const { data: authData, error: authError } = await supabase.auth.getUser(data.accessToken);
    if (authError || !authData.user || authData.user.id !== data.userId) {
      throw new Error("Sessão inválida. Faça login novamente.");
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .maybeSingle();
    if (existingProfile) throw new Error("Este usuário já está vinculado a uma academia.");

    const organizationId = crypto.randomUUID();
    const slug = `${slugify(data.academyName)}-${Date.now().toString(36)}`;

    const { error: orgError } = await supabase.from("organizations").insert({
      id: organizationId,
      name: data.academyName,
      slug,
      email: data.email,
      phone: data.phone || null,
    });
    if (orgError) throw orgError;

    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.userId,
      organization_id: organizationId,
      full_name: data.fullName,
      email: data.email,
      phone: data.phone || null,
      role: "admin",
    });
    if (profileError) throw profileError;

    const { error: settingsError } = await supabase.from("organization_settings").insert({
      organization_id: organizationId,
      monthly_fee_default: 200,
      due_day: 10,
      whatsapp_notifications: false,
      botbot_token: null,
      charge_reminder_days: [],
    });
    if (settingsError) throw settingsError;

    return { organizationId };
  });

export const createStudentRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        fullName: z.string().trim().min(2).max(160),
        cpf: z.string().trim().max(30).optional(),
        phone: z.string().trim().max(30).optional(),
        email: z.string().trim().email().max(255).optional().or(z.literal("")),
        birthDate: z.string().optional(),
        sex: z.enum(["M", "F"]).nullable().optional(),
        weightKg: z.number().positive().max(500).nullable().optional(),
        monthlyFee: z.number().nullable().optional(),
        status: z.enum(["active", "trial", "inactive"]),
        belt: z.string().min(2).max(40),
        degrees: z.number().int().min(0).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const today = new Date().toISOString().split("T")[0];

    const profileId = crypto.randomUUID();

    const { error: profileError } = await supabase.from("profiles").insert({
      id: profileId,
      organization_id: data.organizationId,
      full_name: data.fullName,
      email: data.email || null,
      phone: data.phone || null,
      cpf: data.cpf || null,
      role: "aluno",
    });
    if (profileError) throw profileError;

    const { data: studentRow, error: studentError } = await supabase
      .from("students")
      .insert({
        profile_id: profileId,
        organization_id: data.organizationId,
        status: data.status,
        birth_date: data.birthDate || null,
        sex: data.sex ?? null,
        weight: data.weightKg ?? null,
        monthly_fee: data.monthlyFee ?? null,
        enrollment_date: today,
      })
      .select("id")
      .single();
    if (studentError) throw studentError;

    const studentId = studentRow.id as string;

    const { error: graduationError } = await supabase.from("graduations").insert({
      organization_id: data.organizationId,
      student_id: studentId,
      belt: data.belt,
      degrees: data.degrees,
      promotion_date: today,
      classes_since_promotion: 0,
    });
    if (graduationError) throw graduationError;

    return { studentId };
  });

export const deleteStudentRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);

    const { data: studentRow, error: fetchError } = await supabase
      .from("students")
      .select("id, profile_id")
      .eq("id", data.studentId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!studentRow) throw new Error("Aluno não encontrado.");

    const studentId = studentRow.id as string;
    const profileId = studentRow.profile_id as string | null;

    // Remove dependent rows first (in case FKs do not cascade)
    await supabase.from("attendance").delete().eq("student_id", studentId);
    await supabase.from("financial_records").delete().eq("student_id", studentId);
    await supabase.from("graduation_history").delete().eq("student_id", studentId);
    await supabase.from("graduations").delete().eq("student_id", studentId);
    await supabase.from("student_guardians").delete().eq("student_id", studentId);

    const { error: studentError } = await supabase
      .from("students")
      .delete()
      .eq("id", studentId)
      .eq("organization_id", data.organizationId);
    if (studentError) throw studentError;

    if (profileId) {
      await supabase.from("profiles").delete().eq("id", profileId).eq("role", "aluno");
    }

    return { ok: true };
  });

export const promoteStudent = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        graduationId: z.string().uuid(),
        newBelt: z.string().min(2).max(40),
        newDegrees: z.number().int().min(0).max(10),
        promotionDate: z.string().min(10).max(10),
        minimumNextPromotionDate: z.string().min(10).max(10).nullable(),
        oldBelt: z.string().min(2).max(40),
        oldDegrees: z.number().int().min(0).max(10),
        notes: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase, user } = await requireStaff(data.accessToken, data.organizationId);

    const { error: e1 } = await supabase
      .from("graduations")
      .update({
        belt: data.newBelt,
        degrees: data.newDegrees,
        promotion_date: data.promotionDate,
        minimum_next_promotion_date: data.minimumNextPromotionDate,
        classes_since_promotion: 0,
      })
      .eq("id", data.graduationId)
      .eq("organization_id", data.organizationId);
    if (e1) throw e1;

    const { error: e2 } = await supabase.from("graduation_history").insert({
      organization_id: data.organizationId,
      student_id: data.studentId,
      old_belt: data.oldBelt,
      new_belt: data.newBelt,
      old_degrees: data.oldDegrees,
      new_degrees: data.newDegrees,
      promotion_date: data.promotionDate,
      notes: data.notes || null,
      created_by: user.id,
    });
    if (e2) throw e2;

    return { ok: true };
  });

export const updateStudentGraduation = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        graduationId: z.string().uuid(),
        belt: z.string().min(2).max(40),
        degrees: z.number().int().min(0).max(10),
        promotionDate: z.string().min(10).max(10),
        minimumNextPromotionDate: z.string().min(10).max(10).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("graduations")
      .update({
        belt: data.belt,
        degrees: data.degrees,
        promotion_date: data.promotionDate,
        minimum_next_promotion_date: data.minimumNextPromotionDate,
      })
      .eq("id", data.graduationId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const addPastGraduation = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        oldBelt: z.string().min(2).max(40).nullable(),
        oldDegrees: z.number().int().min(0).max(10).nullable(),
        newBelt: z.string().min(2).max(40),
        newDegrees: z.number().int().min(0).max(10),
        promotionDate: z.string().min(10).max(10),
        previousInstructor: z.string().max(160).optional().nullable(),
        previousTeam: z.string().max(160).optional().nullable(),
        notes: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase, user } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase.from("graduation_history").insert({
      organization_id: data.organizationId,
      student_id: data.studentId,
      old_belt: data.oldBelt,
      new_belt: data.newBelt,
      old_degrees: data.oldDegrees ?? 0,
      new_degrees: data.newDegrees,
      promotion_date: data.promotionDate,
      previous_instructor: data.previousInstructor || null,
      previous_team: data.previousTeam || null,
      notes: data.notes || null,
      created_by: user.id,
    });
    if (error) throw error;
    return { ok: true };
  });

export const deleteGraduationHistoryEntry = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ historyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("graduation_history")
      .delete()
      .eq("id", data.historyId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const listClassSchedules = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { data: rows, error } = await supabase
      .from("class_schedules")
      .select(
        `id, name, weekday, start_time, duration_min, active, instructor_record_id, instructors ( id, full_name )`,
      )
      .eq("organization_id", data.organizationId)
      .eq("active", true)
      .order("weekday")
      .order("start_time");
    if (error) throw error;
    return { schedules: rows ?? [] };
  });

export const listInstructors = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { data: rows, error } = await supabase
      .from("instructors")
      .select("id, full_name")
      .eq("organization_id", data.organizationId)
      .order("full_name");
    if (error) throw error;
    return { instructors: rows ?? [] };
  });

export const saveClassSchedules = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(2).max(120),
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        startTime: z.string().min(4).max(8),
        durationMin: z.number().int().min(15).max(240),
        instructorIds: z.array(z.string().uuid()).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const instructorIds =
      data.instructorIds && data.instructorIds.length > 0 ? data.instructorIds : [null];

    const base = {
      organization_id: data.organizationId,
      name: data.name,
      start_time: data.startTime,
      duration_min: data.durationMin,
      active: true,
    };

    if (data.id) {
      // Fetch the original row to identify the "group" (same name + start_time + duration_min)
      const { data: original, error: fetchErr } = await supabase
        .from("class_schedules")
        .select("name, start_time, duration_min")
        .eq("id", data.id)
        .eq("organization_id", data.organizationId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!original) throw new Error("Turma não encontrada.");

      // Deactivate every sibling row in the same group so the edit fully replaces it
      const { error: deactErr } = await supabase
        .from("class_schedules")
        .update({ active: false })
        .eq("organization_id", data.organizationId)
        .eq("name", original.name)
        .eq("start_time", original.start_time)
        .eq("duration_min", original.duration_min)
        .eq("active", true);
      if (deactErr) throw deactErr;

      // Re-insert one active row per (day × instructor) using the new values
      const rows: Array<typeof base & { weekday: number; instructor_record_id: string | null }> = [];
      for (const weekday of data.days) {
        for (const instructorId of instructorIds) {
          rows.push({ ...base, weekday, instructor_record_id: instructorId });
        }
      }
      const { error: insErr } = await supabase.from("class_schedules").insert(rows);
      if (insErr) throw insErr;
      return { count: rows.length };
    }

    const rows: Array<typeof base & { weekday: number; instructor_record_id: string | null }> = [];
    for (const weekday of data.days) {
      for (const instructorId of instructorIds) {
        rows.push({ ...base, weekday, instructor_record_id: instructorId });
      }
    }
    const { error } = await supabase.from("class_schedules").insert(rows);
    if (error) throw error;
    return { count: rows.length };
  });

export const deactivateClassSchedule = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    // Fetch the row to know its group (name + start_time + duration_min)
    const { data: original, error: fetchErr } = await supabase
      .from("class_schedules")
      .select("name, start_time, duration_min")
      .eq("id", data.id)
      .eq("organization_id", data.organizationId)
      .single();
    if (fetchErr) throw fetchErr;
    // Deactivate the whole sibling group
    const { error } = await supabase
      .from("class_schedules")
      .update({ active: false })
      .eq("organization_id", data.organizationId)
      .eq("name", original.name)
      .eq("start_time", original.start_time)
      .eq("duration_min", original.duration_min)
      .eq("active", true);
    if (error) throw error;
    return { ok: true };
  });

export const saveAttendanceRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        scheduleId: z.string().uuid(),
        classDate: z.string().min(10).max(10),
        records: z.array(z.object({ studentId: z.string().uuid(), present: z.boolean() })).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase, user } = await requireStaff(data.accessToken, data.organizationId);
    const rows = data.records.map((record) => ({
      organization_id: data.organizationId,
      student_id: record.studentId,
      schedule_id: data.scheduleId,
      class_date: data.classDate,
      present: record.present,
      checked_in_by: user.id,
    }));
    const { error } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "student_id,class_date,schedule_id", ignoreDuplicates: false });
    if (error) throw error;
    return { count: rows.length };
  });

export const generateMonthlyCharges = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ referenceMonth: z.string().regex(/^\d{4}-\d{2}$/) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const [{ data: students, error: studentsError }, { data: settings, error: settingsError }] =
      await Promise.all([
        supabase
          .from("students")
          .select("id, monthly_fee")
          .eq("organization_id", data.organizationId)
          .eq("status", "active")
          .is("deleted_at", null),
        supabase
          .from("organization_settings")
          .select("monthly_fee_default, due_day")
          .eq("organization_id", data.organizationId)
          .maybeSingle(),
      ]);
    if (studentsError) throw studentsError;
    if (settingsError) throw settingsError;

    const [year, month] = data.referenceMonth.split("-");
    const referenceMonth = `${year}-${month}-01`;
    const dueDay = String(settings?.due_day ?? 10).padStart(2, "0");
    const dueDate = `${year}-${month}-${dueDay}`;
    const defaultFee = Number(settings?.monthly_fee_default ?? 0);
    const rows = ((students ?? []) as Array<{ id: string; monthly_fee: number | null }>).map(
      (student) => ({
        organization_id: data.organizationId,
        student_id: student.id,
        amount: student.monthly_fee ?? defaultFee,
        due_date: dueDate,
        reference_month: referenceMonth,
        status: "pending",
        idempotency_key: `${student.id}_${referenceMonth}`,
      }),
    );

    if (rows.length > 0) {
      const { error } = await supabase
        .from("financial_records")
        .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (error) throw error;
    }

    return { count: rows.length };
  });

export const getOrganizationConfig = createServerFn({ method: "POST" })
  .inputValidator((input) => authSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabase, profile } = await requireStaff(data.accessToken);
    const organizationId = profile.organization_id as string;
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, name, phone, email, logo_url, plan, trial_ends_at, public_code")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!org) throw new Error("Academia não encontrada.");

    const settingsRes = await supabase
      .from("organization_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (settingsRes.error) throw settingsRes.error;
    let settings = settingsRes.data;

    if (!settings) {
      const { data: created, error: createError } = await supabase
        .from("organization_settings")
        .insert({
          organization_id: organizationId,
          monthly_fee_default: 200,
          due_day: 10,
          whatsapp_notifications: false,
          botbot_token: null,
          charge_reminder_days: [],
        })
        .select("*")
        .single();
      if (createError) throw createError;
      settings = created;
    }

    return { org, settings };
  });

export const updateAcademyConfig = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().max(30).nullable().optional(),
        email: z.string().trim().email().max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("organizations")
      .update({ name: data.name, phone: data.phone || null, email: data.email })
      .eq("id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const updateFinancialConfig = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        monthlyFeeDefault: z.number().min(0),
        dueDay: z.number().int().min(1).max(28),
        pixKeyType: z.string().nullable().optional(),
        pixKey: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase.from("organization_settings").upsert({
      organization_id: data.organizationId,
      monthly_fee_default: data.monthlyFeeDefault,
      due_day: data.dueDay,
      pix_key_type: data.pixKeyType || null,
      pix_key: data.pixKey || null,
    });
    if (error) throw error;
    return { ok: true };
  });

export const updateWhatsappConfig = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        whatsappNotifications: z.boolean(),
        botbotToken: z.string().nullable().optional(),
        chargeReminderDays: z.array(z.number().int().min(-30).max(30)).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase.from("organization_settings").upsert({
      organization_id: data.organizationId,
      whatsapp_notifications: data.whatsappNotifications,
      botbot_token: data.whatsappNotifications ? data.botbotToken || null : null,
      charge_reminder_days: data.whatsappNotifications ? data.chargeReminderDays : [],
    });
    if (error) throw error;
    return { ok: true };
  });

// ============================================================
// Student × Class enrollments
// ============================================================

async function getGroupSiblings(
  supabase: ReturnType<typeof getAdminClient>,
  organizationId: string,
  scheduleId: string,
) {
  const { data: ref, error: refErr } = await supabase
    .from("class_schedules")
    .select("name, start_time, duration_min")
    .eq("id", scheduleId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (refErr) throw refErr;
  if (!ref) throw new Error("Turma não encontrada.");
  const { data: sibs, error: sibErr } = await supabase
    .from("class_schedules")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", ref.name)
    .eq("start_time", ref.start_time)
    .eq("duration_min", ref.duration_min)
    .eq("active", true);
  if (sibErr) throw sibErr;
  return { ref, siblingIds: (sibs ?? []).map((s) => s.id) };
}

export const listStudentEnrollments = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { data: rows, error } = await supabase
      .from("student_class_enrollments")
      .select(
        "id, schedule_id, class_schedules!inner(id, name, weekday, start_time, duration_min, active, organization_id)",
      )
      .eq("organization_id", data.organizationId)
      .eq("student_id", data.studentId);
    if (error) throw error;
    return { enrollments: rows ?? [] };
  });

export const listClassEnrollments = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ scheduleId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { siblingIds } = await getGroupSiblings(
      supabase,
      data.organizationId,
      data.scheduleId,
    );
    if (siblingIds.length === 0) return { students: [] };
    const { data: rows, error } = await supabase
      .from("student_class_enrollments")
      .select("student_id, students!inner(id, status, profiles ( full_name ))")
      .eq("organization_id", data.organizationId)
      .in("schedule_id", siblingIds);
    if (error) throw error;
    const seen = new Set<string>();
    const students: Array<{ id: string; full_name: string; status?: string }> = [];
    for (const r of rows ?? []) {
      const s: any = (r as any).students;
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        students.push({
          id: s.id,
          full_name: s.profiles?.full_name ?? "Sem nome",
          status: s.status,
        });
      }
    }
    return { students };
  });

export const listOrgStudents = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { data: rows, error } = await supabase
      .from("students")
      .select("id, status, profiles ( full_name )")
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    const students = ((rows ?? []) as any[])
      .map((r) => ({
        id: r.id as string,
        full_name: (r.profiles?.full_name as string) ?? "Sem nome",
        status: r.status as string | undefined,
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    return { students };
  });

export const enrollStudentInClass = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({ studentId: z.string().uuid(), scheduleId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { siblingIds } = await getGroupSiblings(
      supabase,
      data.organizationId,
      data.scheduleId,
    );
    if (siblingIds.length === 0) throw new Error("Turma sem horários ativos.");
    const rows = siblingIds.map((sid) => ({
      organization_id: data.organizationId,
      student_id: data.studentId,
      schedule_id: sid,
    }));
    const { error } = await supabase
      .from("student_class_enrollments")
      .upsert(rows, { onConflict: "student_id,schedule_id", ignoreDuplicates: true });
    if (error) throw error;
    return { count: rows.length };
  });

export const unenrollStudentFromClass = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({ studentId: z.string().uuid(), scheduleId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { siblingIds } = await getGroupSiblings(
      supabase,
      data.organizationId,
      data.scheduleId,
    );
    if (siblingIds.length === 0) return { ok: true };
    const { error } = await supabase
      .from("student_class_enrollments")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("student_id", data.studentId)
      .in("schedule_id", siblingIds);
    if (error) throw error;
    return { ok: true };
  });
