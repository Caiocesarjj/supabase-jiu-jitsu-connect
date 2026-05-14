import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, DollarSign, Calendar, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/format";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — JJ Manager" }] }),
});

interface KPIs {
  activeStudents: number;
  newThisMonth: number;
  receivedThisMonth: number;
  overdueCount: number;
}

async function fetchKPIs(orgId: string): Promise<KPIs> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [active, newOnes, paid, overdue] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "active"),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("enrolled_at", startOfMonth),
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
  };
}

function KpiCard({
  title,
  value,
  icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "default" | "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "danger"
        ? "text-red-600"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function DashboardPage() {
  const { organizationId, profile } = useAuth();

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          />
        </div>
      )}

      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Próximas fases</p>
        <p className="mt-1">
          Esta é a Fase 1 (fundação). Nas próximas etapas vamos construir
          alunos, turmas, presença, financeiro e configurações.
        </p>
      </div>
    </div>
  );
}
