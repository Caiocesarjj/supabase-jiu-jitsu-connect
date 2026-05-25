import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getUserClient } from "@/lib/supabase-server";

const orgAuthSchema = z.object({
  accessToken: z.string().min(10),
  organizationId: z.string().uuid(),
});

async function requireAdmin(accessToken: string, organizationId: string) {
  const supabase = getUserClient(accessToken);
  const { data: authData, error: authError } = await supabase.auth.getUser();
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
// Regra: financeiro só da própria matriz. Das filiais, só contagens/lista de alunos.
export const getConsolidatedStats = createServerFn({ method: "POST" })
  .inputValidator((input) => orgAuthSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabase } = await requireAdmin(data.accessToken, data.organizationId);

    const { data: tree, error: tErr } = await supabase
      .from("affiliation_tree")
      .select("descendant_id, depth")
      .eq("root_id", data.organizationId);
    if (tErr) console.warn("affiliation_tree indisponível, usando affiliations aprovadas", tErr.message);

    const treeRows = tErr ? [] : (tree ?? []);
    const { data: directApproved, error: directErr } = await supabase
      .from("affiliations")
      .select("affiliate_org_id")
      .eq("matrix_org_id", data.organizationId)
      .eq("status", "approved");
    if (directErr) throw directErr;

    const descendantIds = Array.from(
      new Set([
        ...treeRows.map((r: any) => r.descendant_id as string),
        ...(directApproved ?? []).map((r: any) => r.affiliate_org_id as string),
      ]),
    );
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
        const isSelf = id === data.organizationId;
        const promises: Array<PromiseLike<any>> = [
          supabase
            .from("students")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", id)
            .eq("status", "active"),
        ];
        if (isSelf) {
          promises.push(
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
          );
        }
        const results = await Promise.all(promises);
        const activeRes = results[0];
        const received = isSelf
          ? (results[1]?.data ?? []).reduce(
              (acc: number, r: any) => acc + Number(r.amount ?? 0),
              0,
            )
          : null;
        const overdueCount = isSelf ? (results[2]?.count ?? 0) : null;
        const depth = isSelf
          ? 0
          : Number(treeRows.find((t: any) => t.descendant_id === id)?.depth ?? 1);
        return {
          org: orgsMap.get(id) ?? { id, name: "—", slug: "" },
          depth,
          activeStudents: activeRes.count ?? 0,
          receivedThisMonth: received,
          overdueCount,
        };
      }),
    );

    const totals = {
      activeStudents: perOrg.reduce((a, r) => a + r.activeStudents, 0),
      // Financeiro consolidado = somente da própria matriz.
      receivedThisMonth: perOrg.find((r) => r.depth === 0)?.receivedThisMonth ?? 0,
      overdueCount: perOrg.find((r) => r.depth === 0)?.overdueCount ?? 0,
    };

    return { perOrg, totals, affiliateCount: descendantIds.length };
  });

// ----- Listar alunos de uma filial (somente matriz/ancestral pode ver) -----
export const listAffiliateStudents = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    orgAuthSchema.extend({ affiliateOrgId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabase } = await requireAdmin(data.accessToken, data.organizationId);

    // Confirma que o affiliateOrgId é descendente da matriz solicitante.
    if (data.affiliateOrgId !== data.organizationId) {
      const { data: tree, error: tErr } = await supabase
        .from("affiliation_tree")
        .select("descendant_id")
        .eq("root_id", data.organizationId)
        .eq("descendant_id", data.affiliateOrgId)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!tree) throw new Error("Sem acesso a essa filial.");
    }

    const { data: students, error: sErr } = await supabase
      .from("students")
      .select("id, profile_id, birth_date, weight, status")
      .eq("organization_id", data.affiliateOrgId)
      .order("status", { ascending: true });
    if (sErr) throw sErr;

    const profileIds = (students ?? []).map((s: any) => s.profile_id).filter(Boolean);
    const studentIds = (students ?? []).map((s: any) => s.id);

    const [profilesRes, gradsRes] = await Promise.all([
      profileIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      studentIds.length
        ? supabase
            .from("graduations")
            .select("student_id, belt, degrees")
            .in("student_id", studentIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if ((profilesRes as any).error) throw (profilesRes as any).error;
    if ((gradsRes as any).error) throw (gradsRes as any).error;

    const nameMap = new Map<string, string>();
    for (const p of (profilesRes.data ?? []) as any[]) nameMap.set(p.id, p.full_name);
    const gradMap = new Map<string, { belt: string; degrees: number }>();
    for (const g of (gradsRes.data ?? []) as any[])
      gradMap.set(g.student_id, { belt: g.belt, degrees: g.degrees });

    const calcAge = (d: string | null) => {
      if (!d) return null;
      const b = new Date(d);
      const now = new Date();
      let age = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
      return age;
    };

    return {
      students: (students ?? []).map((s: any) => ({
        id: s.id,
        fullName: nameMap.get(s.profile_id) ?? "—",
        age: calcAge(s.birth_date),
        weightKg: s.weight ?? null,
        status: s.status,
        belt: gradMap.get(s.id)?.belt ?? null,
        degrees: gradMap.get(s.id)?.degrees ?? null,
      })),
    };
  });
