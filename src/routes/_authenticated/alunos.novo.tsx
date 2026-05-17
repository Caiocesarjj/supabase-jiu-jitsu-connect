import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
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

export const Route = createFileRoute("/_authenticated/alunos/novo")({
  component: NovoAlunoPage,
});

const BELTS: Belt[] = [
  "branca", "azul", "roxa", "marrom", "preta",
  "cinza_branco", "cinza", "cinza_preto",
  "amarela_branco", "amarela", "amarela_preto",
  "laranja_branco", "laranja", "laranja_preto",
  "verde_branco", "verde", "verde_preto",
];

function NovoAlunoPage() {
  const { organizationId } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("");
  const [belt, setBelt] = useState<Belt>("branca");
  const [degrees, setDegrees] = useState("0");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);

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
      const profileId = crypto.randomUUID();
      const today = new Date().toISOString().split("T")[0];

      const { error: e1 } = await supabase.from("profiles").insert({
        id: profileId,
        organization_id: organizationId,
        full_name: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        cpf: cpf.trim() || null,
        role: "aluno",
      });
      if (e1) throw e1;

      const studentPayload: Record<string, unknown> = {
        id: profileId,
        organization_id: organizationId,
        status,
        birth_date: birthDate || null,
        monthly_fee: monthlyFee ? Number(monthlyFee) : null,
        enrollment_date: today,
      };

      const { error: e2 } = await supabase.from("students").insert(studentPayload);
      if (e2) throw e2;

      const { error: e3 } = await supabase.from("graduations").insert({
        organization_id: organizationId,
        student_id: profileId,
        belt,
        degrees: Number(degrees) || 0,
        promotion_date: today,
        classes_since_promotion: 0,
      });
      if (e3) throw e3;

      toast.success("Aluno cadastrado com sucesso");
      navigate({ to: "/alunos/$alunoId", params: { alunoId: profileId } });
    } catch (err: any) {
      console.error("Erro ao cadastrar aluno:", err);
      toast.error(err?.message || "Erro ao cadastrar aluno");
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
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Matrícula</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="trial">Experimental</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
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
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Graduação inicial</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Faixa</Label>
              <Select value={belt} onValueChange={(v) => { setBelt(v as Belt); setDegrees("0"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BELTS.map((b) => (
                    <SelectItem key={b} value={b}>{getBeltLabel(b)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Grau</Label>
              <Select value={degrees} onValueChange={setDegrees}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from(
                    { length: belt === "preta" ? maxDeg : maxDeg + 1 },
                    (_, i) => (belt === "preta" ? i + 1 : i),
                  ).map((d) => (
                    <SelectItem key={d} value={String(d)}>{d}</SelectItem>
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
