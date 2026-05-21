import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/financeiro/crescimento")({
  component: Page,
  head: () => ({ meta: [{ title: "Crescimento · Financeiro" }] }),
});

const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function Page() {
  const { organizationId } = useAuth();
  const year = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const { data, isLoading } = useQuery({
    queryKey: ["fin-growth", organizationId, year],
    queryFn: async () => {
      const yStart = `${year}-01-01`;
      const yEnd = `${year + 1}-01-01`;
      const { data: rec } = await supabase
        .from("financial_records")
        .select("amount, status, paid_at, reference_month")
        .eq("organization_id", organizationId!)
        .gte("reference_month", yStart)
        .lt("reference_month", yEnd);
      const months = Array.from({ length: 12 }, (_, i) => ({ month: MONTHS_SHORT[i], receita: 0, aReceber: 0 }));
      for (const r of (rec ?? []) as { amount: number; status: string; reference_month: string }[]) {
        const m = parseInt(r.reference_month.slice(5, 7), 10) - 1;
        if (m < 0 || m > 11) continue;
        if (r.status === "paid") months[m].receita += Number(r.amount);
        else if (r.status === "pending") months[m].aReceber += Number(r.amount);
      }
      const totalReceived = months.reduce((a, b) => a + b.receita, 0);
      const monthsWithData = months.slice(0, currentMonth + 1).filter((m) => m.receita > 0).length || 1;
      const avg = totalReceived / monthsWithData;
      return { months, totalReceived, avg, projection: avg * 12 };
    },
    enabled: !!organizationId,
  });

  const exportCSV = () => {
    if (!data) return;
    const rows = [["Mês", "Receita", "A Receber"], ...data.months.map((m) => [m.month, m.receita, m.aReceber])];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `crescimento_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading || !data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Stat label={`Receita ${year} (até ${MONTHS_SHORT[currentMonth]})`} value={formatBRL(data.totalReceived)} />
        <Stat label="Receita média mensal" value={formatBRL(data.avg)} />
        <Stat label="Projeção até fim do ano" value={formatBRL(data.projection)} />
      </div>
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Receita e A Receber — {year}</h2>
          <Button size="sm" variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.months}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(v) => `R$${v}`} />
              <Tooltip formatter={(v: number) => formatBRL(v)} />
              <Legend />
              <Line type="monotone" dataKey="receita" name="Receita" stroke="#2563eb" strokeWidth={2} />
              <Line type="monotone" dataKey="aReceber" name="A Receber" stroke="#eab308" strokeDasharray="5 5" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}
