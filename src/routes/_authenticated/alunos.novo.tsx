import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  createStudentRegistration,
  listSubscriptionPlansForOrg,
} from "@/lib/registrations.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Belt } from "@/types/database";
import { getBeltLabel } from "@/lib/graduation";
import { getWeightCategory, type Sex } from "@/lib/weight-category";

export const Route = createFileRoute("/_authenticated/alunos/novo")({
  component: NovoAlunoPage,
});


const BELTS: Belt[] = [
  "branca",
  "azul",
  "roxa",
  "marrom",
  "preta",
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
];

interface PlanOption {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "quarterly" | "semiannual" | "annual";
  active: boolean;
}

function NovoAlunoPage() {
  const { organizationId } = useAuth();
  const navigate = useNavigate();
  const createStudent = useServerFn(createStudentRegistration);
  const listPlans = useServerFn(listSubscriptionPlansForOrg);

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const [weightKg, setWeightKg] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("");
  const [belt, setBelt] = useState<Belt>("branca");
  const [degrees, setDegrees] = useState("0");
  const [status, setStatus] = useState("trial");
  const [planId, setPlanId] = useState<string>("");
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [saving, setSaving] = useState(false);

  const category = getWeightCategory({
    birthDate: birthDate || null,
    sex: sex || null,
    weightKg: weightKg ? Number(weightKg) : null,
  });

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) return;
        const res = await listPlans({ data: { accessToken, organizationId } });
        setPlans((res.plans as PlanOption[]).filter((p) => p.active));
      } catch {
        // silent
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const save = async () => {
    if (!organizationId) {
      toast.error("Organização não identificada");
      return;
    }
    if (!fullName.trim()) {
      toast.error("Nome completo é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      const result = await createStudent({
        data: {
          accessToken,
          organizationId,
          fullName: fullName.trim(),
          cpf: cpf.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          birthDate: birthDate || undefined,
          sex: sex || null,
          weightKg: weightKg ? Number(weightKg) : null,
          monthlyFee: monthlyFee ? Number(monthlyFee) : null,
          status: status as "active" | "trial" | "inactive",
          belt,
          degrees: Number(degrees) || 0,
          subscriptionPlanId: planId || null,
          validityDate: null,
        },
      });

      toast.success("Aluno cadastrado com sucesso");
      navigate({ to: "/alunos/$alunoId", params: { alunoId: result.studentId } });
    } catch (err: unknown) {
      console.error("Erro ao cadastrar aluno:", err);
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar aluno");
    } finally {
      setSaving(false);
    }
  };


  const maxDeg = belt === "preta" ? 10 : 4;

  return (
    <div className="space-y-4 max-w-3xl">
      <Link
        to="/alunos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Alunos
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Novo aluno</h1>
        <p className="text-sm text-muted-foreground">
          Preencha os dados básicos. Mais informações podem ser adicionadas depois.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Dados pessoais</h2>
          <div>
            <Label>Nome completo *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>CPF</Label>
              <Input value={cpf} onChange={(e) => setCpf(e.target.value)} />
            </div>
            <div>
              <Label>Data de nascimento</Label>
              <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Sexo</Label>
              <Select value={sex} onValueChange={(v) => setSex(v as Sex)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">Masculino</SelectItem>
                  <SelectItem value="F">Feminino</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Peso (kg)</Label>
              <Input
                type="number"
                step="0.1"
                inputMode="decimal"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                placeholder="ex: 72.5"
              />
            </div>
          </div>
          {category && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Categoria FBJJ: </span>
              <span className="font-medium text-emerald-800">{category.label}</span>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Matrícula</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Status inicial</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Experimental (aguardando 1º pagamento)</SelectItem>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Mantenha como Experimental até confirmar o primeiro pagamento (em dinheiro, cartão ou PIX na academia). Após registrar o pagamento, o aluno é ativado automaticamente.
              </p>
            </div>
            <div>
              <Label>Mensalidade (R$)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Padrão da academia"
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label>Plano</Label>
              <Select value={planId || "none"} onValueChange={(v) => setPlanId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={plans.length ? "Selecione um plano" : "Nenhum plano cadastrado"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem plano</SelectItem>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — R$ {p.amount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>


        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Graduação inicial</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Faixa</Label>
              <Select
                value={belt}
                onValueChange={(v) => {
                  setBelt(v as Belt);
                  setDegrees("0");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BELTS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {getBeltLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Grau</Label>
              <Select value={degrees} onValueChange={setDegrees}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: belt === "preta" ? maxDeg : maxDeg + 1 }, (_, i) =>
                    belt === "preta" ? i + 1 : i,
                  ).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => navigate({ to: "/alunos" })} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? "Salvando..." : "Cadastrar aluno"}
          </Button>
        </div>
      </div>
    </div>
  );
}
