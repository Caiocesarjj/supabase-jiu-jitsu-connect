import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const orgAuthSchema = z.object({
  accessToken: z.string().min(10),
  organizationId: z.string().uuid(),
});

function getAdminClient() {
  const url = process.env.APP_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.APP_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase do servidor não configurado");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function requireAdmin(accessToken: string, organizationId: string) {
  const supabase = getAdminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) throw new Error("Sessão inválida.");
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!profile) throw new Error("Perfil não encontrado.");
  if (profile.organization_id !== organizationId)
    throw new Error("Sem acesso a esta organização.");
  if (String(profile.role) !== "admin")
    throw new Error("Apenas administradores podem gerenciar afiliações.");
  return { supabase, user: authData.user, profile };
}

// ----- Solicitar afiliação por slug -----
export const requestAffiliation = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        accessToken: z.string().min(10),
        organizationId: z.string().uuid(),
        identifier: z.string().trim().min(2).max(255),
        notes: z.string().trim().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireAdmin(data.accessToken, data.organizationId);

    const raw = data.identifier.trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);

    let query = supabase.from("organizations").select("id, name, slug, public_code, email");
    if (isEmail) {
      query = query.ilike("email", raw);
    } else {
      // tenta como public_code (case-insensitive) OU slug legado
      const code = raw.toUpperCase();
      const slug = raw.toLowerCase();
      query = query.or(`public_code.eq.${code},slug.eq.${slug}`);
    }
    const { data: matrix, error: mErr } = await query.maybeSingle();

    if (mErr) return { ok: false as const, error: mErr.message };
    if (!matrix)
      return { ok: false as const, error: "Academia não encontrada com esse código ou e-mail." };
    if (matrix.id === data.organizationId)
      return { ok: false as const, error: "Você não pode se afiliar à própria organização." };

    const { error } = await supabase.from("affiliations").insert({
      matrix_org_id: matrix.id,
      affiliate_org_id: data.organizationId,
      status: "pending",
      notes: data.notes || null,
    });
    if (error) {
      if (String(error.message).includes("duplicate"))
        return { ok: false as const, error: "Já existe um pedido para essa matriz." };
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const, matrix: { id: matrix.id, name: matrix.name, slug: matrix.slug } };
  });



// ----- Listar afiliações (enviadas + recebidas) -----
export const listAffiliations = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireAdmin(data.accessToken, data.organizationId);
    const [sentRes, receivedRes] = await Promise.all([
      supabase
        .from("affiliations")
        .select("id, status, requested_at, reviewed_at, notes, matrix_org_id")
        .eq("affiliate_org_id", data.organizationId)
        .order("requested_at", { ascending: false }),
      supabase
        .from("affiliations")
        .select("id, status, requested_at, reviewed_at, notes, affiliate_org_id")
        .eq("matrix_org_id", data.organizationId)
        .order("requested_at", { ascending: false }),
    ]);
    if (sentRes.error) throw sentRes.error;
    if (receivedRes.error) throw receivedRes.error;

    const orgIds = Array.from(
      new Set([
        ...(sentRes.data ?? []).map((r: any) => r.matrix_org_id),
        ...(receivedRes.data ?? []).map((r: any) => r.affiliate_org_id),
      ]),
    );
    const orgsMap = new Map<string, { id: string; name: string; slug: string }>();
    if (orgIds.length) {
      const { data: orgs, error: oErr } = await supabase
        .from("organizations")
        .select("id, name, slug")
        .in("id", orgIds);
      if (oErr) throw oErr;
      for (const o of orgs ?? []) orgsMap.set(o.id, o as any);
    }
    return {
      sent: (sentRes.data ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        requested_at: r.requested_at,
        reviewed_at: r.reviewed_at,
        notes: r.notes,
        org: orgsMap.get(r.matrix_org_id) ?? { id: r.matrix_org_id, name: "—", slug: "" },
      })),
      received: (receivedRes.data ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        requested_at: r.requested_at,
        reviewed_at: r.reviewed_at,
        notes: r.notes,
        org:
          orgsMap.get(r.affiliate_org_id) ??
          { id: r.affiliate_org_id, name: "—", slug: "" },
      })),
    };
  });

// ----- Aprovar / Rejeitar -----
export const reviewAffiliation = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema
      .extend({
        affiliationId: z.string().uuid(),
        action: z.enum(["approved", "rejected"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase, user } = await requireAdmin(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("affiliations")
      .update({
        status: data.action,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq("id", data.affiliationId)
      .eq("matrix_org_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

// ----- Cancelar (apenas afiliada) -----
export const cancelAffiliation = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ affiliationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireAdmin(data.accessToken, data.organizationId);
    const { error } = await supabase
      .from("affiliations")
      .delete()
      .eq("id", data.affiliationId)
      .eq("affiliate_org_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

// ----- Dashboard consolidado (matriz + descendentes) -----
export const getConsolidatedStats = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireAdmin(data.accessToken, data.organizationId);

    const { data: tree, error: tErr } = await supabase
      .from("affiliation_tree")
      .select("descendant_id, depth")
      .eq("root_id", data.organizationId);
    if (tErr) throw tErr;

    const descendantIds = (tree ?? []).map((r: any) => r.descendant_id as string);
    const orgIds = [data.organizationId, ...descendantIds];

    const { data: orgs, error: oErr } = await supabase
      .from("organizations")
      .select("id, name, slug")
      .in("id", orgIds);
    if (oErr) throw oErr;
    const orgsMap = new Map<string, { id: string; name: string; slug: string }>();
    for (const o of orgs ?? []) orgsMap.set(o.id, o as any);

    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const perOrg = await Promise.all(
      orgIds.map(async (id) => {
        const [activeRes, paidRes, overdueRes] = await Promise.all([
          supabase
            .from("students")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", id)
            .eq("status", "active"),
          supabase
            .from("financial_records")
            .select("amount")
            .eq("organization_id", id)
            .eq("status", "paid")
            .gte("paid_at", startMonth),
          supabase
            .from("financial_records")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", id)
            .eq("status", "overdue"),
        ]);
        const received =
          (paidRes.data ?? []).reduce(
            (acc: number, r: any) => acc + Number(r.amount ?? 0),
            0,
          ) ?? 0;
        const depth =
          id === data.organizationId
            ? 0
            : Number((tree ?? []).find((t: any) => t.descendant_id === id)?.depth ?? 1);
        return {
          org: orgsMap.get(id) ?? { id, name: "—", slug: "" },
          depth,
          activeStudents: activeRes.count ?? 0,
          receivedThisMonth: received,
          overdueCount: overdueRes.count ?? 0,
        };
      }),
    );

    const totals = perOrg.reduce(
      (acc, r) => ({
        activeStudents: acc.activeStudents + r.activeStudents,
        receivedThisMonth: acc.receivedThisMonth + r.receivedThisMonth,
        overdueCount: acc.overdueCount + r.overdueCount,
      }),
      { activeStudents: 0, receivedThisMonth: 0, overdueCount: 0 },
    );

    return { perOrg, totals, affiliateCount: descendantIds.length };
  });
