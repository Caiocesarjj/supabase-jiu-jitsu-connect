import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  MoreHorizontal,
  AlertCircle,
  Search,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { generateMonthlyCharges } from "@/lib/registrations.functions";
import { formatBRL, formatDateBR } from "@/lib/format";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar } from "@/components/Avatar";
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
import type { FinancialStatus } from "@/types/database";

export const Route = createFileRoute("/_authenticated/financeiro/mensalidades")({
  component: FinanceiroPage,
  head: () => ({ meta: [{ title: "Financeiro — JJ Manager" }] }),
});

interface Record {
  id: string;
  amount: number;
  discount_amount: number | null;
  fine_amount: number | null;
  due_date: string;
  paid_at: string | null;
  status: FinancialStatus;
  payment_method: string | null;
  pix_code: string | null;
  invoice_url: string | null;
  reference_month: string | null;
  notifications_sent: unknown;
  created_at: string;
  students: {
    id: string;
    profiles: { full_name: string } | null;
  } | null;
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const MONTH_SHORT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  // next month + last 12 months
  for (let i = 1; i >= -12; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    opts.push({
      value: key,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return opts.reverse(); // most recent first
}

function refMonthLabel(ref: string | null): string {
  if (!ref) return "—";
  const [y, m] = ref.split("-");
  const mi = parseInt(m, 10) - 1;
  if (isNaN(mi)) return ref;
  return `${MONTH_SHORT[mi]} ${y}`;
}

function isOverdueDate(due: string, status: FinancialStatus) {
  if (status !== "overdue") return false;
  return new Date(due) < new Date();
}

function FinanceiroPage() {
  const { organizationId } = useAuth();
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(currentMonthKey());
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [payRecord, setPayRecord] = useState<Record | null>(null);
  const [cancelRecord, setCancelRecord] = useState<Record | null>(null);
  const [revertRecord, setRevertRecord] = useState<Record | null>(null);
  const [generating, setGenerating] = useState(false);
  const generateCharges = useServerFn(generateMonthlyCharges);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const initial = sp.get("status");
    if (initial) setFilterStatus(initial);
  }, []);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("financial_records")
      .select(
        `id, amount, discount_amount, fine_amount, due_date, paid_at,
         status, payment_method, pix_code, invoice_url,
         reference_month, notifications_sent, created_at,
         students ( id, profiles ( full_name ) )`,
      )
      .eq("organization_id", organizationId)
      .order("due_date", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Erro ao carregar registros financeiros.");
      console.error(error);
    } else {
      setRecords((data as unknown as Record[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const month = r.reference_month?.slice(0, 7);
      const matchMonth = month === filterMonth;
      const matchStatus = filterStatus === "all" || r.status === filterStatus;
      const name = r.students?.profiles?.full_name?.toLowerCase() ?? "";
      const matchSearch = name.includes(filterSearch.toLowerCase());
      return matchMonth && matchStatus && matchSearch;
    });
  }, [records, filterMonth, filterStatus, filterSearch]);

  const totals = useMemo(() => {
    const cobrado = filtered.reduce((s, r) => s + Number(r.amount), 0);
    const pago = filtered
      .filter((r) => r.status === "paid")
      .reduce((s, r) => s + Number(r.amount), 0);
    const pendente = filtered
      .filter((r) => r.status === "pending")
      .reduce((s, r) => s + Number(r.amount), 0);
    const vencido = filtered
      .filter((r) => r.status === "overdue")
      .reduce((s, r) => s + Number(r.amount), 0);
    return { cobrado, pago, pendente, vencido };
  }, [filtered]);

  const handleCopyPix = (code: string | null) => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    toast.success("Código PIX copiado!");
  };

  const handleGenerateCharges = async () => {
    if (!organizationId) return;
    setGenerating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      const result = await generateCharges({ data: { accessToken, organizationId, referenceMonth: filterMonth } });
      toast.success(`${result.count} cobranças geradas para o mês selecionado.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar cobranças.");
    }
    setGenerating(false);
  };

  const handleCancel = async () => {
    if (!cancelRecord) return;
    const { error } = await supabase
      .from("financial_records")
      .update({ status: "canceled" })
      .eq("id", cancelRecord.id);
    if (error) toast.error(error.message);
    else toast.success("Cobrança cancelada.");
    setCancelRecord(null);
    await load();
  };

  const handleRevert = async () => {
    if (!revertRecord) return;
    const { error } = await supabase
      .from("financial_records")
      .update({ status: "pending", paid_at: null })
      .eq("id", revertRecord.id);
    if (error) toast.error(error.message);
    else toast.success("Pagamento estornado.");
    setRevertRecord(null);
    await load();
  };

  const handleReactivate = async (r: Record) => {
    const { error } = await supabase
      .from("financial_records")
      .update({ status: "pending" })
      .eq("id", r.id);
    if (error) toast.error(error.message);
    else toast.success("Cobrança reativada.");
    await load();
  };

  return (
    <div className="space-y-6">
      {/* (Header e sub-nav vivem no layout pai /financeiro) */}


      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total cobrado" value={totals.cobrado} tone="gray" />
        <SummaryCard label="Pago" value={totals.pago} tone="green" />
        <SummaryCard label="Pendente" value={totals.pendente} tone="yellow" />
        <SummaryCard label="Vencido" value={totals.vencido} tone="red" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="space-y-1">
            <Label className="text-xs">Mês</Label>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions().map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="overdue">Vencido</SelectItem>
                <SelectItem value="canceled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Buscar aluno</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8 w-[220px]"
                placeholder="Nome do aluno"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>


      {/* Records table */}
      {loading ? (
        <LoadingSpinner label="Carregando..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nenhuma cobrança"
          description="Não há registros para o mês e filtros selecionados."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Aluno</th>
                <th className="px-3 py-2">Referência</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Vencimento</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const name = r.students?.profiles?.full_name ?? "—";
                const studentId = r.students?.id;
                const disc = Number(r.discount_amount ?? 0);
                const finalAmount = Number(r.amount) - disc;
                const overdue =
                  r.status === "overdue" || isOverdueDate(r.due_date, r.status);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {studentId ? (
                        <Link
                          to="/alunos/$alunoId"
                          params={{ alunoId: studentId }}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <Avatar name={name} size={28} />
                          <span>{name}</span>
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Avatar name={name} size={28} />
                          <span>{name}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">{refMonthLabel(r.reference_month)}</td>
                    <td className="px-3 py-2">
                      {disc > 0 ? (
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground line-through">
                            {formatBRL(Number(r.amount))}
                          </span>
                          <span>{formatBRL(finalAmount)}</span>
                        </div>
                      ) : (
                        formatBRL(Number(r.amount))
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div
                        className={`flex items-center gap-1 ${overdue ? "text-red-600" : ""}`}
                      >
                        {overdue && <AlertCircle className="h-4 w-4" />}
                        {formatDateBR(r.due_date)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(r.status === "pending" || r.status === "overdue") && (
                            <>
                              <DropdownMenuItem
                                disabled={!r.pix_code}
                                onClick={() => handleCopyPix(r.pix_code)}
                              >
                                Copiar código PIX
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setPayRecord(r)}>
                                Registrar pagamento
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setCancelRecord(r)}
                              >
                                Cancelar cobrança
                              </DropdownMenuItem>
                            </>
                          )}
                          {r.status === "paid" && (
                            <>
                              <DropdownMenuItem
                                disabled={!r.invoice_url}
                                onClick={() =>
                                  r.invoice_url &&
                                  window.open(r.invoice_url, "_blank")
                                }
                              >
                                Ver recibo
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setRevertRecord(r)}>
                                Estornar pagamento
                              </DropdownMenuItem>
                            </>
                          )}
                          {r.status === "canceled" && (
                            <DropdownMenuItem onClick={() => handleReactivate(r)}>
                              Reativar cobrança
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

      {/* Cobranças são geradas automaticamente pelo cron no dia 1 do mês */}


      {/* Cancel confirm */}
      <ConfirmModal
        open={!!cancelRecord}
        onOpenChange={(o) => !o && setCancelRecord(null)}
        title="Cancelar cobrança"
        description={`Cancelar a cobrança de ${cancelRecord?.students?.profiles?.full_name ?? ""}?`}
        destructive
        confirmLabel="Cancelar cobrança"
        onConfirm={handleCancel}
      />

      {/* Revert confirm */}
      <ConfirmModal
        open={!!revertRecord}
        onOpenChange={(o) => !o && setRevertRecord(null)}
        title="Estornar pagamento"
        description="Marcar como pendente novamente?"
        onConfirm={handleRevert}
      />

      {/* Manual payment modal */}
      <PaymentModal
        record={payRecord}
        onClose={() => setPayRecord(null)}
        onSaved={async () => {
          setPayRecord(null);
          await load();
        }}
        organizationId={organizationId}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "gray" | "green" | "yellow" | "red";
}) {
  const toneClass = {
    gray: "border-border bg-card",
    green: "border-emerald-200 bg-emerald-50",
    yellow: "border-yellow-200 bg-yellow-50",
    red: "border-red-200 bg-red-50",
  }[tone];
  const textClass = {
    gray: "text-foreground",
    green: "text-emerald-700",
    yellow: "text-yellow-700",
    red: "text-red-700",
  }[tone];
  return (
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${textClass}`}>
        {formatBRL(value)}
      </div>
    </div>
  );
}

function PaymentModal({
  record,
  onClose,
  onSaved,
  organizationId,
}: {
  record: Record | null;
  onClose: () => void;
  onSaved: () => void;
  organizationId: string | null;
}) {
  const [method, setMethod] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (record) {
      setMethod("");
      setDate(new Date().toISOString().slice(0, 10));
      setNotes("");
    }
  }, [record]);

  if (!record) return null;
  const name = record.students?.profiles?.full_name ?? "";

  const handleSave = async () => {
    if (!method) {
      toast.error("Selecione o método de pagamento.");
      return;
    }
    setSaving(true);
    try {
      const { error: e1 } = await supabase
        .from("financial_records")
        .update({
          status: "paid",
          paid_at: new Date(date).toISOString(),
          payment_method: method,
        })
        .eq("id", record.id);
      if (e1) throw e1;
      await supabase.from("payment_logs").insert({
        organization_id: organizationId,
        financial_record_id: record.id,
        event_type: "paid_manual",
        payload: { method, notes },
      });
      toast.success(`Pagamento de ${name} registrado com sucesso.`);
      onSaved();
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message ?? "Erro ao registrar pagamento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Registrar pagamento de {name} — {formatBRL(Number(record.amount))}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Método de pagamento *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="debit_card">Cartão de débito</SelectItem>
                <SelectItem value="credit_card">Cartão de crédito</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Data do pagamento</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
