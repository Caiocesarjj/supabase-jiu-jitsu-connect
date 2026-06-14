import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAdminClient, getUserClient } from "@/lib/supabase-server";
import { getProvider } from "@/lib/access/providers";
import type { DeviceConfig, StudentSyncPayload } from "@/lib/access/providers/types";

const staffRoles = new Set(["admin", "instructor", "instrutor", "staff"]);

const orgAuthSchema = z.object({
  accessToken: z.string().min(10),
  organizationId: z.string().uuid(),
});

const accessMethodSchema = z.enum([
  "manual",
  "code",
  "pin",
  "qr",
  "rfid",
  "biometric",
  "face",
  "gate",
]);

async function requireStaff(accessToken: string, organizationId: string) {
  const supabase = getUserClient(accessToken);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sessão inválida. Faça login novamente.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, role, full_name")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (!profile) throw new Error("Perfil não encontrado.");
  if (profile.organization_id !== organizationId)
    throw new Error("Você não tem acesso a esta organização.");
  if (!staffRoles.has(String(profile.role)))
    throw new Error("Sem permissão para esta ação.");
  return { supabase, user: authData.user, profile };
}

// --------- geração de credenciais ---------
function randomDigits(n: number) {
  let out = "";
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}
function randomAccessCode() {
  // 6 dígitos legíveis
  return randomDigits(6);
}
function randomPin() {
  return randomDigits(4);
}
function randomQrToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureCredential(
  admin: ReturnType<typeof getAdminClient>,
  organizationId: string,
  studentId: string,
) {
  const { data: existing } = await admin
    .from("student_access_credentials")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();
  if (existing) return existing;
  // gera com retry em caso de colisão de unique
  type PgErr = { message?: string; code?: string; hint?: string };
  let lastError: PgErr | null = null;
  for (let i = 0; i < 5; i++) {
    const access_code = randomAccessCode();
    const pin_code = randomPin();
    const qr_code = randomQrToken();
    const { data, error } = await admin
      .from("student_access_credentials")
      .insert({
        organization_id: organizationId,
        student_id: studentId,
        access_code,
        pin_code,
        qr_code,
        active: true,
      })
      .select("*")
      .single();
    if (!error && data) return data;
    lastError = error as typeof lastError;
    if (lastError?.code && lastError.code !== "23505") break;
  }
  console.error("[ensureCredential] falha ao inserir credencial", lastError);
  if (lastError?.code === "42P01") {
    throw new Error(
      "Tabela 'student_access_credentials' não existe. Rode a migração docs/sql/20260614_access_control.sql no SQL Editor do Lovable Cloud.",
    );
  }
  if (lastError?.code === "42501") {
    throw new Error(
      "Sem permissão para criar credenciais (RLS/GRANT). Rode a migração docs/sql/20260614_access_control.sql.",
    );
  }
  throw new Error(
    `Não foi possível gerar credenciais: ${lastError?.message ?? "erro desconhecido"}`,
  );
}

// --------- validação de acesso ---------
interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

async function validateStudentEligibility(
  admin: ReturnType<typeof getAdminClient>,
  organizationId: string,
  studentId: string,
): Promise<ValidationResult> {
  const { data: student } = await admin
    .from("students")
    .select("id, status, deleted_at, blocked_at")
    .eq("id", studentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!student) return { allowed: false, reason: "Aluno não encontrado" };
  if ((student as Record<string, unknown>).deleted_at)
    return { allowed: false, reason: "Aluno removido" };
  if ((student as Record<string, unknown>).blocked_at)
    return { allowed: false, reason: "Bloqueio administrativo" };
  if (student.status !== "active") return { allowed: false, reason: "Aluno inativo" };

  const today = new Date().toISOString().slice(0, 10);
  const { count: overdueCount } = await admin
    .from("financial_records")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("student_id", studentId)
    .lt("due_date", today)
    .in("status", ["pending", "overdue"]);
  if ((overdueCount ?? 0) > 0)
    return { allowed: false, reason: "Mensalidade vencida" };

  return { allowed: true };
}

// =====================================================
// CREDENCIAIS
// =====================================================

export const getStudentCredentials = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const cred = await ensureCredential(admin, data.organizationId, data.studentId);
    return { credential: cred };
  });

export const regenerateCredentialField = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        field: z.enum(["access_code", "pin_code", "qr_code"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    await ensureCredential(admin, data.organizationId, data.studentId);
    const newValue =
      data.field === "qr_code"
        ? randomQrToken()
        : data.field === "pin_code"
          ? randomPin()
          : randomAccessCode();
    const { data: updated, error } = await admin
      .from("student_access_credentials")
      .update({ [data.field]: newValue, updated_at: new Date().toISOString() })
      .eq("student_id", data.studentId)
      .eq("organization_id", data.organizationId)
      .select("*")
      .single();
    if (error) throw error;
    return { credential: updated };
  });

export const updateCredentialIds = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        studentId: z.string().uuid(),
        rfid_uid: z.string().trim().max(64).nullable().optional(),
        biometric_id: z.string().trim().max(128).nullable().optional(),
        face_id: z.string().trim().max(128).nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    await ensureCredential(admin, data.organizationId, data.studentId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.rfid_uid !== undefined) patch.rfid_uid = data.rfid_uid || null;
    if (data.biometric_id !== undefined) patch.biometric_id = data.biometric_id || null;
    if (data.face_id !== undefined) patch.face_id = data.face_id || null;
    if (data.active !== undefined) patch.active = data.active;
    const { data: updated, error } = await admin
      .from("student_access_credentials")
      .update(patch)
      .eq("student_id", data.studentId)
      .eq("organization_id", data.organizationId)
      .select("*")
      .single();
    if (error) throw error;
    return { credential: updated };
  });

// =====================================================
// TENTATIVA DE ACESSO
// =====================================================

interface StudentSummary {
  id: string;
  full_name: string | null;
  belt: string | null;
  photo_url: string | null;
}

async function findStudentByCredential(
  admin: ReturnType<typeof getAdminClient>,
  organizationId: string,
  method: z.infer<typeof accessMethodSchema>,
  value: string,
): Promise<string | null> {
  const v = value.trim();
  if (!v) return null;
  let query = admin
    .from("student_access_credentials")
    .select("student_id")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .limit(1);
  switch (method) {
    case "code":
    case "manual":
      query = query.eq("access_code", v);
      break;
    case "pin":
      query = query.eq("pin_code", v);
      break;
    case "qr":
      query = query.eq("qr_code", v);
      break;
    case "rfid":
      query = query.eq("rfid_uid", v);
      break;
    case "biometric":
      query = query.eq("biometric_id", v);
      break;
    case "face":
      query = query.eq("face_id", v);
      break;
    case "gate":
      // gate envia o próprio access_code do equipamento
      query = query.eq("access_code", v);
      break;
  }
  const { data } = await query.maybeSingle();
  return data?.student_id ?? null;
}

export const validateAccessAttempt = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        method: accessMethodSchema,
        value: z.string().min(1).max(256),
        deviceId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();

    const studentId = await findStudentByCredential(
      admin,
      data.organizationId,
      data.method,
      data.value,
    );

    if (!studentId) {
      await admin.from("access_logs").insert({
        organization_id: data.organizationId,
        student_id: null,
        device_id: data.deviceId ?? null,
        access_method: data.method,
        status: "denied",
        reason: "Credencial não encontrada",
        raw_input: data.value.slice(0, 64),
      });
      return {
        allowed: false,
        reason: "Credencial não encontrada",
        student: null as StudentSummary | null,
        checkinAt: null as string | null,
      };
    }

    const eligibility = await validateStudentEligibility(
      admin,
      data.organizationId,
      studentId,
    );

    // dados do aluno para exibição
    const { data: studentRow } = await admin
      .from("students")
      .select("id, profiles(full_name, photo_url), graduations(belt)")
      .eq("id", studentId)
      .maybeSingle();
    const profileRow = (studentRow as Record<string, unknown> | null)?.profiles as
      | { full_name?: string; photo_url?: string | null }
      | null
      | undefined;
    const gradRow = (studentRow as Record<string, unknown> | null)?.graduations as
      | Array<{ belt?: string }>
      | undefined;
    const summary: StudentSummary = {
      id: studentId,
      full_name: profileRow?.full_name ?? null,
      belt: gradRow?.[0]?.belt ?? null,
      photo_url: profileRow?.photo_url ?? null,
    };

    let checkinAt: string | null = null;
    if (eligibility.allowed) {
      const { data: att } = await admin
        .from("attendance_records")
        .insert({
          organization_id: data.organizationId,
          student_id: studentId,
          access_method: data.method,
          device_id: data.deviceId ?? null,
        })
        .select("checkin_at")
        .single();
      checkinAt = att?.checkin_at ?? new Date().toISOString();
    }

    await admin.from("access_logs").insert({
      organization_id: data.organizationId,
      student_id: studentId,
      device_id: data.deviceId ?? null,
      access_method: data.method,
      status: eligibility.allowed ? "granted" : "denied",
      reason: eligibility.reason ?? null,
      raw_input: data.value.slice(0, 64),
    });

    return {
      allowed: eligibility.allowed,
      reason: eligibility.reason ?? null,
      student: summary,
      checkinAt,
    };
  });

// =====================================================
// LEITURAS
// =====================================================

export const listTodayAttendance = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const startISO = new Date();
    startISO.setHours(0, 0, 0, 0);
    const { data: rows, error } = await admin
      .from("attendance_records")
      .select("id, checkin_at, access_method, students(id, profiles(full_name, photo_url))")
      .eq("organization_id", data.organizationId)
      .gte("checkin_at", startISO.toISOString())
      .order("checkin_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { records: rows ?? [] };
  });

export const listAccessLogs = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ limit: z.number().int().min(1).max(500).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("access_logs")
      .select(
        "id, created_at, access_method, status, reason, raw_input, students(id, profiles(full_name))",
      )
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw error;
    return { logs: rows ?? [] };
  });

export const getAccessDashboard = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = start.toISOString().slice(0, 10);

    const [presentTodayQ, deniedTodayQ, activeStudentsQ, blockedByFinanceQ] = await Promise.all([
      admin
        .from("attendance_records")
        .select("student_id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .gte("checkin_at", start.toISOString()),
      admin
        .from("access_logs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .eq("status", "denied")
        .gte("created_at", start.toISOString()),
      admin
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .eq("status", "active")
        .is("deleted_at", null),
      admin
        .from("financial_records")
        .select("student_id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .lt("due_date", today)
        .in("status", ["pending", "overdue"]),
    ]);

    return {
      presentToday: presentTodayQ.count ?? 0,
      entriesToday: presentTodayQ.count ?? 0,
      deniedToday: deniedTodayQ.count ?? 0,
      activeStudents: activeStudentsQ.count ?? 0,
      overdueCharges: blockedByFinanceQ.count ?? 0,
    };
  });

export const listStudentAttendance = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({ studentId: z.string().uuid(), limit: z.number().int().min(1).max(200).optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("attendance_records")
      .select("id, checkin_at, access_method")
      .eq("organization_id", data.organizationId)
      .eq("student_id", data.studentId)
      .order("checkin_at", { ascending: false })
      .limit(data.limit ?? 30);
    if (error) throw error;
    return { records: rows ?? [] };
  });

// =====================================================
// DEVICES
// =====================================================

const deviceSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  manufacturer: z.enum(["control_id", "henry", "topdata", "mock", "other"]),
  model: z.string().trim().max(120).nullable().optional(),
  ip_address: z.string().trim().max(64).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  api_token: z.string().trim().max(256).nullable().optional(),
  active: z.boolean(),
});

export const listAccessDevices = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("access_devices")
      .select("*")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { devices: rows ?? [] };
  });

export const upsertAccessDevice = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.extend({ device: deviceSchema }).parse(input))
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const payload = {
      organization_id: data.organizationId,
      name: data.device.name,
      manufacturer: data.device.manufacturer,
      model: data.device.model ?? null,
      ip_address: data.device.ip_address ?? null,
      port: data.device.port ?? null,
      api_token: data.device.api_token ?? null,
      active: data.device.active,
      updated_at: new Date().toISOString(),
    };
    if (data.device.id) {
      const { error } = await admin
        .from("access_devices")
        .update(payload)
        .eq("id", data.device.id)
        .eq("organization_id", data.organizationId);
      if (error) throw error;
      return { id: data.device.id };
    }
    const { data: ins, error } = await admin
      .from("access_devices")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    return { id: ins.id };
  });

export const deleteAccessDevice = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ deviceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { error } = await admin
      .from("access_devices")
      .delete()
      .eq("id", data.deviceId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const testDeviceConnection = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ deviceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const { data: dev } = await admin
      .from("access_devices")
      .select("*")
      .eq("id", data.deviceId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (!dev) throw new Error("Dispositivo não encontrado");
    const cfg: DeviceConfig = {
      id: dev.id,
      manufacturer: dev.manufacturer,
      name: dev.name,
      ipAddress: dev.ip_address,
      port: dev.port,
      apiToken: dev.api_token,
    };
    const provider = getProvider(cfg);
    const res = await provider.connect();
    if (res.ok) {
      await admin
        .from("access_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", dev.id);
    }
    return res;
  });

// =====================================================
// SYNC USERS — best-effort, não bloqueia o caller
// =====================================================

export const syncStudentAccess = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireStaff(data.accessToken, data.organizationId);
    const admin = getAdminClient();
    const [{ data: cred }, { data: student }, { data: devices }] = await Promise.all([
      admin
        .from("student_access_credentials")
        .select("*")
        .eq("student_id", data.studentId)
        .eq("organization_id", data.organizationId)
        .maybeSingle(),
      admin
        .from("students")
        .select("id, status, profiles(full_name)")
        .eq("id", data.studentId)
        .eq("organization_id", data.organizationId)
        .maybeSingle(),
      admin
        .from("access_devices")
        .select("*")
        .eq("organization_id", data.organizationId)
        .eq("active", true),
    ]);
    if (!cred || !student || !devices?.length) return { synced: 0 };

    const profileRow = (student as Record<string, unknown>).profiles as
      | { full_name?: string }
      | null
      | undefined;
    const payload: StudentSyncPayload = {
      externalId: student.id,
      name: profileRow?.full_name ?? "Aluno",
      accessCode: cred.access_code,
      rfidUid: cred.rfid_uid ?? null,
      biometricId: cred.biometric_id ?? null,
      faceId: cred.face_id ?? null,
      active: cred.active && student.status === "active",
    };

    const results = await Promise.allSettled(
      devices.map((d) => {
        const provider = getProvider({
          id: d.id,
          manufacturer: d.manufacturer,
          name: d.name,
          ipAddress: d.ip_address,
          port: d.port,
          apiToken: d.api_token,
        });
        return provider.syncUsers([payload]).then(() => provider.syncCredentials([payload]));
      }),
    );
    const synced = results.filter((r) => r.status === "fulfilled").length;
    return { synced };
  });
