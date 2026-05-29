import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  upsertSubscriptionPlan,
  toggleSubscriptionPlan,
  createSubscriptionRecord,
  updateSubscriptionStatus,
} from "@/lib/registrations.functions";
import { formatBRL, formatDateBR } from "@/lib/format";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/financeiro/recorrentes")({
  component: Page,
  head: () => ({ meta: [{ title: "Recorrentes · Financeiro" }] }),
});

type Frequency = "monthly" | "quarterly" | "semiannual" | "annual";
type SubStatus = "active" | "paused" | "canceled" | "expired";

const FREQ_LABEL: Record<Frequency, string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

const FREQ_MONTHS: Record<Frequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

const STATUS_LABEL: Record<SubStatus, string> = {
  active: "Ativa",
  paused: "Pausada",
  canceled: "Cancelada",
  expired: "Expirada",
};

const STATUS_STYLE: Record<SubStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  paused: "bg-yellow-100 text-yellow-800 border-yellow-300",
  canceled: "bg-gray-100 text-gray-700 border-gray-300",
  expired: "bg-red-100 text-red-800 border-red-300",
};

interface Plan {
  id: string;
  name: string;
  amount: number;
  frequency: Frequency;
  description: string | null;
  active: boolean;
}

interface Subscription {
  id: string;
  status: SubStatus;
  started_at: string | null;
  next_due_date: string | null;
  notes: string | null;
  plan_id: string;
  student_id: string;
  subscription_plans: {
    name: string;
    amount: number;
    frequency: Frequency;
  } | null;
  students: {
    id: string;
    profiles: { full_name: string; phone: string | null } | null;
  } | null;
}

interface StudentOption {
  id: string;
  name: string;
}

function StatusBadge({ status }: { status: SubStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function monthlyEquivalent(amount: number, freq: Frequency): number {
  return amount / FREQ_MONTHS[freq];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function Page() {
  const { organizationId } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Plan modal
  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planName, setPlanName] = useState("");
  const [planAmount, setPlanAmount] = useState("");
  const [planFreq, setPlanFreq] = useState<Frequency>("monthly");
  const [planDesc, setPlanDesc] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  // Subscription modal
  const [subOpen, setSubOpen] = useState(false);
  const [subStudent, setSubStudent] = useState("");
  const [subPlan, setSubPlan] = useState("");
  const [subStart, setSubStart] = useState(todayISO());
  const [subNext, setSubNext] = useState("");
  const [savingSub, setSavingSub] = useState(false);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const [plansRes, subsRes, studentsRes] = await Promise.all([
      supabase
        .from("subscription_plans")
        .select("id, name, amount, frequency, description, active")
        .eq("organization_id", organizationId)
        .order("amount"),
      supabase
        .from("subscription_records")
        .select(
          `id, status, started_at, next_due_date, notes, plan_id, student_id,
           subscription_plans ( name, amount, frequency ),
           students ( id, profiles ( full_name, phone ) )`,
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("students")
        .select("id, profiles ( full_name )")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
    ]);

    if (plansRes.error) toast.error("Erro ao carregar planos");
    else setPlans((plansRes.data as Plan[]) ?? []);

    if (subsRes.error) toast.error("Erro ao carregar assinaturas");
    else setSubs((subsRes.data as unknown as Subscription[]) ?? []);

    if (!studentsRes.error) {
      const opts = ((studentsRes.data as unknown as Array<{
        id: string;
        profiles: { full_name: string } | null;
      }>) ?? [])
        .map((s) => ({ id: s.id, name: s.profiles?.full_name ?? "—" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setStudents(opts);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const summary = useMemo(() => {
    const active = subs.filter((s) => s.status === "active");
    const mrr = active.reduce((acc, s) => {
      if (!s.subscription_plans) return acc;
      return acc + monthlyEquivalent(Number(s.subscription_plans.amount), s.subscription_plans.frequency);
    }, 0);
    const today = todayISO();
    const overdue = active.filter((s) => s.next_due_date && s.next_due_date < today).length;
    const total = subs.length;
    const successRate = total === 0 ? 0 : (active.length / total) * 100;
    return { activeCount: active.length, mrr, overdue, successRate };
  }, [subs]);

  // ---- Plan handlers ----
  const openNewPlan = () => {
    setEditingPlan(null);
    setPlanName("");
    setPlanAmount("");
    setPlanFreq("monthly");
    setPlanDesc("");
    setPlanOpen(true);
  };

  const openEditPlan = (p: Plan) => {
    setEditingPlan(p);
    setPlanName(p.name);
    setPlanAmount(String(p.amount));
    setPlanFreq(p.frequency);
    setPlanDesc(p.description ?? "");
    setPlanOpen(true);
  };

  const upsertPlanFn = useServerFn(upsertSubscriptionPlan);
  const togglePlanFn = useServerFn(toggleSubscriptionPlan);
  const createSubFn = useServerFn(createSubscriptionRecord);
  const updateSubStatusFn = useServerFn(updateSubscriptionStatus);

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (!t) throw new Error("Sessão inválida. Faça login novamente.");
    return t;
  };

  const savePlan = async () => {
    if (!organizationId) return;
    if (!planName.trim() || !planAmount) {
      toast.error("Nome e valor são obrigatórios");
      return;
    }
    setSavingPlan(true);
    try {
      const accessToken = await getToken();
      await upsertPlanFn({
        data: {
          accessToken,
          organizationId,
          planId: editingPlan?.id ?? null,
          name: planName.trim(),
          amount: Number(planAmount),
          frequency: planFreq,
          description: planDesc.trim() || null,
        },
      });
      toast.success(editingPlan ? "Plano atualizado" : "Plano criado");
      setPlanOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
    setSavingPlan(false);
  };

  const togglePlanActive = async (p: Plan) => {
    try {
      const accessToken = await getToken();
      await togglePlanFn({
        data: { accessToken, organizationId: organizationId!, planId: p.id, active: !p.active },
      });
      toast.success(p.active ? "Plano desativado" : "Plano ativado");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    }
  };

  // ---- Subscription handlers ----
  const openNewSub = () => {
    setSubStudent("");
    setSubPlan("");
    setSubStart(todayISO());
    setSubNext("");
    setSubOpen(true);
  };

  // Auto compute next due when plan or start changes
  useEffect(() => {
    if (!subPlan || !subStart) return;
    const p = plans.find((pp) => pp.id === subPlan);
    if (!p) return;
    const next = addMonths(new Date(subStart + "T00:00:00"), FREQ_MONTHS[p.frequency]);
    setSubNext(next.toISOString().slice(0, 10));
  }, [subPlan, subStart, plans]);

  const saveSub = async () => {
    if (!organizationId) return;
    if (!subStudent || !subPlan || !subStart || !subNext) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSavingSub(true);
    try {
      const accessToken = await getToken();
      await createSubFn({
        data: {
          accessToken,
          organizationId,
          studentId: subStudent,
          planId: subPlan,
          startedAt: subStart,
          nextDueDate: subNext,
        },
      });
      toast.success("Assinatura criada");
      setSubOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    }
    setSavingSub(false);
  };

  const changeStatus = async (s: Subscription, status: SubStatus) => {
    try {
      const accessToken = await getToken();
      await updateSubStatusFn({
        data: { accessToken, organizationId: organizationId!, subscriptionId: s.id, status },
      });
      toast.success(`Assinatura ${STATUS_LABEL[status].toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    }
  };


  if (loading) return <LoadingSpinner label="Carregando..." />;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Assinaturas ativas" value={String(summary.activeCount)} tone="emerald" />
        <StatCard label="Receita mensal recorrente" value={formatBRL(summary.mrr)} tone="blue" />
        <StatCard label="Com pagamento atrasado" value={String(summary.overdue)} tone="red" />
        <StatCard
          label="Taxa de sucesso"
          value={`${summary.successRate.toFixed(0)}%`}
          tone="violet"
        />
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" onClick={openNewPlan}>
          <Plus className="mr-2 h-4 w-4" /> Novo Plano
        </Button>
        <Button onClick={openNewSub} disabled={plans.filter((p) => p.active).length === 0}>
          <Plus className="mr-2 h-4 w-4" /> Nova Assinatura
        </Button>
      </div>

      {/* Subscriptions table */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Assinaturas</h2>
        {subs.length === 0 ? (
          <EmptyState
            title="Nenhuma assinatura"
            description="Crie um plano e adicione uma assinatura para começar."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Aluno</th>
                  <th className="px-3 py-2">Plano</th>
                  <th className="px-3 py-2">Valor</th>
                  <th className="px-3 py-2">Frequência</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Próximo Vencimento</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const name = s.students?.profiles?.full_name ?? "—";
                  const plan = s.subscription_plans;
                  return (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2">{plan?.name ?? "—"}</td>
                      <td className="px-3 py-2">{plan ? formatBRL(Number(plan.amount)) : "—"}</td>
                      <td className="px-3 py-2">{plan ? FREQ_LABEL[plan.frequency] : "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-3 py-2">
                        {s.next_due_date ? formatDateBR(s.next_due_date) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {s.status !== "active" && (
                              <DropdownMenuItem onClick={() => changeStatus(s, "active")}>
                                Reativar
                              </DropdownMenuItem>
                            )}
                            {s.status === "active" && (
                              <DropdownMenuItem onClick={() => changeStatus(s, "paused")}>
                                Pausar
                              </DropdownMenuItem>
                            )}
                            {s.status !== "canceled" && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => changeStatus(s, "canceled")}
                              >
                                Cancelar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Plans list */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Planos cadastrados</h2>
        {plans.length === 0 ? (
          <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
            Nenhum plano cadastrado.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "rounded-md border bg-card p-4 space-y-2",
                  !p.active && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {FREQ_LABEL[p.frequency]}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatBRL(Number(p.amount))}</div>
                    {!p.active && (
                      <span className="text-[10px] uppercase text-muted-foreground">Inativo</span>
                    )}
                  </div>
                </div>
                {p.description && (
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => openEditPlan(p)}>
                    <Pencil className="h-3 w-3 mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => togglePlanActive(p)}>
                    {p.active ? "Desativar" : "Ativar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plan modal */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Editar plano" : "Novo plano"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={planName} onChange={(e) => setPlanName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={planAmount}
                  onChange={(e) => setPlanAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Frequência</Label>
                <Select value={planFreq} onValueChange={(v) => setPlanFreq(v as Frequency)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="quarterly">Trimestral</SelectItem>
                    <SelectItem value="semiannual">Semestral</SelectItem>
                    <SelectItem value="annual">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea
                rows={3}
                value={planDesc}
                onChange={(e) => setPlanDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOpen(false)} disabled={savingPlan}>
              Cancelar
            </Button>
            <Button onClick={savePlan} disabled={savingPlan}>
              {savingPlan && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subscription modal */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova assinatura</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Aluno</Label>
              <Select value={subStudent} onValueChange={setSubStudent}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um aluno" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Plano</Label>
              <Select value={subPlan} onValueChange={setSubPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um plano" />
                </SelectTrigger>
                <SelectContent>
                  {plans
                    .filter((p) => p.active)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {formatBRL(Number(p.amount))} ({FREQ_LABEL[p.frequency]})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data de início</Label>
                <Input
                  type="date"
                  value={subStart}
                  onChange={(e) => setSubStart(e.target.value)}
                />
              </div>
              <div>
                <Label>Próximo vencimento</Label>
                <Input
                  type="date"
                  value={subNext}
                  onChange={(e) => setSubNext(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubOpen(false)} disabled={savingSub}>
              Cancelar
            </Button>
            <Button onClick={saveSub} disabled={savingSub}>
              {savingSub && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "blue" | "red" | "violet";
}) {
  const tones: Record<string, string> = {
    emerald: "text-emerald-700",
    blue: "text-blue-700",
    red: "text-red-700",
    violet: "text-violet-700",
  };
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1", tones[tone])}>{value}</div>
    </div>
  );
}
