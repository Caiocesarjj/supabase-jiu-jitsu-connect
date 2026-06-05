import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { slugify } from "@/lib/format";
import { getAdminClient, getUserClient } from "@/lib/supabase-server";

const staffRoles = new Set(["admin", "instructor", "instrutor", "staff"]);

const authSchema = z.object({ accessToken: z.string().min(10) });
const orgAuthSchema = authSchema.extend({ organizationId: z.string().uuid() });

function dueDateFromEnrollment(referenceMonth: string, enrollmentDate: string | null, fallbackDay: number) {
  const [yearRaw, monthRaw] = referenceMonth.split("-").map(Number);
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
  const month = Number.isFinite(monthRaw) ? monthRaw : new Date().getMonth() + 1;
  const sourceDate = enrollmentDate ? new Date(`${enrollmentDate}T00:00:00`) : null;
  const sourceDay = sourceDate && !Number.isNaN(sourceDate.getTime()) ? sourceDate.getDate() : fallbackDay;
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(sourceDay, 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeBrazilianPhone(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function formatMoneyBR(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function formatDateBRValue(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function renderWhatsappTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

async function sendBotBotMessage(settings: { botbot_app_key?: string | null; botbot_auth_key?: string | null }, phone: string, message: string) {
  if (!settings.botbot_app_key || !settings.botbot_auth_key) {
    throw new Error("Credenciais BotBot não configuradas em Configurações → WhatsApp.");
  }
  const response = await fetch("https://api.botbot.chat/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.botbot_auth_key}`,
      "X-App-Key": settings.botbot_app_key,
    },
    body: JSON.stringify({ phone, message, template: false }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`BotBot retornou ${response.status}${body ? `: ${body}` : ""}`);
  }
}

function asaasBaseUrl() {
  return (process.env.ASAAS_BASE_URL || "https://api.asaas.com/v3").replace(/\/$/, "");
}

async function asaasRequest<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${asaasBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.errors?.[0]?.description || payload?.message || "Erro na API do Asaas.";
    throw new Error(message);
  }
  return payload as T;
}

async function ensureAsaasCharge({
  apiKey,
  charge,
}: {
  apiKey: string;
  charge: {
    id: string;
    amount: number;
    due_date: string;
    students?: { profiles?: { full_name?: string; email?: string | null; phone?: string | null; cpf?: string | null } } | null;
  };
}) {
  const profile = charge.students?.profiles;
  const name = profile?.full_name || "Aluno JJ Manager";
  const phone = normalizeBrazilianPhone(profile?.phone);
  const existing = await asaasRequest<{ data?: Array<{ id: string; invoiceUrl?: string; bankSlipUrl?: string }> }>(
    apiKey,
    `/payments?externalReference=${encodeURIComponent(charge.id)}`,
    { method: "GET" },
  );
  let payment = existing.data?.[0];
  if (!payment) {
    const customer = await asaasRequest<{ id: string }>(apiKey, "/customers", {
      method: "POST",
      body: JSON.stringify({
        name,
        email: profile?.email || undefined,
        mobilePhone: phone || undefined,
        cpfCnpj: (profile?.cpf ?? "").replace(/\D/g, "") || undefined,
      }),
    });
    payment = await asaasRequest<{ id: string; invoiceUrl?: string; bankSlipUrl?: string }>(apiKey, "/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customer.id,
        billingType: "PIX",
        value: Number(charge.amount),
        dueDate: charge.due_date,
        description: `Mensalidade ${name}`,
        externalReference: charge.id,
      }),
    });
  }
  let pixCode: string | null = null;
  try {
    const pix = await asaasRequest<{ payload?: string; encodedImage?: string }>(
      apiKey,
      `/payments/${payment.id}/pixQrCode`,
      { method: "GET" },
    );
    pixCode = pix.payload ?? pix.encodedImage ?? null;
  } catch {
    pixCode = null;
  }
  return { invoiceUrl: payment.invoiceUrl ?? payment.bankSlipUrl ?? null, pixCode };
}

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
        subscriptionPlanId: z.string().uuid().nullable().optional(),
        validityDate: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const supabase = getAdminClient();
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

    if (data.subscriptionPlanId) {
      const { error: subError } = await supabase.from("subscription_records").insert({
        organization_id: data.organizationId,
        student_id: studentId,
        plan_id: data.subscriptionPlanId,
        status: "active",
        started_at: today,
        next_due_date: data.validityDate || today,
      });
      if (subError) throw subError;
    }

    return { studentId };
  });


export const deleteStudentRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const supabase = getAdminClient();

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
    const dependentDeletes = await Promise.all([
      supabase.from("attendance").delete().eq("student_id", studentId),
      supabase.from("financial_records").delete().eq("student_id", studentId),
      supabase.from("graduation_history").delete().eq("student_id", studentId),
      supabase.from("graduations").delete().eq("student_id", studentId),
      supabase.from("student_guardians").delete().eq("student_id", studentId),
      supabase.from("student_class_enrollments").delete().eq("student_id", studentId),
      supabase.from("subscription_records").delete().eq("student_id", studentId),
    ]);
    const dependentError = dependentDeletes.find((result) => result.error)?.error;
    if (dependentError) throw dependentError;

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
        `id, name, weekday, start_time, duration_min, active, instructor_id, instructors ( id, full_name )`,
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
      const rows: Array<typeof base & { weekday: number; instructor_id: string | null }> = [];
      for (const weekday of data.days) {
        for (const instructorId of instructorIds) {
          rows.push({ ...base, weekday, instructor_id: instructorId });
        }
      }
      const { error: insErr } = await supabase.from("class_schedules").insert(rows);
      if (insErr) throw insErr;
      return { count: rows.length };
    }

    const rows: Array<typeof base & { weekday: number; instructor_id: string | null }> = [];
    for (const weekday of data.days) {
      for (const instructorId of instructorIds) {
        rows.push({ ...base, weekday, instructor_id: instructorId });
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
    // Find all sibling schedule ids
    const { data: sibs, error: sibErr } = await supabase
      .from("class_schedules")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("name", original.name)
      .eq("start_time", original.start_time)
      .eq("duration_min", original.duration_min);
    if (sibErr) throw sibErr;
    const ids = (sibs ?? []).map((s: { id: string }) => s.id);
    if (ids.length === 0) return { ok: true };
    // Delete dependent rows first
    await supabase
      .from("attendance")
      .delete()
      .eq("organization_id", data.organizationId)
      .in("schedule_id", ids);
    await supabase
      .from("student_class_enrollments")
      .delete()
      .eq("organization_id", data.organizationId)
      .in("schedule_id", ids);
    const { error } = await supabase
      .from("class_schedules")
      .delete()
      .eq("organization_id", data.organizationId)
      .in("id", ids);
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
          .select(
            `id, monthly_fee, enrollment_date,
      subscription_records(status, plan_id, subscription_plans(amount, new_amount_after, validity_months))`,
          )
          .eq("organization_id", data.organizationId)
          .eq("status", "active")
          .is("deleted_at", null),
        supabase
          .from("organization_settings")
          .select("monthly_fee_default, due_day, payment_gateway, payment_gateway_api_key")
          .eq("organization_id", data.organizationId)
          .maybeSingle(),
      ]);
    if (studentsError) throw studentsError;
    if (settingsError) throw settingsError;

    const [year, month] = data.referenceMonth.split("-");
    const referenceMonth = `${year}-${month}-01`;
    const dueDay = Number(settings?.due_day ?? 10);
    const defaultFee = Number(settings?.monthly_fee_default ?? 0);
    const rows = ((students ?? []) as unknown as Array<{
      id: string;
      monthly_fee: number | null;
      enrollment_date: string | null;
      subscription_records?: Array<{
        status: string;
        subscription_plans:
          | { amount: number | null; new_amount_after: number | null; validity_months: number | null }
          | Array<{ amount: number | null; new_amount_after: number | null; validity_months: number | null }>
          | null;
      }>;
    }>).map((student) => {
      const activeSubscription = student.subscription_records?.find((sub) => sub.status === "active");
      const plan = Array.isArray(activeSubscription?.subscription_plans)
        ? activeSubscription?.subscription_plans[0]
        : activeSubscription?.subscription_plans;

      const planDueDay = plan?.validity_months ?? dueDay;
      const dueDate = dueDateFromEnrollment(data.referenceMonth, null, planDueDay);
      const isPastDue = dueDate < new Date().toISOString().slice(0, 10);
      const subscriptionAmount = isPastDue && plan?.new_amount_after != null ? plan.new_amount_after : plan?.amount;

      return {
        organization_id: data.organizationId,
        student_id: student.id,
        amount: subscriptionAmount ?? student.monthly_fee ?? defaultFee,
        due_date: dueDate,
        reference_month: referenceMonth,
        status: "pending",
        idempotency_key: `${student.id}_${referenceMonth}`,
      };
    });

    if (rows.length > 0) {
      const { error } = await supabase
        .from("financial_records")
        .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (error) throw error;

      if (settings?.payment_gateway === "asaas" && settings.payment_gateway_api_key) {
        const { data: charges, error: chargesError } = await supabase
          .from("financial_records")
          .select(
            "id, amount, due_date, students:student_id(profiles:profile_id(full_name, email, phone, cpf))",
          )
          .eq("organization_id", data.organizationId)
          .in("idempotency_key", rows.map((row) => row.idempotency_key));
        if (chargesError) throw chargesError;

        for (const charge of (charges ?? []) as unknown as Array<{
          id: string;
          amount: number;
          due_date: string;
          students?: { profiles?: { full_name?: string; email?: string | null; phone?: string | null; cpf?: string | null } } | null;
        }>) {
          const asaasCharge = await ensureAsaasCharge({
            apiKey: settings.payment_gateway_api_key,
            charge,
          });
          await supabase
            .from("financial_records")
            .update({ pix_code: asaasCharge.pixCode, invoice_url: asaasCharge.invoiceUrl })
            .eq("id", charge.id)
            .eq("organization_id", data.organizationId);
        }
      }
    }

    return { count: rows.length };
  });

export const getOrganizationConfig = createServerFn({ method: "POST" })
  .inputValidator((input) => authSchema.parse(input))
  .handler(async ({ data }) => {
    const { profile } = await requireStaff(data.accessToken);
    const admin = getAdminClient();
    const organizationId = profile.organization_id as string;
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, name, phone, email, logo_url, plan, trial_ends_at, public_code")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!org) throw new Error("Academia não encontrada.");

    const settingsRes = await admin
      .from("organization_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (settingsRes.error) throw settingsRes.error;
    let settings = settingsRes.data;

    if (!settings) {
      const { data: created, error: createError } = await admin
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
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
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
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
      .from("organization_settings")
      .upsert(
        {
          organization_id: data.organizationId,
          monthly_fee_default: data.monthlyFeeDefault,
          due_day: data.dueDay,
          pix_key_type: data.pixKeyType || null,
          pix_key: data.pixKey || null,
        },
        { onConflict: "organization_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const updateWhatsappConfig = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        whatsappNotifications: z.boolean(),
        botbotToken: z.string().nullable().optional(),
        botbotAppKey: z.string().nullable().optional(),
        botbotAuthKey: z.string().nullable().optional(),
        chargeReminderDays: z.array(z.number().int().min(-30).max(30)).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
      .from("organization_settings")
      .upsert(
        {
          organization_id: data.organizationId,
          whatsapp_notifications: data.whatsappNotifications,
          botbot_token: data.whatsappNotifications ? data.botbotToken || null : null,
          botbot_app_key: data.whatsappNotifications ? data.botbotAppKey || null : null,
          botbot_auth_key: data.whatsappNotifications ? data.botbotAuthKey || null : null,
          charge_reminder_days: data.whatsappNotifications ? data.chargeReminderDays : [],
        },
        { onConflict: "organization_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export async function runAutomaticWhatsappNotifications({
  organizationId,
  manual = false,
}: {
  organizationId?: string;
  manual?: boolean;
}) {
  const admin = getAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const settingsQuery = admin
    .from("organization_settings")
    .select("organization_id, whatsapp_notifications, botbot_app_key, botbot_auth_key, charge_reminder_days, whatsapp_templates");
  const { data: settingsRows, error: settingsErr } = organizationId
    ? await settingsQuery.eq("organization_id", organizationId)
    : await settingsQuery.eq("whatsapp_notifications", true);
  if (settingsErr) throw settingsErr;

  const enabledSettings = (settingsRows ?? []).filter(
    (row: any) => manual || (row.whatsapp_notifications && row.botbot_app_key && row.botbot_auth_key),
  );
  if (enabledSettings.length === 0) return { sent: 0, skipped: 0, total: 0 };

  const orgIds = enabledSettings.map((row: any) => row.organization_id as string);
  const { data: orgRows } = await admin.from("organizations").select("id, name").in("id", orgIds);
  const orgNames = new Map((orgRows ?? []).map((row: any) => [row.id, row.name ?? "Academia"]));

  let sent = 0;
  let skipped = 0;
  let total = 0;
  const errors: string[] = [];

  for (const settings of enabledSettings as Array<any>) {
    if (!settings.botbot_app_key || !settings.botbot_auth_key) {
      if (manual) throw new Error("Credenciais BotBot não configuradas em Configurações → WhatsApp.");
      continue;
    }

    const days = Array.isArray(settings.charge_reminder_days) ? settings.charge_reminder_days : [];
    if (!manual && days.length === 0) continue;

    const { data: charges, error: chargesErr } = await admin
      .from("financial_records")
      .select(
        `id, amount, due_date, status, invoice_url, pix_code, notifications_sent,
         students:student_id(
           profiles:profile_id(full_name, phone),
           subscription_records(status, subscription_plans(name, amount))
         )`,
      )
      .eq("organization_id", settings.organization_id)
      .in("status", ["pending", "overdue"]);
    if (chargesErr) throw chargesErr;

    for (const charge of (charges ?? []) as Array<any>) {
      const dueDate = String(charge.due_date ?? "").slice(0, 10);
      if (!dueDate) {
        skipped++;
        continue;
      }
      const daysFromDue = Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) / 86400000);
      if (!manual && !days.includes(daysFromDue)) continue;

      total++;
      const sentKey = `whatsapp_${daysFromDue}`;
      const sentLog = charge.notifications_sent && typeof charge.notifications_sent === "object" ? charge.notifications_sent : {};
      if (!manual && sentLog[sentKey]) {
        skipped++;
        continue;
      }

      const student = Array.isArray(charge.students) ? charge.students[0] : charge.students;
      const profile = Array.isArray(student?.profiles) ? student?.profiles[0] : student?.profiles;
      const phone = normalizeBrazilianPhone(profile?.phone);
      if (!phone) {
        skipped++;
        continue;
      }

      const activeSub = Array.isArray(student?.subscription_records)
        ? student.subscription_records.find((sub: any) => sub.status === "active")
        : null;
      const plan = Array.isArray(activeSub?.subscription_plans)
        ? activeSub.subscription_plans[0]
        : activeSub?.subscription_plans;
      const templates = { ...DEFAULT_WHATSAPP_TEMPLATES, ...((settings.whatsapp_templates ?? {}) as Record<string, string>) };
      const templateKey = daysFromDue > 0 || charge.status === "overdue" ? "overdue" : "due_soon";
      const message = renderWhatsappTemplate(templates[templateKey], {
        name: profile?.full_name ?? "Aluno",
        plan_name: plan?.name ?? "Mensalidade",
        plan_price: formatMoneyBR(charge.amount),
        expires_at: formatDateBRValue(dueDate),
        academy_name: orgNames.get(settings.organization_id) ?? "Academia",
        payment_link: charge.invoice_url || (charge.pix_code ? `PIX copia e cola: ${charge.pix_code}` : "Procure a secretaria"),
      });

      try {
        await sendBotBotMessage(settings, phone, message);
        sent++;
        await admin
          .from("financial_records")
          .update({ notifications_sent: { ...sentLog, [sentKey]: new Date().toISOString() } })
          .eq("id", charge.id);
      } catch (error) {
        skipped++;
        const msg = error instanceof Error ? error.message : "Erro desconhecido no BotBot";
        console.error("BotBot send failed:", msg);
        if (errors.length < 3) errors.push(msg);
      }
    }
  }

  return { sent, skipped, total, errors };
}

export const sendChargeNotifications = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    return runAutomaticWhatsappNotifications({ organizationId: data.organizationId, manual: true });
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
    if (error) throw error;
    return { ok: true };
  });

// ============================================================
// Subscription plans & records (admin-elevated after staff check)
// ============================================================

const frequencyEnum = z.enum(["monthly", "quarterly", "semiannual", "annual"]);
const subStatusEnum = z.enum(["active", "paused", "canceled", "expired"]);

export const upsertSubscriptionPlan = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        planId: z.string().uuid().nullable().optional(),
        name: z.string().trim().min(1).max(120),
        amount: z.number().min(0),
        frequency: frequencyEnum,
        description: z.string().trim().max(500).nullable().optional(),
        newAmountAfter: z.number().min(0).nullable().optional(),
        validityMonths: z.number().int().min(0).max(31).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const payload = {
      organization_id: data.organizationId,
      name: data.name,
      amount: data.amount,
      frequency: data.frequency,
      description: data.description ?? null,
      new_amount_after: data.newAmountAfter ?? null,
      validity_months: data.validityMonths ?? null,
    };
    if (data.planId) {
      const { error } = await admin
        .from("subscription_plans")
        .update(payload)
        .eq("id", data.planId)
        .eq("organization_id", data.organizationId);
      if (error) throw error;
      return { id: data.planId };
    }
    const { data: row, error } = await admin
      .from("subscription_plans")
      .insert({ ...payload, active: true })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id as string };
  });

export const toggleSubscriptionPlan = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ planId: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
      .from("subscription_plans")
      .update({ active: data.active })
      .eq("id", data.planId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteSubscriptionPlan = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ planId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    const { error: subscriptionsError } = await admin
      .from("subscription_records")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("plan_id", data.planId);
    if (subscriptionsError) throw subscriptionsError;

    const { error } = await admin
      .from("subscription_plans")
      .delete()
      .eq("id", data.planId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const createSubscriptionRecord = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        planId: z.string().uuid(),
        startedAt: z.string(),
        nextDueDate: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin.from("subscription_records").insert({
      organization_id: data.organizationId,
      student_id: data.studentId,
      plan_id: data.planId,
      status: "active",
      started_at: data.startedAt,
      next_due_date: data.nextDueDate,
    });
    if (error) throw error;
    return { ok: true };
  });

export const updateSubscriptionStatus = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({ subscriptionId: z.string().uuid(), status: subStatusEnum })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
      .from("subscription_records")
      .update({ status: data.status })
      .eq("id", data.subscriptionId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const updateIntegrationsConfig = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        paymentGateway: z.string().nullable().optional(),
        paymentGatewayApiKey: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
      .from("organization_settings")
      .upsert(
        {
          organization_id: data.organizationId,
          payment_gateway: data.paymentGateway || null,
          payment_gateway_api_key: data.paymentGatewayApiKey || null,
        },
        { onConflict: "organization_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const listSubscriptionPlansForOrg = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("subscription_plans")
      .select("id, name, amount, frequency, description, active, new_amount_after, validity_months")
      .eq("organization_id", data.organizationId)
      .order("amount");
    if (error) throw error;
    return { plans: rows ?? [] };
  });

export const listSubscriptionRecordsForOrg = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("subscription_records")
      .select(
        `id, status, started_at, next_due_date, notes, plan_id, student_id,
         subscription_plans ( name, amount, frequency ),
         students ( id, profiles ( full_name, phone ) )`,
      )
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { subscriptions: rows ?? [] };
  });

export const listStudentsForOrg = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("students")
      .select("id, enrollment_date, profiles ( full_name )")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { students: rows ?? [] };
  });


export const getStudentSubscription = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: row, error } = await admin
      .from("subscription_records")
      .select(
        "id, status, started_at, next_due_date, plan_id, subscription_plans(id, name, amount, frequency, description)",
      )
      .eq("student_id", data.studentId)
      .eq("organization_id", data.organizationId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return { subscription: row ?? null };
  });

const DEFAULT_WHATSAPP_TEMPLATES = {
  due_soon:
    "🥋 Olá, {name}!\n\nSua mensalidade está próxima do vencimento.\n\n📦 Plano: {plan_name}\n📅 Vencimento: {expires_at}\n💰 Valor: {plan_price}\n\nPara continuar treinando normalmente, realize sua renovação através do link abaixo:\n\n👉 {payment_link}\n\nApós o pagamento, envie o comprovante.\n\nOss!\nEquipe {academy_name}",
  overdue:
    "⚠️ Olá, {name}!\n\nIdentificamos que sua mensalidade encontra-se vencida.\n\n📦 Plano: {plan_name}\n📅 Vencimento: {expires_at}\n💰 Valor: {plan_price}\n\nRegularize sua situação para continuar participando dos treinos.\n\n👉 {payment_link}\n\nEm caso de dúvidas procure a secretaria.\n\nOss!\nEquipe {academy_name}",
  paid:
    "✅ Pagamento Confirmado!\n\nOlá, {name}!\n\nRecebemos sua renovação com sucesso.\n\n📦 Plano: {plan_name}\n📅 Próximo vencimento: {expires_at}\n💰 Valor pago: {plan_price}\n\nSua matrícula permanece ativa.\nContinue firme nos treinos e na evolução.\n\nOss!\nEquipe {academy_name}",
};

export const getWhatsappTemplates = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: row, error } = await admin
      .from("organization_settings")
      .select("whatsapp_templates")
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error) throw error;
    const stored = (row?.whatsapp_templates ?? {}) as Record<string, string>;
    return {
      templates: { ...DEFAULT_WHATSAPP_TEMPLATES, ...stored },
      defaults: DEFAULT_WHATSAPP_TEMPLATES,
    };
  });

export const updateWhatsappTemplates = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        templates: z.object({
          due_soon: z.string().max(2000),
          overdue: z.string().max(2000),
          paid: z.string().max(2000),
        }),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
      .from("organization_settings")
      .upsert(
        {
          organization_id: data.organizationId,
          whatsapp_templates: data.templates,
        },
        { onConflict: "organization_id" },
      );
    if (error) throw error;
    return { ok: true };
  });
