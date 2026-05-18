import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Download, Inbox } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/relatorios/")({
  component: RelatoriosPage,
  ssr: false,
  head: () => ({ meta: [{ title: "Relatórios — JJ Manager" }] }),
});

const COLORS = {
  recebido: "#1D9E75",
  pendente: "#F59E0B",
  vencido: "#EF4444",
  cinza: "#9E9E9E",
  azul: "#1565C0",
};

const BELT_ORDER = [
  "branca",
  "cinza_branco",
  "cinza",
  "cinza_preto",
  "amarela_branco",
  "amarela",
  "amarela_preto",
  "laranja_branco",
  "laranja",
  "laranja_preto",
  "verde_branco",
  "verde",
  "verde_preto",
  "azul",
  "roxa",
  "marrom",
  "preta",
];

const BELT_LABELS: Record<string, string> = {
  branca: "Branca",
  cinza: "Cinza",
  amarela: "Amarela",
  laranja: "Laranja",
  verde: "Verde",
  azul: "Azul",
  roxa: "Roxa",
  marrom: "Marrom",
  preta: "Preta",
  cinza_branco: "Cinza/B",
  cinza_preto: "Cinza/P",
  amarela_branco: "Ama/B",
  amarela_preto: "Ama/P",
  laranja_branco: "Lar/B",
  laranja_preto: "Lar/P",
  verde_branco: "Ver/B",
  verde_preto: "Ver/P",
};

const BELT_COLORS: Record<string, string> = {
  branca: "#E5E5E5",
  cinza: "#9E9E9E",
  cinza_branco: "#BDBDBD",
  cinza_preto: "#616161",
  amarela: "#FDD835",
  amarela_branco: "#FFE082",
  amarela_preto: "#F9A825",
  laranja: "#F57C00",
  laranja_branco: "#FFB74D",
  laranja_preto: "#E65100",
  verde: "#388E3C",
  verde_branco: "#81C784",
  verde_preto: "#1B5E20",
  azul: "#1565C0",
  roxa: "#7B1FA2",
  marrom: "#5D4037",
  preta: "#212121",
};

function buildMonths(periodMonths: number): string[] {
  const today = new Date();
  return Array.from({ length: periodMonths }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    return d.toISOString().split("T")[0].slice(0, 7);
  }).reverse();
}

function monthLabel(month: string): string {
  return new Date(month + "-01").toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit",
  });
}

function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","),
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  children,
  loading,
  empty,
  height = 320,
}: {
  title: string;
  children: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  height?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {loading ? (
        <Skeleton className="w-full" style={{ height }} />
      ) : empty ? (
        <div
          className="flex flex-col items-center justify-center text-muted-foreground"
          style={{ height }}
        >
          <Inbox className="mb-2 h-8 w-8 opacity-50" />
          <span className="text-sm">Nenhum dado no período selecionado</span>
        </div>
      ) : (
        <div style={{ width: "100%", height }} className="max-md:!h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface FinancialRow {
  amount: number;
  status: string;
  reference_month: string | null;
  paid_at: string | null;
}
interface StudentRow {
  id: string;
  status: string;
  enrollment_date: string | null;
  birth_date: string | null;
}
interface AttendanceRow {
  student_id: string;
  class_date: string;
  present: boolean;
  schedule_id: string | null;
  class_schedules: { name: string } | { name: string }[] | null;
}
interface GraduationHistoryRow {
  new_belt: string;
  old_belt: string | null;
  promotion_date: string;
  student_id: string;
}
interface GraduationRow {
  belt: string;
  degrees: number;
  minimum_next_promotion_date: string | null;
  promotion_date: string;
}

function RelatoriosPage() {
  const { organizationId } = useAuth();
  const [periodMonths, setPeriodMonths] = useState(6);
  const [tab, setTab] = useState("financeiro");

  const months = useMemo(() => buildMonths(periodMonths), [periodMonths]);

  const [loading, setLoading] = useState(true);
  const [financialRecords, setFinancialRecords] = useState<FinancialRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [graduationHistory, setGraduationHistory] = useState<GraduationHistoryRow[]>([]);
  const [currentGraduations, setCurrentGraduations] = useState<GraduationRow[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const start = months[0] + "-01";
      const [finRes, stuRes, attRes, ghRes, gRes] = await Promise.all([
        supabase
          .from("financial_records")
          .select("amount, status, reference_month, paid_at")
          .eq("organization_id", organizationId)
          .gte("reference_month", start)
          .order("reference_month"),
        supabase
          .from("students")
          .select("id, status, enrollment_date, birth_date")
          .eq("organization_id", organizationId)
          .is("deleted_at", null),
        supabase
          .from("attendance")
          .select("student_id, class_date, present, schedule_id, class_schedules(name)")
          .eq("organization_id", organizationId)
          .gte("class_date", start)
          .order("class_date"),
        supabase
          .from("graduation_history")
          .select("new_belt, old_belt, promotion_date, student_id")
          .eq("organization_id", organizationId)
          .gte("promotion_date", start)
          .order("promotion_date"),
        supabase
          .from("graduations")
          .select("belt, degrees, minimum_next_promotion_date, promotion_date")
          .eq("organization_id", organizationId),
      ]);
      if (cancelled) return;
      setFinancialRecords((finRes.data ?? []) as FinancialRow[]);
      setStudents((stuRes.data ?? []) as StudentRow[]);
      setAttendance((attRes.data ?? []) as AttendanceRow[]);
      setGraduationHistory((ghRes.data ?? []) as GraduationHistoryRow[]);
      setCurrentGraduations((gRes.data ?? []) as GraduationRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, months]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Relatórios</h1>
        <Select
          value={String(periodMonths)}
          onValueChange={(v) => setPeriodMonths(Number(v))}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="alunos">Alunos</TabsTrigger>
          <TabsTrigger value="presencas">Presenças</TabsTrigger>
          <TabsTrigger value="graduacoes">Graduações</TabsTrigger>
        </TabsList>

        <TabsContent value="financeiro" className="mt-4">
          <FinanceiroTab
            loading={loading}
            months={months}
            financialRecords={financialRecords}
          />
        </TabsContent>
        <TabsContent value="alunos" className="mt-4">
          <AlunosTab loading={loading} months={months} students={students} />
        </TabsContent>
        <TabsContent value="presencas" className="mt-4">
          <PresencasTab loading={loading} months={months} attendance={attendance} />
        </TabsContent>
        <TabsContent value="graduacoes" className="mt-4">
          <GraduacoesTab
            loading={loading}
            months={months}
            graduationHistory={graduationHistory}
            currentGraduations={currentGraduations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ FINANCEIRO ============================ */

function FinanceiroTab({
  loading,
  months,
  financialRecords,
}: {
  loading: boolean;
  months: string[];
  financialRecords: FinancialRow[];
}) {
  const chartData = useMemo(
    () =>
      months.map((month) => {
        const records = financialRecords.filter(
          (r) => r.reference_month?.slice(0, 7) === month,
        );
        return {
          month: monthLabel(month),
          recebido: records
            .filter((r) => r.status === "paid")
            .reduce((s, r) => s + Number(r.amount), 0),
          pendente: records
            .filter((r) => r.status === "pending")
            .reduce((s, r) => s + Number(r.amount), 0),
          vencido: records
            .filter((r) => r.status === "overdue")
            .reduce((s, r) => s + Number(r.amount), 0),
        };
      }),
    [months, financialRecords],
  );

  const inadimplenciaData = useMemo(
    () =>
      months.map((month) => {
        const records = financialRecords.filter(
          (r) => r.reference_month?.slice(0, 7) === month,
        );
        const total = records.length;
        const overdue = records.filter((r) => r.status === "overdue").length;
        return {
          month: monthLabel(month),
          taxa: total > 0 ? Math.round((overdue / total) * 100) : 0,
        };
      }),
    [months, financialRecords],
  );

  const totals = useMemo(() => {
    const totalCobrado = financialRecords.reduce(
      (s, r) => s + Number(r.amount),
      0,
    );
    const paid = financialRecords.filter((r) => r.status === "paid");
    const totalRecebido = paid.reduce((s, r) => s + Number(r.amount), 0);
    const totalVencido = financialRecords
      .filter((r) => r.status === "overdue")
      .reduce((s, r) => s + Number(r.amount), 0);
    const ticketMedio = paid.length ? totalRecebido / paid.length : 0;
    return { totalCobrado, totalRecebido, totalVencido, ticketMedio };
  }, [financialRecords]);

  const isEmpty = !loading && financialRecords.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToCSV(chartData, "financeiro")}
        >
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total cobrado" value={formatBRL(totals.totalCobrado)} />
        <StatCard label="Total recebido" value={formatBRL(totals.totalRecebido)} />
        <StatCard label="Total vencido" value={formatBRL(totals.totalVencido)} />
        <StatCard label="Ticket médio" value={formatBRL(totals.ticketMedio)} />
      </div>

      <ChartCard title="Faturamento mensal" loading={loading} empty={isEmpty}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="month" />
          <YAxis tickFormatter={(v) => formatBRL(v as number)} width={90} />
          <Tooltip formatter={(v: number) => formatBRL(v)} />
          <Legend />
          <Bar dataKey="recebido" fill={COLORS.recebido} name="Recebido" />
          <Bar dataKey="pendente" fill={COLORS.pendente} name="Pendente" />
          <Bar dataKey="vencido" fill={COLORS.vencido} name="Vencido" />
        </BarChart>
      </ChartCard>

      <ChartCard title="Taxa de inadimplência mensal" loading={loading} empty={isEmpty}>
        <LineChart data={inadimplenciaData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="month" />
          <YAxis unit="%" />
          <Tooltip formatter={(v: number) => `${v}% de inadimplência`} />
          <Line
            type="monotone"
            dataKey="taxa"
            stroke={COLORS.vencido}
            strokeWidth={2}
          />
        </LineChart>
      </ChartCard>
    </div>
  );
}

/* ============================ ALUNOS ============================ */

function AlunosTab({
  loading,
  months,
  students,
}: {
  loading: boolean;
  months: string[];
  students: StudentRow[];
}) {
  const growthData = useMemo(
    () =>
      months.map((month) => {
        const monthEnd = new Date(month + "-01");
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        const activeCount = students.filter(
          (s) =>
            s.enrollment_date &&
            new Date(s.enrollment_date) <= monthEnd &&
            s.status === "active",
        ).length;
        return { month: monthLabel(month), alunos: activeCount };
      }),
    [months, students],
  );

  const statusData = useMemo(
    () => [
      {
        name: "Ativos",
        value: students.filter((s) => s.status === "active").length,
        color: COLORS.recebido,
      },
      {
        name: "Inativos",
        value: students.filter((s) => s.status === "inactive").length,
        color: COLORS.cinza,
      },
      {
        name: "Trial",
        value: students.filter((s) => s.status === "trial").length,
        color: COLORS.pendente,
      },
    ],
    [students],
  );

  const totalStatus = statusData.reduce((s, d) => s + d.value, 0);

  const ageData = useMemo(() => {
    const groups: Record<string, number> = {
      "4-10": 0,
      "11-15": 0,
      "16-17": 0,
      "18-29": 0,
      "30-39": 0,
      "40+": 0,
    };
    students
      .filter((s) => s.status === "active" && s.birth_date)
      .forEach((s) => {
        const age = Math.floor(
          (Date.now() - new Date(s.birth_date!).getTime()) /
            (1000 * 60 * 60 * 24 * 365.25),
        );
        if (age <= 10) groups["4-10"]++;
        else if (age <= 15) groups["11-15"]++;
        else if (age <= 17) groups["16-17"]++;
        else if (age <= 29) groups["18-29"]++;
        else if (age <= 39) groups["30-39"]++;
        else groups["40+"]++;
      });
    return Object.entries(groups).map(([faixa, count]) => ({ faixa, count }));
  }, [students]);

  const stats = useMemo(() => {
    const ativos = students.filter((s) => s.status === "active");
    const startBoundary = new Date(months[0] + "-01");
    const novos = students.filter(
      (s) => s.enrollment_date && new Date(s.enrollment_date) >= startBoundary,
    ).length;
    const idades = ativos
      .filter((s) => s.birth_date)
      .map(
        (s) =>
          (Date.now() - new Date(s.birth_date!).getTime()) /
          (1000 * 60 * 60 * 24 * 365.25),
      );
    const idadeMedia = idades.length
      ? Math.round(idades.reduce((a, b) => a + b, 0) / idades.length)
      : 0;
    const retencao = students.length
      ? Math.round((ativos.length / students.length) * 100)
      : 0;
    return { ativos: ativos.length, novos, idadeMedia, retencao };
  }, [students, months]);

  const isEmpty = !loading && students.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToCSV(growthData, "alunos_crescimento")}
        >
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Alunos ativos" value={stats.ativos} />
        <StatCard label="Novos no período" value={stats.novos} />
        <StatCard label="Idade média" value={`${stats.idadeMedia} anos`} />
        <StatCard label="Taxa de retenção" value={`${stats.retencao}%`} />
      </div>

      <ChartCard title="Crescimento de alunos" loading={loading} empty={isEmpty}>
        <AreaChart data={growthData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="month" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="alunos"
            stroke={COLORS.recebido}
            fill={COLORS.recebido}
            fillOpacity={0.2}
          />
        </AreaChart>
      </ChartCard>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Distribuição por status" loading={loading} empty={isEmpty}>
          <PieChart>
            <Pie
              data={statusData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={(d: { name?: string; value?: number }) => {
                const v = d.value ?? 0;
                const pct = totalStatus ? Math.round((v / totalStatus) * 100) : 0;
                return `${d.name}: ${v} (${pct}%)`;
              }}
            >
              {statusData.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ChartCard>

        <ChartCard
          title="Distribuição por faixa etária"
          loading={loading}
          empty={isEmpty}
        >
          <BarChart data={ageData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis dataKey="faixa" type="category" width={60} />
            <Tooltip />
            <Bar dataKey="count" fill={COLORS.azul} name="Alunos" />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  );
}

/* ============================ PRESENÇAS ============================ */

function PresencasTab({
  loading,
  months,
  attendance,
}: {
  loading: boolean;
  months: string[];
  attendance: AttendanceRow[];
}) {
  const attendanceData = useMemo(
    () =>
      months.map((month) => {
        const monthRecords = attendance.filter(
          (a) => a.class_date.slice(0, 7) === month,
        );
        return {
          month: monthLabel(month),
          presentes: monthRecords.filter((a) => a.present).length,
          faltas: monthRecords.filter((a) => !a.present).length,
        };
      }),
    [months, attendance],
  );

  const scheduleData = useMemo(() => {
    const bySchedule: Record<string, { p: number; f: number; name: string }> = {};
    attendance.forEach((a) => {
      const sched = a.class_schedules;
      const name = Array.isArray(sched)
        ? sched[0]?.name ?? "Sem turma"
        : sched?.name ?? "Sem turma";
      if (!bySchedule[name]) bySchedule[name] = { p: 0, f: 0, name };
      if (a.present) bySchedule[name].p++;
      else bySchedule[name].f++;
    });
    return Object.values(bySchedule)
      .map((s) => ({
        turma: s.name,
        taxa: s.p + s.f > 0 ? Math.round((s.p / (s.p + s.f)) * 100) : 0,
      }))
      .sort((a, b) => b.taxa - a.taxa);
  }, [attendance]);

  const stats = useMemo(() => {
    const totalPresencas = attendance.filter((a) => a.present).length;
    const taxaMedia = attendance.length
      ? Math.round((totalPresencas / attendance.length) * 100)
      : 0;
    const top = scheduleData[0];
    const lowAlunos = (() => {
      const perStudent: Record<string, { p: number; t: number }> = {};
      attendance.forEach((a) => {
        if (!perStudent[a.student_id]) perStudent[a.student_id] = { p: 0, t: 0 };
        perStudent[a.student_id].t++;
        if (a.present) perStudent[a.student_id].p++;
      });
      return Object.values(perStudent).filter(
        (s) => s.t > 0 && s.p / s.t < 0.5,
      ).length;
    })();
    return {
      totalPresencas,
      taxaMedia,
      topTurma: top ? `${top.turma} (${top.taxa}%)` : "—",
      lowAlunos,
    };
  }, [attendance, scheduleData]);

  const isEmpty = !loading && attendance.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToCSV(attendanceData, "presencas")}
        >
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total de presenças" value={stats.totalPresencas} />
        <StatCard label="Taxa média de frequência" value={`${stats.taxaMedia}%`} />
        <StatCard label="Maior frequência" value={stats.topTurma} />
        <StatCard label="Alunos <50%" value={stats.lowAlunos} />
      </div>

      <ChartCard title="Presenças por mês" loading={loading} empty={isEmpty}>
        <BarChart data={attendanceData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="month" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar
            dataKey="presentes"
            stackId="a"
            fill={COLORS.recebido}
            name="Presentes"
          />
          <Bar dataKey="faltas" stackId="a" fill="#FCA5A5" name="Faltas" />
        </BarChart>
      </ChartCard>

      <ChartCard
        title="Taxa de frequência por turma"
        loading={loading}
        empty={isEmpty}
        height={Math.max(240, scheduleData.length * 36 + 60)}
      >
        <BarChart data={scheduleData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis type="number" domain={[0, 100]} unit="%" />
          <YAxis dataKey="turma" type="category" width={120} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Bar dataKey="taxa" name="Frequência">
            {scheduleData.map((d, i) => (
              <Cell
                key={i}
                fill={
                  d.taxa >= 80
                    ? COLORS.recebido
                    : d.taxa >= 60
                      ? COLORS.pendente
                      : COLORS.vencido
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>
    </div>
  );
}

/* ============================ GRADUAÇÕES ============================ */

function GraduacoesTab({
  loading,
  months,
  graduationHistory,
  currentGraduations,
}: {
  loading: boolean;
  months: string[];
  graduationHistory: GraduationHistoryRow[];
  currentGraduations: GraduationRow[];
}) {
  const beltDist = useMemo(
    () =>
      BELT_ORDER.map((belt) => ({
        belt,
        faixa: BELT_LABELS[belt] ?? belt,
        count: currentGraduations.filter((g) => g.belt === belt).length,
      })).filter((d) => d.count > 0),
    [currentGraduations],
  );

  const promotionsData = useMemo(
    () =>
      months.map((month) => ({
        month: monthLabel(month),
        promocoes: graduationHistory.filter(
          (g) => g.promotion_date.slice(0, 7) === month,
        ).length,
      })),
    [months, graduationHistory],
  );

  const today = new Date().toISOString().split("T")[0];
  const beltTimeData = useMemo(
    () =>
      BELT_ORDER.map((belt) => {
        const grads = currentGraduations.filter((g) => g.belt === belt);
        if (!grads.length) return null;
        const avgDays =
          grads.reduce(
            (s, g) =>
              s +
              (Date.now() - new Date(g.promotion_date).getTime()) /
                (1000 * 60 * 60 * 24),
            0,
          ) / grads.length;
        return {
          faixa: BELT_LABELS[belt] ?? belt,
          alunos: grads.length,
          tempoMedio: Math.round(avgDays / 30),
          aptos: grads.filter(
            (g) =>
              g.minimum_next_promotion_date &&
              g.minimum_next_promotion_date <= today,
          ).length,
        };
      }).filter(Boolean) as Array<{
        faixa: string;
        alunos: number;
        tempoMedio: number;
        aptos: number;
      }>,
    [currentGraduations, today],
  );

  const stats = useMemo(() => {
    const totalPromo = graduationHistory.length;
    const top = [...beltDist].sort((a, b) => b.count - a.count)[0];
    const aptos = currentGraduations.filter(
      (g) =>
        g.minimum_next_promotion_date &&
        g.minimum_next_promotion_date <= today,
    ).length;
    const avgGeral = currentGraduations.length
      ? Math.round(
          currentGraduations.reduce(
            (s, g) =>
              s +
              (Date.now() - new Date(g.promotion_date).getTime()) /
                (1000 * 60 * 60 * 24 * 30),
            0,
          ) / currentGraduations.length,
        )
      : 0;
    return {
      totalPromo,
      topFaixa: top ? `${top.faixa} (${top.count})` : "—",
      aptos,
      avgGeral,
    };
  }, [graduationHistory, beltDist, currentGraduations, today]);

  const isEmpty = !loading && currentGraduations.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToCSV(beltTimeData, "graduacoes")}
        >
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Promoções no período" value={stats.totalPromo} />
        <StatCard label="Faixa com mais alunos" value={stats.topFaixa} />
        <StatCard label="Aptos para promoção" value={stats.aptos} />
        <StatCard label="Tempo médio geral" value={`${stats.avgGeral} meses`} />
      </div>

      <ChartCard
        title="Distribuição atual de faixas"
        loading={loading}
        empty={isEmpty}
      >
        <BarChart data={beltDist}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="faixa" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" name="Alunos">
            {beltDist.map((d, i) => (
              <Cell key={i} fill={BELT_COLORS[d.belt] ?? COLORS.azul} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>

      <ChartCard title="Promoções por mês" loading={loading} empty={!graduationHistory.length && !loading}>
        <BarChart data={promotionsData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="month" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="promocoes" fill={COLORS.azul} name="Promoções" />
        </BarChart>
      </ChartCard>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Tempo médio por faixa</h3>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : beltTimeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Inbox className="mb-2 h-8 w-8 opacity-50" />
            <span className="text-sm">Nenhum dado no período selecionado</span>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Faixa</TableHead>
                <TableHead className="text-right">Alunos</TableHead>
                <TableHead className="text-right">Tempo médio (meses)</TableHead>
                <TableHead className="text-right">Aptos p/ promoção</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {beltTimeData.map((row) => (
                <TableRow key={row.faixa}>
                  <TableCell className="font-medium">{row.faixa}</TableCell>
                  <TableCell className="text-right">{row.alunos}</TableCell>
                  <TableCell className="text-right">{row.tempoMedio}</TableCell>
                  <TableCell className="text-right">{row.aptos}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
