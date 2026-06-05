import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Loader2, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  upsertSubscriptionPlan,
  toggleSubscriptionPlan,
  createSubscriptionRecord,
  updateSubscriptionStatus,
  listSubscriptionPlansForOrg,
  listSubscriptionRecordsForOrg,
  listStudentsForOrg,
  deleteSubscriptionPlan,
} from "@/lib/registrations.functions";
import { formatBRL, formatDateBR } from "@/lib/format";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmModal } from "@/components/ConfirmModal";
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

export const Route = createFileRoute("/_authenticated/financeiro/planos")({
  component: Page,
  head: () => ({ meta: [{ title: "Planos · Financeiro" }] }),
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
  new_amount_after: number | null;
  validity_months: number | null;
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
  enrollmentDate: string | null;
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
  const [planNewAmount, setPlanNewAmount] = useState("");
  const [planValidity, setPlanValidity] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  // Subscription modal
  const [subOpen, setSubOpen] = useState(false);
  const [subStudent, setSubStudent] = useState("");
  const [subPlan, setSubPlan] = useState("");
  const [subStart, setSubStart] = useState(todayISO());
  const [subNext, setSubNext] = useState("");
  const [savingSub, setSavingSub] = useState(false);

  const listPlansFn = useServerFn(listSubscriptionPlansForOrg);
  const listSubsFn = useServerFn(listSubscriptionRecordsForOrg);
  const listStudentsFn = useServerFn(listStudentsForOrg);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");
      const [plansRes, subsRes, studentsRes] = await Promise.all([
        listPlansFn({ data: { accessToken, organizationId } }),
        listSubsFn({ data: { accessToken, organizationId } }),
        listStudentsFn({ data: { accessToken, organizationId } }),
      ]);
      setPlans((plansRes.plans as Plan[]) ?? []);
      setSubs((subsRes.subscriptions as unknown as Subscription[]) ?? []);
      const opts = ((studentsRes.students as unknown as Array<{
        id: string;
        enrollment_date: string | null;
        profiles: { full_name: string } | null;
      }>) ?? [])
        .map((s) => ({ id: s.id, name: s.profiles?.full_name ?? "—", enrollmentDate: s.enrollment_date }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setStudents(opts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
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
    setPlanNewAmount("");
    setPlanValidity("");
    setPlanOpen(true);
  };

  const openEditPlan = (p: Plan) => {
    setEditingPlan(p);
    setPlanName(p.name);
    setPlanAmount(String(p.amount));
    setPlanFreq(p.frequency);
    setPlanDesc(p.description ?? "");
    setPlanNewAmount(p.new_amount_after != null ? String(p.new_amount_after) : "");
    setPlanValidity(p.validity_months != null ? String(p.validity_months) : "");
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
          newAmountAfter: planNewAmount ? Number(planNewAmount) : null,
          validityMonths: planValidity ? Number(planValidity) : null,
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
    setSubNext(todayISO());
    setSubOpen(true);
  };

  // Usa a data de cadastro do aluno + frequência/dia de vencimento do plano.
  useEffect(() => {
    if (!subStudent) return;
    const student = students.find((item) => item.id === subStudent);
    const enrollmentDate = student?.enrollmentDate || todayISO();
    setSubStart(enrollmentDate);
    const plan = plans.find((p) => p.id === subPlan);
    if (!plan) { setSubNext(enrollmentDate); return; }
    const monthsToAdd = FREQ_MONTHS[plan.frequency];
    const base = new Date(`${enrollmentDate}T00:00:00`);
    const target = new Date(base.getFullYear(), base.getMonth() + monthsToAdd, 1);
    const dueDay = plan.validity_months ?? base.getDate();
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const day = Math.min(Math.max(dueDay, 1), lastDay);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    setSubNext(`${yyyy}-${mm}-${dd}`);
  }, [subStudent, subPlan, students, plans]);

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

      {/* Planos section with button */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Planos cadastrados</h2>
          <Button onClick={openNewPlan}>
            <Plus className="mr-2 h-4 w-4" /> Novo Plano
          </Button>
        </div>

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
                {(p.validity_months != null || p.new_amount_after != null) && (
                  <div className="text-xs bg-muted/50 p-2 rounded border border-border space-y-0.5">
                    {p.validity_months != null && (
                      <div><strong>Dia de vencimento:</strong> todo dia {p.validity_months}</div>
                    )}
                    {p.new_amount_after != null && (
                      <div><strong>Valor após a validade:</strong> {formatBRL(Number(p.new_amount_after))}</div>
                    )}
                  </div>
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

      {/* Subscriptions table */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Assinaturas</h2>
          <Button variant="outline" onClick={openNewSub} disabled={plans.filter((p) => p.active).length === 0}>
            <Plus className="mr-2 h-4 w-4" /> Nova assinatura
          </Button>
        </div>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Dia de vencimento (1-31)</Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  max="31"
                  value={planValidity}
                  onChange={(e) => setPlanValidity(e.target.value)}
                  placeholder="Ex: 10"
                />
              </div>
              <div>
                <Label>Valor após a validade (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={planNewAmount}
                  onChange={(e) => setPlanNewAmount(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              O dia de vencimento define em que dia do mês a cobrança vence. O próximo vencimento é calculado automaticamente a partir da data de cadastro do aluno e da frequência do plano.
            </p>
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
                <Label>Data de cadastro do aluno</Label>
                <Input
                  type="date"
                  value={subStart}
                  readOnly
                />
              </div>
              <div>
                <Label>Vencimento da cobrança</Label>
                <Input
                  type="date"
                  value={subNext}
                  readOnly
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
