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

  const number = phone.replace(/\D/g, "");
  const url = "https://botbot.chat/api/v2/sendText";
  const body = {
    to: number,
    typingDelay: 1,
    message,
  };

  console.info("BotBot URL utilizada:", url);

  let response: Response;
  let raw = "";
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        appKey: settings.botbot_app_key,
        authKey: settings.botbot_auth_key,
      },
      body: JSON.stringify(body),
    });
    raw = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("BotBot erro de conexão:", reason);
    throw new Error(`Não foi possível conectar ao BotBot. Detalhe: ${reason}`);
  }

  console.info("BotBot Status HTTP:", response.status);
  console.info("BotBot Corpo retornado:", raw);

  if (!response.ok) {
    throw new Error(`BotBot retornou ${response.status}: ${raw.slice(0, 200)}`);
  }

  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* não-JSON: assume sucesso */ }
  if (data && (data.error || data.success === false || data.status === "error")) {
    throw new Error(`BotBot: ${data.error || data.message || "Erro ao enviar"}`);
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
        status: z.string().max(40).optional(),
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
        status: "inactive",
        birth_date: data.birthDate || null,
        sex: data.sex ?? null,
        weight: data.weightKg ?? null,
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
      const { data: settings } = await supabase
        .from("organization_settings")
        .select("due_day")
        .eq("organization_id", data.organizationId)
        .maybeSingle();
      const dueDay = Number(settings?.due_day ?? 10);
      const initialDueDate = dueDateFromEnrollment(today.slice(0, 7), null, dueDay);
      const { error: subError } = await supabase.from("subscription_records").insert({
        organization_id: data.organizationId,
        student_id: studentId,
        plan_id: data.subscriptionPlanId,
        status: "active",
        started_at: today,
        next_due_date: data.validityDate || initialDueDate,
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
            `id, enrollment_date,
      subscription_records(status, plan_id, subscription_plans(amount, new_amount_after, validity_months))`,
          )
          .eq("organization_id", data.organizationId)
          .is("deleted_at", null),
        supabase
          .from("organization_settings")
          .select("monthly_fee_default, due_day, payment_gateway, payment_gateway_api_key")
          .eq("organization_id", data.organizationId)
          .maybeSingle(),
      ]);
    if (studentsError) throw studentsError;
    if (settingsError) throw settingsError;

    const admin = getAdminClient();
    const paymentConfig = await getActivePaymentConfig(admin, data.organizationId);
    const staticPaymentUrl = getStaticPaymentUrl(paymentConfig);

    const [year, month] = data.referenceMonth.split("-");
    const referenceMonth = `${year}-${month}-01`;
    const dueDay = Number(settings?.due_day ?? 10);
    const defaultFee = Number(settings?.monthly_fee_default ?? 0);
    const rows = ((students ?? []) as unknown as Array<{
      id: string;
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
      if (!activeSubscription || !plan) return null;

      const [yRef, mRef] = data.referenceMonth.split("-").map(Number);
      const lastDay = new Date(yRef, mRef, 0).getDate();
      const normalDue = dueDateFromEnrollment(data.referenceMonth, null, dueDay);
      const todayStr = new Date().toISOString().slice(0, 10);
      const isPastDue = normalDue < todayStr;
      const hasAfter = plan?.new_amount_after != null;
      const dueDate = isPastDue && hasAfter
        ? `${yRef}-${String(mRef).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
        : normalDue;
      const subscriptionAmount = isPastDue && hasAfter ? plan!.new_amount_after : plan?.amount;

      return {
        organization_id: data.organizationId,
        student_id: student.id,
        amount: subscriptionAmount ?? defaultFee,
        due_date: dueDate,
        reference_month: referenceMonth,
        status: "pending",
        idempotency_key: `${student.id}_${referenceMonth}`,
      };
    }).filter((row): row is NonNullable<typeof row> => !!row && Number(row.amount) > 0);


    if (rows.length > 0) {
      const { error } = await supabase
        .from("financial_records")
        .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (error) throw error;

      if (staticPaymentUrl) {
        const { error: linkError } = await supabase
          .from("financial_records")
          .update({ invoice_url: staticPaymentUrl })
          .eq("organization_id", data.organizationId)
          .in("idempotency_key", rows.map((row) => row.idempotency_key))
          .is("invoice_url", null);
        if (linkError) throw linkError;
      }

      const asaasApiKey = paymentConfig.provider === "asaas" && typeof paymentConfig.credentials.apiKey === "string"
        ? paymentConfig.credentials.apiKey
        : settings?.payment_gateway === "asaas"
          ? settings.payment_gateway_api_key
          : null;
      if (asaasApiKey) {
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
            apiKey: asaasApiKey,
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
        notificationHours: z.array(z.number().int().min(0).max(23)).max(2).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: existing } = await admin
      .from("organization_settings")
      .select("whatsapp_templates")
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    const currentTemplates = (existing?.whatsapp_templates ?? {}) as Record<string, unknown>;
    const nextTemplates = { ...currentTemplates, __hours: data.notificationHours ?? [] };
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
          whatsapp_templates: nextTemplates,
        },
        { onConflict: "organization_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const sendTestWhatsappMessage = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        phone: z.string().trim().min(10).max(20),
        message: z.string().trim().min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: settings, error } = await admin
      .from("organization_settings")
      .select("botbot_app_key, botbot_auth_key")
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error) throw error;
    const digits = data.phone.replace(/\D/g, "");
    if (digits.length < 12 || digits.length > 15) {
      throw new Error("Número inválido. Use o formato internacional: 55 + DDD + número (ex: 5511999999999).");
    }
    await sendBotBotMessage(settings ?? {}, digits, data.message);
    return { ok: true, phone: digits };
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
    const paymentConfig = await getActivePaymentConfig(admin, settings.organization_id);
    const staticPaymentUrl = getStaticPaymentUrl(paymentConfig);

    const days = Array.isArray(settings.charge_reminder_days) ? settings.charge_reminder_days : [];
    if (!manual && days.length === 0) continue;

    // Respect notification hours window stored in whatsapp_templates.__hours
    if (!manual) {
      const tpls = (settings.whatsapp_templates ?? {}) as Record<string, unknown>;
      const hours = Array.isArray(tpls.__hours) ? (tpls.__hours as number[]) : [];
      if (hours.length > 0) {
        // Brazil timezone (UTC-3)
        const nowUtc = new Date();
        const brHour = (nowUtc.getUTCHours() - 3 + 24) % 24;
        if (!hours.includes(brHour)) continue;
      }
    }


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
        payment_link: charge.invoice_url || staticPaymentUrl || (charge.pix_code ? `PIX copia e cola: ${charge.pix_code}` : "Procure a secretaria"),
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

    // Always snap next_due_date to the org's configured due_day (default 10).
    const { data: settings } = await admin
      .from("organization_settings")
      .select("due_day")
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    const dueDay = Number(settings?.due_day ?? 10);
    const base = new Date(`${data.nextDueDate}T00:00:00`);
    const year = base.getFullYear();
    const month = base.getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(Math.max(dueDay, 1), lastDay);
    const normalizedDue = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const { error } = await admin.from("subscription_records").insert({
      organization_id: data.organizationId,
      student_id: data.studentId,
      plan_id: data.planId,
      status: "active",
      started_at: data.startedAt,
      next_due_date: normalizedDue,
    });
    if (error) throw error;

    const { error: studentError } = await admin
      .from("students")
      .update({ status: "inactive" })
      .eq("id", data.studentId)
      .eq("organization_id", data.organizationId)
      .neq("status", "active");
    if (studentError) throw studentError;

    return { ok: true };
  });

export const normalizeSubscriptionDueDates = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: settings } = await admin
      .from("organization_settings")
      .select("due_day")
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    const dueDay = Number(settings?.due_day ?? 10);
    const { data: subs } = await admin
      .from("subscription_records")
      .select("id, next_due_date")
      .eq("organization_id", data.organizationId);
    let updated = 0;
    for (const s of (subs ?? []) as Array<{ id: string; next_due_date: string | null }>) {
      if (!s.next_due_date) continue;
      const base = new Date(`${s.next_due_date.slice(0, 10)}T00:00:00`);
      if (Number.isNaN(base.getTime())) continue;
      const y = base.getFullYear();
      const m = base.getMonth() + 1;
      const last = new Date(y, m, 0).getDate();
      const d = Math.min(Math.max(dueDay, 1), last);
      const next = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (next === s.next_due_date.slice(0, 10)) continue;
      await admin
        .from("subscription_records")
        .update({ next_due_date: next })
        .eq("id", s.id)
        .eq("organization_id", data.organizationId);
      updated++;
    }
    return { updated };
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

// ============================================================
// Payment integrations (Fase 1)
// Multi-provider per-organization credentials + test-connection.
// ============================================================

const paymentProviderEnum = z.enum(["manual", "link", "asaas", "mercadopago", "pagseguro", "infinitepay"]);
type PaymentProvider = z.infer<typeof paymentProviderEnum>;

function isMissingPaymentIntegrationsTable(error: unknown) {
  const err = error as { code?: string; message?: string } | null | undefined;
  const message = err?.message ?? "";
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    /payment_integrations/i.test(message) && /schema cache|does not exist|could not find/i.test(message)
  );
}

function legacyCredentials(provider: PaymentProvider, value: string | null | undefined) {
  const credential = value ?? "";
  if (provider === "asaas") {
    return {
      apiKey: credential,
      environment: credential.includes("prod") ? "production" : "sandbox",
    };
  }
  if (provider === "mercadopago") return { accessToken: credential };
  if (provider === "pagseguro") return { token: credential };
  if (provider === "infinitepay") return { baseUrl: credential };
  if (provider === "link") return { paymentUrl: credential };
  return {};
}

function legacyCredentialValue(provider: PaymentProvider, credentials: Record<string, unknown>) {
  const pick = (...keys: string[]) => keys.map((key) => credentials[key]).find((value) => typeof value === "string") as string | undefined;
  if (provider === "asaas") return pick("apiKey");
  if (provider === "mercadopago") return pick("accessToken", "publicKey");
  if (provider === "pagseguro") return pick("token", "email");
  if (provider === "infinitepay") return pick("baseUrl");
  if (provider === "link") return pick("paymentUrl");
  return null;
}

async function getActivePaymentConfig(admin: ReturnType<typeof getAdminClient>, organizationId: string) {
  const { data: activeIntegration, error: integrationError } = await admin
    .from("payment_integrations")
    .select("provider, credentials_json")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .maybeSingle();

  if (integrationError && !isMissingPaymentIntegrationsTable(integrationError)) throw integrationError;

  const parsedProvider = paymentProviderEnum.safeParse(activeIntegration?.provider);
  if (parsedProvider.success) {
    return {
      provider: parsedProvider.data,
      credentials: (activeIntegration?.credentials_json ?? {}) as Record<string, unknown>,
    };
  }

  const { data: settings, error: settingsError } = await admin
    .from("organization_settings")
    .select("payment_gateway, payment_gateway_api_key")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (settingsError) throw settingsError;

  const legacyProvider = paymentProviderEnum.safeParse(settings?.payment_gateway);
  if (!legacyProvider.success) return { provider: "manual" as const, credentials: {} };
  return {
    provider: legacyProvider.data,
    credentials: legacyCredentials(legacyProvider.data, settings?.payment_gateway_api_key),
  };
}

function getStaticPaymentUrl(config: { provider: PaymentProvider | "manual"; credentials: Record<string, unknown> }) {
  const key = config.provider === "link" ? "paymentUrl" : config.provider === "infinitepay" ? "baseUrl" : null;
  if (!key) return null;
  const value = config.credentials[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function listLegacyPaymentIntegration(admin: ReturnType<typeof getAdminClient>, organizationId: string) {
  const { data: settings, error } = await admin
    .from("organization_settings")
    .select("payment_gateway, payment_gateway_api_key")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  const provider = paymentProviderEnum.safeParse(settings?.payment_gateway).success
    ? (settings?.payment_gateway as PaymentProvider)
    : null;
  if (!provider) return [];
  return [{
    id: `legacy-${provider}`,
    provider,
    credentials_json: legacyCredentials(provider, settings?.payment_gateway_api_key),
    active: true,
    updated_at: new Date().toISOString(),
  }];
}

export const listPaymentIntegrations = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("payment_integrations")
      .select("id, provider, credentials_json, active, updated_at")
      .eq("organization_id", data.organizationId);
    if (isMissingPaymentIntegrationsTable(error)) {
      console.warn("payment_integrations indisponível no schema cache; usando organization_settings como compatibilidade.");
      return { integrations: await listLegacyPaymentIntegration(admin, data.organizationId) };
    }
    if (error) throw error;
    return { integrations: rows ?? [] };
  });

export const savePaymentIntegration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        provider: paymentProviderEnum,
        credentials: z.record(z.string(), z.any()),
        setActive: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    if (data.setActive) {
      const { error: deactErr } = await admin
        .from("payment_integrations")
        .update({ active: false })
        .eq("organization_id", data.organizationId);
      if (isMissingPaymentIntegrationsTable(deactErr)) {
        console.warn("payment_integrations indisponível no schema cache; salvando em organization_settings como compatibilidade.");
        const { error: legacyError } = await admin
          .from("organization_settings")
          .upsert(
            {
              organization_id: data.organizationId,
              payment_gateway: data.provider,
              payment_gateway_api_key: legacyCredentialValue(data.provider, data.credentials) || null,
            },
            { onConflict: "organization_id" },
          );
        if (legacyError) throw legacyError;
        return { ok: true };
      }
      if (deactErr) throw deactErr;
    }

    // Upsert this provider's credentials
    const { error: upErr } = await admin
      .from("payment_integrations")
      .upsert(
        {
          organization_id: data.organizationId,
          provider: data.provider,
          credentials_json: data.credentials,
          active: data.setActive ?? false,
        },
        { onConflict: "organization_id,provider" },
      );
    if (isMissingPaymentIntegrationsTable(upErr)) {
      console.warn("payment_integrations indisponível no schema cache; salvando em organization_settings como compatibilidade.");
      const { error: legacyError } = await admin
        .from("organization_settings")
        .upsert(
          {
            organization_id: data.organizationId,
            payment_gateway: data.provider,
            payment_gateway_api_key: legacyCredentialValue(data.provider, data.credentials) || null,
          },
          { onConflict: "organization_id" },
        );
      if (legacyError) throw legacyError;
      return { ok: true };
    }
    if (upErr) throw upErr;
    return { ok: true };
  });

export const setActivePaymentIntegration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ provider: paymentProviderEnum }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    // Deactivate all
    const { error: deactErr } = await admin
      .from("payment_integrations")
      .update({ active: false })
      .eq("organization_id", data.organizationId);
    if (isMissingPaymentIntegrationsTable(deactErr)) {
      console.warn("payment_integrations indisponível no schema cache; ativando em organization_settings como compatibilidade.");
      const { error: legacyError } = await admin
        .from("organization_settings")
        .update({ payment_gateway: data.provider })
        .eq("organization_id", data.organizationId);
      if (legacyError) throw legacyError;
      return { ok: true };
    }
    if (deactErr) throw deactErr;

    // Activate chosen one
    const { error: actErr } = await admin
      .from("payment_integrations")
      .update({ active: true })
      .eq("organization_id", data.organizationId)
      .eq("provider", data.provider);
    if (actErr) throw actErr;

    return { ok: true };
  });

export const testPaymentIntegration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        provider: paymentProviderEnum,
        credentials: z.record(z.string(), z.any()),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);

    const c = data.credentials as Record<string, string | undefined>;

    try {
      if (data.provider === "asaas") {
        const apiKey = (c.apiKey ?? "").trim();
        const env = (c.environment ?? "sandbox").trim();
        if (!apiKey) throw new Error("API Key obrigatória.");
        const base = env === "production"
          ? "https://www.asaas.com/api/v3"
          : "https://sandbox.asaas.com/api/v3";
        const res = await fetch(`${base}/myAccount`, {
          method: "GET",
          headers: { access_token: apiKey, "Content-Type": "application/json" },
        });
        const raw = await res.text();
        console.info("Asaas test", { status: res.status, raw: raw.slice(0, 200) });
        if (!res.ok) throw new Error(`Asaas ${res.status}: ${raw.slice(0, 160)}`);
        return { ok: true, provider: "asaas", info: "Conexão Asaas OK." };
      }

      if (data.provider === "mercadopago") {
        const token = (c.accessToken ?? "").trim();
        if (!token) throw new Error("Access Token obrigatório.");
        const res = await fetch("https://api.mercadopago.com/users/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const raw = await res.text();
        console.info("MP test", { status: res.status, raw: raw.slice(0, 200) });
        if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${raw.slice(0, 160)}`);
        return { ok: true, provider: "mercadopago", info: "Conexão Mercado Pago OK." };
      }

      if (data.provider === "pagseguro") {
        const token = (c.token ?? "").trim();
        if (!token) throw new Error("Token obrigatório.");
        const res = await fetch("https://api.pagseguro.com/public-keys", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "card" }),
        });
        const raw = await res.text();
        console.info("PagSeguro test", { status: res.status, raw: raw.slice(0, 200) });
        if (res.status === 401 || res.status === 403) {
          throw new Error(`PagSeguro: token inválido (${res.status}).`);
        }
        return { ok: true, provider: "pagseguro", info: "Token PagSeguro válido." };
      }

      if (data.provider === "infinitepay") {
        const url = (c.baseUrl ?? "").trim();
        if (!url) throw new Error("Link Base obrigatório.");
        try {
          new URL(url);
        } catch {
          throw new Error("URL inválida.");
        }
        return { ok: true, provider: "infinitepay", info: "Link de cobrança válido." };
      }

      if (data.provider === "link" || data.provider === "manual") {
        const url = (c.paymentUrl ?? "").trim();
        if (data.provider === "link") {
          if (!url) throw new Error("URL de pagamento obrigatória.");
          try {
            new URL(url);
          } catch {
            throw new Error("URL inválida.");
          }
        }
        return { ok: true, provider: data.provider, info: "Configuração válida." };
      }

      throw new Error("Provedor não suportado.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha no teste.";
      console.error("testPaymentIntegration failed", { provider: data.provider, msg });
      throw new Error(msg);
    }
  });

// ============================================================
// Cobrança individual via WhatsApp (manual, pela ficha do aluno)
// ============================================================

export const getStudentChargeForWhatsapp = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    const { data: student, error: studentErr } = await admin
      .from("students")
      .select(
        `id,
         profiles:profile_id(full_name, email, phone, cpf),
         subscription_records(status, subscription_plans(name, amount))`,
      )
      .eq("id", data.studentId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (studentErr) throw studentErr;
    if (!student) throw new Error("Aluno não encontrado.");

    const profile = Array.isArray(student.profiles) ? student.profiles[0] : student.profiles;
    const phone = normalizeBrazilianPhone(profile?.phone);
    if (!phone) {
      return { hasPhone: false, hasCharge: false } as const;
    }

    const { data: charges, error: chargesErr } = await admin
      .from("financial_records")
      .select("id, amount, due_date, status, invoice_url, pix_code, reference_month")
      .eq("organization_id", data.organizationId)
      .eq("student_id", data.studentId)
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true })
      .limit(1);
    if (chargesErr) throw chargesErr;

    const charge = charges?.[0];
    if (!charge) {
      return { hasPhone: true, hasCharge: false, phone } as const;
    }

    const activeSub = Array.isArray(student.subscription_records)
      ? student.subscription_records.find((s: any) => s.status === "active")
      : null;
    const plan = activeSub
      ? Array.isArray(activeSub.subscription_plans)
        ? activeSub.subscription_plans[0]
        : activeSub.subscription_plans
      : null;

    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", data.organizationId)
      .maybeSingle();

    const academyName = org?.name ?? "Academia";
    const studentName = profile?.full_name ?? "Aluno";
    const planName = plan?.name ?? "Mensalidade";
    const amountStr = formatMoneyBR(charge.amount);
    const dueStr = formatDateBRValue(charge.due_date);
    const paymentConfig = await getActivePaymentConfig(admin, data.organizationId);
    let paymentUrl = charge.invoice_url || getStaticPaymentUrl(paymentConfig) || "";
    if (!paymentUrl && paymentConfig.provider === "asaas" && typeof paymentConfig.credentials.apiKey === "string") {
      const asaasCharge = await ensureAsaasCharge({
        apiKey: paymentConfig.credentials.apiKey,
        charge: {
          id: charge.id as string,
          amount: Number(charge.amount ?? 0),
          due_date: String(charge.due_date ?? "").slice(0, 10),
          students: { profiles: profile as any },
        },
      });
      paymentUrl = asaasCharge.invoiceUrl || "";
      await admin
        .from("financial_records")
        .update({ pix_code: asaasCharge.pixCode, invoice_url: asaasCharge.invoiceUrl })
        .eq("id", charge.id)
        .eq("organization_id", data.organizationId);
      charge.invoice_url = asaasCharge.invoiceUrl;
      charge.pix_code = asaasCharge.pixCode;
    }

    const message =
      `🥋 Olá ${studentName}!\n\n` +
      `Sua mensalidade está disponível.\n\n` +
      `📦 Plano: ${planName}\n` +
      `💰 Valor: ${amountStr}\n` +
      `📅 Vencimento: ${dueStr}\n\n` +
      `Para realizar o pagamento utilize o link abaixo:\n` +
      `🔗 ${paymentUrl || (charge.pix_code ? `PIX copia e cola: ${charge.pix_code}` : "Procure a secretaria")}\n\n` +
      `Após o pagamento sua situação será atualizada automaticamente.\n\n` +
      `Oss!\n` +
      `Equipe ${academyName}`;

    return {
      hasPhone: true,
      hasCharge: true,
      phone,
      studentName,
      planName,
      amount: Number(charge.amount ?? 0),
      amountFormatted: amountStr,
      dueDate: String(charge.due_date ?? "").slice(0, 10),
      dueDateFormatted: dueStr,
      paymentUrl,
      financialRecordId: charge.id as string,
      message,
    } as const;
  });

export const sendIndividualWhatsappCharge = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        financialRecordId: z.string().uuid(),
        phone: z.string().min(8).max(30),
        message: z.string().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    const { data: settings, error: settingsErr } = await admin
      .from("organization_settings")
      .select("botbot_app_key, botbot_auth_key")
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (settingsErr) throw settingsErr;
    if (!settings?.botbot_app_key || !settings?.botbot_auth_key) {
      throw new Error("Credenciais BotBot não configuradas em Configurações → WhatsApp.");
    }

    const phone = normalizeBrazilianPhone(data.phone) ?? data.phone.replace(/\D/g, "");

    let status: "sent" | "failed" = "sent";
    let providerResponse = "OK";
    try {
      await sendBotBotMessage(settings, phone, data.message);
    } catch (err) {
      status = "failed";
      providerResponse = err instanceof Error ? err.message : String(err);
    }

    await admin.from("whatsapp_message_logs").insert({
      organization_id: data.organizationId,
      student_id: data.studentId,
      financial_record_id: data.financialRecordId,
      phone,
      message: data.message,
      status,
      provider_response: providerResponse,
    });

    if (status === "failed") throw new Error(providerResponse);
    return { ok: true, status, phone };
  });

export const listWhatsappMessageLogs = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("whatsapp_message_logs")
      .select("id, phone, message, status, provider_response, created_at")
      .eq("organization_id", data.organizationId)
      .eq("student_id", data.studentId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return { logs: rows ?? [] };
  });

// ============================================================
// Geração de cobrança individual para um aluno
// ============================================================

export const generateChargeForStudent = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        referenceMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    const now = new Date();
    const referenceMonth =
      data.referenceMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const referenceMonthDate = `${referenceMonth}-01`;

    const [{ data: student, error: studentError }, { data: settings, error: settingsError }] =
      await Promise.all([
        admin
          .from("students")
          .select(
            `id, monthly_fee, enrollment_date,
             profiles:profile_id(full_name, email, phone, cpf),
             subscription_records(status, plan_id, subscription_plans(amount, new_amount_after, validity_months))`,
          )
          .eq("id", data.studentId)
          .eq("organization_id", data.organizationId)
          .maybeSingle(),
        admin
          .from("organization_settings")
          .select("monthly_fee_default, due_day, payment_gateway, payment_gateway_api_key")
          .eq("organization_id", data.organizationId)
          .maybeSingle(),
      ]);
    if (studentError) throw studentError;
    if (settingsError) throw settingsError;
    if (!student) throw new Error("Aluno não encontrado.");

    const dueDay = Number(settings?.due_day ?? 10);
    const defaultFee = Number(settings?.monthly_fee_default ?? 0);
    const paymentConfig = await getActivePaymentConfig(admin, data.organizationId);
    const staticPaymentUrl = getStaticPaymentUrl(paymentConfig);

    const activeSubscription = (student as any).subscription_records?.find(
      (sub: any) => sub.status === "active",
    );
    const plan = Array.isArray(activeSubscription?.subscription_plans)
      ? activeSubscription?.subscription_plans[0]
      : activeSubscription?.subscription_plans;

    const [yearRef, monthRef] = referenceMonth.split("-").map(Number);
    const lastDayOfMonth = new Date(yearRef, monthRef, 0).getDate();
    const normalDueDate = dueDateFromEnrollment(referenceMonth, null, dueDay);
    const todayISOStr = new Date().toISOString().slice(0, 10);
    const isPastDue = normalDueDate < todayISOStr;
    const hasAfterPrice = plan?.new_amount_after != null;
    const dueDate = isPastDue && hasAfterPrice
      ? `${yearRef}-${String(monthRef).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`
      : normalDueDate;
    const amount =
      (isPastDue && hasAfterPrice ? plan!.new_amount_after : plan?.amount) ??
      (student as any).monthly_fee ??
      defaultFee;

    if (!amount || Number(amount) <= 0) {
      throw new Error("Aluno sem plano/valor configurado. Defina o plano ou a mensalidade antes de gerar.");
    }


    const idempotencyKey = `${data.studentId}_${referenceMonthDate}`;
    const { error: upsertError } = await admin.from("financial_records").upsert(
      [
        {
          organization_id: data.organizationId,
          student_id: data.studentId,
          amount,
          due_date: dueDate,
          reference_month: referenceMonthDate,
          status: "pending",
          idempotency_key: idempotencyKey,
        },
      ],
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
    if (upsertError) throw upsertError;

    const { data: charge, error: chargeError } = await admin
      .from("financial_records")
      .select(
        "id, amount, due_date, invoice_url, pix_code, students:student_id(profiles:profile_id(full_name, email, phone, cpf))",
      )
      .eq("organization_id", data.organizationId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (chargeError) throw chargeError;
    if (!charge) throw new Error("Cobrança não encontrada após criação.");

    if (staticPaymentUrl && !charge.invoice_url) {
      const { error: linkError } = await admin
        .from("financial_records")
        .update({ invoice_url: staticPaymentUrl })
        .eq("id", charge.id)
        .eq("organization_id", data.organizationId);
      if (linkError) throw linkError;
      charge.invoice_url = staticPaymentUrl;
    }

    const asaasApiKey = paymentConfig.provider === "asaas" && typeof paymentConfig.credentials.apiKey === "string"
      ? paymentConfig.credentials.apiKey
      : settings?.payment_gateway === "asaas"
        ? settings.payment_gateway_api_key
        : null;
    if (asaasApiKey && !charge.invoice_url) {
      try {
        const asaasCharge = await ensureAsaasCharge({
          apiKey: asaasApiKey,
          charge: charge as any,
        });
        await admin
          .from("financial_records")
          .update({ pix_code: asaasCharge.pixCode, invoice_url: asaasCharge.invoiceUrl })
          .eq("id", charge.id)
          .eq("organization_id", data.organizationId);
      } catch (err) {
        console.error("Falha ao gerar cobrança Asaas individual:", err);
        throw new Error(
          `Cobrança criada, mas falha ao gerar no Asaas: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { ok: true, financialRecordId: charge.id as string };
  });

export const updateStudentBasics = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        profileId: z.string().uuid().nullable().optional(),
        fullName: z.string().trim().min(1).max(200),
        cpf: z.string().trim().max(20).nullable().optional(),
        phone: z.string().trim().max(30).nullable().optional(),
        email: z.string().trim().max(200).nullable().optional(),
        birthDate: z.string().nullable().optional(),
        sex: z.enum(["M", "F"]).nullable().optional(),
        weight: z.number().nullable().optional(),
        enrollmentDate: z.string().nullable().optional(),
        status: z.string().min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    if (data.profileId) {
      const { error: pe } = await admin
        .from("profiles")
        .update({
          full_name: data.fullName,
          cpf: data.cpf || null,
          phone: data.phone || null,
          email: data.email || null,
        })
        .eq("id", data.profileId);
      if (pe) throw new Error(pe.message);
    }

    const { error: se } = await admin
      .from("students")
      .update({
        birth_date: data.birthDate || null,
        sex: data.sex || null,
        weight: data.weight ?? null,
        enrollment_date: data.enrollmentDate || null,
        status: data.status,
      })
      .eq("id", data.studentId)
      .eq("organization_id", data.organizationId);
    if (se) throw new Error(se.message);

    return { ok: true };
  });
