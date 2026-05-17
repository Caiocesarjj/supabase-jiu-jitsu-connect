import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { slugify } from "@/lib/format";

const staffRoles = new Set(["admin", "instructor", "instrutor", "staff"]);

const authSchema = z.object({ accessToken: z.string().min(10) });
const orgAuthSchema = authSchema.extend({ organizationId: z.string().uuid() });

function getAdminClient() {
  const url = process.env.APP_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase do servidor não configurado");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function requireStaff(accessToken: string, organizationId?: string) {
  const supabase = getAdminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
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
    authSchema.extend({
      userId: z.string().uuid(),
      academyName: z.string().trim().min(2).max(120),
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(255),
      phone: z.string().trim().max(30).optional(),
    }).parse(input),
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
    orgAuthSchema.extend({
      fullName: z.string().trim().min(2).max(160),
      cpf: z.string().trim().max(30).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().email().max(255).optional().or(z.literal("")),
      birthDate: z.string().optional(),
      monthlyFee: z.number().nullable().optional(),
      status: z.enum(["active", "trial", "inactive"]),
      belt: z.string().min(2).max(40),
      degrees: z.number().int().min(0).max(10),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const studentId = crypto.randomUUID();
    const today = new Date().toISOString().split("T")[0];

    const { error: profileError } = await supabase.from("profiles").insert({
      id: studentId,
      organization_id: data.organizationId,
      full_name: data.fullName,
      email: data.email || null,
      phone: data.phone || null,
      cpf: data.cpf || null,
      role: "aluno",
    });
    if (profileError) throw profileError;

    const { error: studentError } = await supabase.from("students").insert({
      id: studentId,
      organization_id: data.organizationId,
      status: data.status,
      birth_date: data.birthDate || null,
      monthly_fee: data.monthlyFee ?? null,
      enrollment_date: today,
    });
    if (studentError) throw studentError;

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

export const saveClassSchedules = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(2).max(120),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      startTime: z.string().min(4).max(8),
      durationMin: z.number().int().min(15).max(240),
      instructorId: z.string().uuid().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const base = {
      organization_id: data.organizationId,
      name: data.name,
      start_time: data.startTime,
      duration_min: data.durationMin,
      instructor_id: data.instructorId ?? null,
      active: true,
    };

    if (data.id) {
      const { error } = await supabase
        .from("class_schedules")
        .update({ ...base, weekday: data.days[0] })
        .eq("id", data.id)
        .eq("organization_id", data.organizationId);
      if (error) throw error;
      return { count: 1 };
    }

    const rows = data.days.map((weekday) => ({ ...base, weekday }));
    const { error } = await supabase.from("class_schedules").insert(rows);
    if (error) throw error;
    return { count: rows.length };
  });

export const deactivateClassSchedule = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("class_schedules")
      .update({ active: false })
      .eq("id", data.id)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const saveAttendanceRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({
      scheduleId: z.string().uuid(),
      classDate: z.string().min(10).max(10),
      records: z.array(z.object({ studentId: z.string().uuid(), present: z.boolean() })).min(1),
    }).parse(input),
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
  .inputValidator((input) => orgAuthSchema.extend({ referenceMonth: z.string().regex(/^\d{4}-\d{2}$/) }).parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, data.organizationId);
    const [{ data: students, error: studentsError }, { data: settings, error: settingsError }] = await Promise.all([
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
    const rows = ((students ?? []) as Array<{ id: string; monthly_fee: number | null }>).map((student) => ({
      organization_id: data.organizationId,
      student_id: student.id,
      amount: student.monthly_fee ?? defaultFee,
      due_date: dueDate,
      reference_month: referenceMonth,
      status: "pending",
      idempotency_key: `${student.id}_${referenceMonth}`,
    }));

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
      .select("id, name, phone, email, logo_url, plan, trial_ends_at")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!org) throw new Error("Academia não encontrada.");

    let { data: settings, error: settingsError } = await supabase
      .from("organization_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (settingsError) throw settingsError;

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
    orgAuthSchema.extend({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().max(30).nullable().optional(),
      email: z.string().trim().email().max(255),
    }).parse(input),
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
    orgAuthSchema.extend({
      monthlyFeeDefault: z.number().min(0),
      dueDay: z.number().int().min(1).max(28),
      pixKeyType: z.string().nullable().optional(),
      pixKey: z.string().nullable().optional(),
    }).parse(input),
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
    orgAuthSchema.extend({
      whatsappNotifications: z.boolean(),
      botbotToken: z.string().nullable().optional(),
      chargeReminderDays: z.array(z.number().int().min(-30).max(30)).max(10),
    }).parse(input),
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