import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, DollarSign, Calendar, AlertCircle, Trophy, GraduationCap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/format";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Avatar } from "@/components/Avatar";
import { BeltBadge } from "@/components/BeltBadge";
import { JUNIOR_BELT_ORDER, ADULT_BELT_ORDER, getBeltLabel } from "@/lib/graduation";
import type { Belt } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — JJ Manager" }] }),
});

interface KPIs {
  activeStudents: number;
  newThisMonth: number;
  receivedThisMonth: number;
  overdueCount: number;
  pendingGraduationsCount: number;
  pendingGraduations: PendingGraduation[];
}

interface PendingGraduation {
  id: string;
  belt: string;
  degrees: number;
  promotion_date: string;
  minimum_next_promotion_date: string;
  students: {
    id: string;
    birth_date: string | null;
    profiles: { full_name: string };
  };
}

async function fetchKPIs(orgId: string): Promise<KPIs> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const today = now.toISOString().split("T")[0];

  const [active, newOnes, paid, overdue, pendingGrads] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "active"),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("enrollment_date", startOfMonth),
    supabase
      .from("financial_records")
      .select("amount")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("paid_at", startOfMonth),
    supabase
      .from("financial_records")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "overdue"),
    supabase
      .from("graduations")
      .select(
        `
        id, belt, degrees, promotion_date, minimum_next_promotion_date,
        students (
          id, birth_date,
          profiles ( full_name )
        )
      `,
      )
      .eq("organization_id", orgId)
      .lte("minimum_next_promotion_date", today)
      .not("minimum_next_promotion_date", "is", null)
      .order("minimum_next_promotion_date", { ascending: true })
      .limit(10),
  ]);

  const receivedThisMonth =
    (paid.data ?? []).reduce(
      (sum, r: { amount: number }) => sum + Number(r.amount ?? 0),
      0,
    ) ?? 0;

  return {
    activeStudents: active.count ?? 0,
    newThisMonth: newOnes.count ?? 0,
    receivedThisMonth,
    overdueCount: overdue.count ?? 0,
    pendingGraduationsCount: (pendingGrads.data ?? []).length,
    pendingGraduations: (pendingGrads.data ?? []) as unknown as PendingGraduation[],
  };
}

function KpiCard({
  title,
  value,
  icon,
  tone = "default",
  onClick,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "default" | "success" | "danger";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "danger"
        ? "text-red-600"
        : "text-foreground";
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border border-border bg-card p-5 shadow-sm text-left w-full ${onClick ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </button>
  );
}

function DegreeDots({ degrees, size = 8 }: { degrees: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: degrees }).map((_, i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "#fff",
            border: "1px solid #444",
            display: "inline-block",
          }}
        />
      ))}
    </span>
  );
}

function DashboardPage() {
  const { organizationId, profile } = useAuth();
  const navigate = useNavigate();
  const [gradModalOpen, setGradModalOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard-kpis", organizationId],
    queryFn: () => fetchKPIs(organizationId!),
    enabled: !!organizationId,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Olá, {profile?.full_name}. Aqui está o resumo da sua academia.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Erro ao carregar dados: {(error as Error).message}. Verifique se o
          schema do banco foi aplicado.
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            title="Alunos ativos"
            value={data?.activeStudents ?? 0}
            icon={<Users className="h-4 w-4" />}
          />
          <KpiCard
            title="Novos este mês"
            value={data?.newThisMonth ?? 0}
            icon={<Calendar className="h-4 w-4" />}
          />
          <KpiCard
            title="Recebido no mês"
            value={formatBRL(data?.receivedThisMonth ?? 0)}
            icon={<DollarSign className="h-4 w-4" />}
            tone="success"
          />
          <KpiCard
            title="Mensalidades atrasadas"
            value={data?.overdueCount ?? 0}
            icon={<AlertCircle className="h-4 w-4" />}
            tone={data && data.overdueCount > 0 ? "danger" : "default"}
            onClick={() => navigate({ to: "/financeiro", search: { status: "overdue" } })}
          />
          <KpiCard
            title="Prontos para promover"
            value={data?.pendingGraduationsCount ?? 0}
            icon={<Trophy className="h-4 w-4" />}
            tone={data && data.pendingGraduationsCount > 0 ? "success" : "default"}
            onClick={() => setGradModalOpen(true)}
          />
        </div>
      )}

      {/* Modal de graduações pendentes */}
      <Dialog open={gradModalOpen} onOpenChange={setGradModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Alunos prontos para promoção</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-3 py-2">
            {data && data.pendingGraduations.length > 0 ? (
              data.pendingGraduations.map((pg) => {
                const name = pg.students?.profiles?.full_name ?? "Sem nome";
                const studentId = pg.students?.id ?? "";
                const daysAgo = pg.minimum_next_promotion_date
                  ? Math.floor(
                      (new Date().getTime() - new Date(pg.minimum_next_promotion_date).getTime()) /
                        (1000 * 60 * 60 * 24),
                    )
                  : 0;
                return (
                  <div
                    key={pg.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <Avatar name={name} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <BeltBadge
                          belt={pg.belt as any}
                          size="sm"
                          showLabel={false}
                        />
                        <DegreeDots degrees={pg.degrees} size={6} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Apto há {daysAgo} dia{daysAgo !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setGradModalOpen(false);
                        navigate({ to: "/alunos/$alunoId", params: { alunoId: studentId } });
                      }}
                    >
                      Ver ficha
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Trophy className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">Nenhum aluno aguardando promoção no momento.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <BeltDistribution organizationId={organizationId} />

      <InstructorsPanel organizationId={organizationId} />
    </div>
  );
}

function InstructorsPanel({ organizationId }: { organizationId: string | null }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-instructors", organizationId],
    queryFn: async () => {
      const [insRes, schRes] = await Promise.all([
        supabase
          .from("instructors")
          .select("id, full_name, belt, degrees")
          .eq("organization_id", organizationId!)
          .order("full_name"),
        supabase
          .from("class_schedules")
          .select("instructor_record_id")
          .eq("organization_id", organizationId!)
          .eq("active", true),
      ]);
      const counts: Record<string, number> = {};
      type SchedRow = { instructor_record_id: string | null };
      type InsRow = { id: string; full_name: string; belt: Belt; degrees: number };
      const schedRows = (schRes.data ?? []) as SchedRow[];
      for (const row of schedRows) {
        if (row.instructor_record_id)
          counts[row.instructor_record_id] = (counts[row.instructor_record_id] ?? 0) + 1;
      }
      return {
        instructors: (insRes.data ?? []) as InsRow[],
        counts,
      };
    },
    enabled: !!organizationId,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <GraduationCap className="h-4 w-4" /> Instrutores ({data.instructors.length})
        </h2>
        <Button size="sm" variant="outline" onClick={() => navigate({ to: "/instrutores" })}>
          Gerenciar
        </Button>
      </div>
      {data.instructors.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum instrutor cadastrado ainda.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.instructors.map((i) => {
            const turmas = data.counts[i.id] ?? 0;
            return (
              <div
                key={i.id}
                className="flex items-center gap-3 rounded-md border bg-background p-3"
              >
                <BeltBadge belt={i.belt} stripes={i.degrees} size="sm" showLabel={false} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{i.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {getBeltLabel(i.belt)} • {i.degrees}º grau
                  </div>
                </div>
                <span className="text-xs rounded-full bg-muted px-2 py-0.5 whitespace-nowrap">
                  {turmas} {turmas === 1 ? "turma" : "turmas"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ADULT_BELTS_FULL: Belt[] = [...ADULT_BELT_ORDER, "coral", "vermelha"];

async function fetchBeltCounts(orgId: string) {
  const { data, error } = await supabase
    .from("graduations")
    .select("belt, students!inner(id, status, organization_id)")
    .eq("organization_id", orgId)
    .eq("students.status", "active");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ belt: string }>) {
    counts[row.belt] = (counts[row.belt] ?? 0) + 1;
  }
  return counts;
}

function BeltDistribution({ organizationId }: { organizationId: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["belt-distribution", organizationId],
    queryFn: () => fetchBeltCounts(organizationId!),
    enabled: !!organizationId,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <LoadingSpinner />
      </div>
    );
  }

  const renderList = (belts: Belt[], total: number) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total {total}</span>
      </div>
      {belts.map((b) => {
        const count = data[b] ?? 0;
        return (
          <div
            key={b}
            className={`flex items-center justify-between rounded-md border px-3 py-2 gap-3 ${count > 0 ? "bg-background" : "bg-muted/30 opacity-50"}`}
          >
            <div className="flex items-center gap-2">
              <BeltBadge belt={b} size="sm" showLabel={false} />
              <span className="text-sm text-muted-foreground">{getBeltLabel(b)}</span>
            </div>
            <span className="text-base font-semibold">{count}</span>
          </div>
        );
      })}
    </div>
  );

  const adultTotal = ADULT_BELTS_FULL.reduce((s, b) => s + (data[b] ?? 0), 0);
  const kidTotal = JUNIOR_BELT_ORDER.reduce((s, b) => s + (data[b] ?? 0), 0);

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="text-base font-semibold">Distribuição por faixa</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Adulto</h3>
          {renderList(ADULT_BELTS_FULL, adultTotal)}
        </div>
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Infantil</h3>
          {renderList(JUNIOR_BELT_ORDER, kidTotal)}
        </div>
      </div>
    </div>
  );
}

