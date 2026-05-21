import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, DollarSign, Users, Percent, UserCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/financeiro/dashboard")({
  component: Page,
  head: () => ({ meta: [{ title: "Financeiro · Dashboard" }] }),
});

type Period = "current" | "previous" | "3m" | "6m" | "year";

function rangeFor(p: Period): { start: string; end: string; prevStart: string; prevEnd: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const fmt = (d: Date) => d.toISOString();
  if (p === "current") {
    return {
      start: fmt(new Date(y, m, 1)), end: fmt(new Date(y, m + 1, 1)),
      prevStart: fmt(new Date(y, m - 1, 1)), prevEnd: fmt(new Date(y, m, 1)),
    };
  }
  if (p === "previous") {
    return {
      start: fmt(new Date(y, m - 1, 1)), end: fmt(new Date(y, m, 1)),
      prevStart: fmt(new Date(y, m - 2, 1)), prevEnd: fmt(new Date(y, m - 1, 1)),
    };
  }
  if (p === "3m") {
    return {
      start: fmt(new Date(y, m - 2, 1)), end: fmt(new Date(y, m + 1, 1)),
      prevStart: fmt(new Date(y, m - 5, 1)), prevEnd: fmt(new Date(y, m - 2, 1)),
    };
  }
  if (p === "6m") {
    return {
      start: fmt(new Date(y, m - 5, 1)), end: fmt(new Date(y, m + 1, 1)),
      prevStart: fmt(new Date(y, m - 11, 1)), prevEnd: fmt(new Date(y, m - 5, 1)),
    };
  }
  return {
    start: fmt(new Date(y, 0, 1)), end: fmt(new Date(y + 1, 0, 1)),
    prevStart: fmt(new Date(y - 1, 0, 1)), prevEnd: fmt(new Date(y, 0, 1)),
  };
}

function Page() {
  const { organizationId } = useAuth();
  const [period, setPeriod] = useState<Period>("current");
  const r = rangeFor(period);

  const { data, isLoading } = useQuery({
    queryKey: ["fin-dash", organizationId, period],
    queryFn: async () => {
      const [curPaid, prevPaid, activeStudents] = await Promise.all([
        supabase.from("financial_records").select("amount").eq("organization_id", organizationId!).eq("status", "paid").gte("paid_at", r.start).lt("paid_at", r.end),
        supabase.from("financial_records").select("amount").eq("organization_id", organizationId!).eq("status", "paid").gte("paid_at", r.prevStart).lt("paid_at", r.prevEnd),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", organizationId!).eq("status", "active"),
      ]);
      const sum = (rows: { amount: number }[] | null) => (rows ?? []).reduce((a, b) => a + Number(b.amount ?? 0), 0);
      const cur = sum(curPaid.data as { amount: number }[]);
      const prev = sum(prevPaid.data as { amount: number }[]);
      const active = activeStudents.count ?? 0;
      return { cur, prev, active };
    },
    enabled: !!organizationId,
  });

  if (isLoading || !data) return <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;

  const pct = data.prev > 0 ? ((data.cur - data.prev) / data.prev) * 100 : data.cur > 0 ? 100 : 0;
  const perStudent = data.active > 0 ? data.cur / data.active : 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Mês atual</SelectItem>
            <SelectItem value="previous">Mês anterior</SelectItem>
            <SelectItem value="3m">Últimos 3 meses</SelectItem>
            <SelectItem value="6m">Últimos 6 meses</SelectItem>
            <SelectItem value="year">Ano atual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card icon={<DollarSign className="h-4 w-4" />} label="Receita total" value={formatBRL(data.cur)} delta={pct} />
        <Card icon={<TrendingDown className="h-4 w-4" />} label="Despesas totais" value={formatBRL(0)} delta={0} note="Em breve" />
        <Card icon={<TrendingUp className="h-4 w-4" />} label="Lucro líquido" value={formatBRL(data.cur)} delta={pct} />
        <Card icon={<Users className="h-4 w-4" />} label="Alunos ativos" value={String(data.active)} delta={0} />
        <Card icon={<UserCheck className="h-4 w-4" />} label="Receita por aluno" value={formatBRL(perStudent)} delta={0} />
        <Card icon={<Percent className="h-4 w-4" />} label="Margem de lucro" value="100%" delta={0} note="Sem despesas" />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Despesas, fluxo de caixa e gráficos detalhados</h2>
        <p className="text-sm text-muted-foreground">Em breve — controle de despesas operacionais e gráficos comparativos.</p>
      </div>
    </div>
  );
}

function Card({ icon, label, value, delta, note }: { icon: React.ReactNode; label: string; value: string; delta: number; note?: string }) {
  const up = delta > 0;
  const down = delta < 0;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>{label}</span>{icon}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {note ? (
        <div className="mt-1 text-xs text-muted-foreground">{note}</div>
      ) : (
        <div className={`mt-1 text-xs ${up ? "text-emerald-600" : down ? "text-red-600" : "text-muted-foreground"}`}>
          {up ? "↑" : down ? "↓" : "→"} {Math.abs(delta).toFixed(1)}% vs período anterior
        </div>
      )}
    </div>
  );
}
