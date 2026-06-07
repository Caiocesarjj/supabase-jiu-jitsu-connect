import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, UserPlus, Trash2, MoreHorizontal, Copy, Pencil, Plus, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  getStudentSubscription,
  listSubscriptionPlansForOrg,
  createSubscriptionRecord,
  getStudentChargeForWhatsapp,
  sendIndividualWhatsappCharge,
  listWhatsappMessageLogs,
} from "@/lib/registrations.functions";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/Avatar";
import { BeltBadge } from "@/components/BeltBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmModal } from "@/components/ConfirmModal";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateBR, formatBRL } from "@/lib/format";
import {
  calcMinNextPromotionDate,
  getAvailableBeltsForPromotion,
  getBeltLabel,
  getMaxDegrees,
  BLACK_BELT_DEGREE_YEARS,
} from "@/lib/graduation";
import type { Belt } from "@/types/database";
import { TurmasTab } from "@/components/EnrollmentPanels";
import { getWeightCategory, type Sex } from "@/lib/weight-category";

export const Route = createFileRoute("/_authenticated/alunos/$alunoId")({
  component: AlunoFichaPage,
});

// ---------- Helpers ----------
function todayISO() {
  return new Date().toISOString().split("T")[0];
}
function diffDays(a: string, b: string) {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((da - db) / (1000 * 60 * 60 * 24));
}
function calcAge(birth: string | null) {
  if (!birth) return null;
  const b = new Date(birth);
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
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

function StudentStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Ativo", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    inactive: { label: "Inativo", cls: "bg-gray-100 text-gray-700 border-gray-300" },
    suspended: { label: "Suspenso", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
    trial: { label: "Experimental", cls: "bg-blue-100 text-blue-800 border-blue-300" },
  };
  const cfg = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-700 border-gray-300" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ---------- Page ----------
function AlunoFichaPage() {
  const { alunoId } = Route.useParams();
  const { organizationId, userRole, user } = useAuth();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!organizationId) return;
    setDeleting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      const { deleteStudentRegistration } = await import("@/lib/registrations.functions");
      await deleteStudentRegistration({
        data: { accessToken, organizationId, studentId: alunoId },
      });
      toast.success("Aluno excluído");
      navigate({ to: "/alunos" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao excluir aluno");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [financial, setFinancial] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("students")
        .select(
          `
          id, status, birth_date, sex, weight, medical_notes, monthly_fee, enrollment_date,
          profiles ( id, full_name, email, phone, cpf ),
          graduations (
            id, belt, degrees, promotion_date, minimum_next_promotion_date, classes_since_promotion
          ),
          graduation_history (
            id, old_belt, new_belt, old_degrees, new_degrees, promotion_date, notes, previous_instructor, previous_team, created_at
          ),
          student_guardians (
            id, relationship_type, primary_contact,
            guardians (
              id, financial_responsible, legal_responsible,
              profiles ( id, full_name, email, phone, cpf )
            )
          )
        `,
        )
        .eq("id", alunoId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        toast.error("Aluno não encontrado");
        navigate({ to: "/alunos" });
        return;
      }

      setStudent(data);

      const [fin, att] = await Promise.all([
        supabase
          .from("financial_records")
          .select("*")
          .eq("student_id", alunoId)
          .order("due_date", { ascending: false })
          .limit(24),
        supabase
          .from("attendance")
          .select("id, class_date, present, class_schedules(name)")
          .eq("student_id", alunoId)
          .order("class_date", { ascending: false })
          .limit(90),
      ]);

      if (cancelled) return;
      if (fin.error) toast.error("Erro ao carregar financeiro");
      if (att.error) toast.error("Erro ao carregar presenças");
      setFinancial(fin.data ?? []);
      setAttendance(att.data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [alunoId, organizationId, reloadKey, navigate]);

  const reload = () => setReloadKey((k) => k + 1);

  if (loading || !student) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando aluno..." />
      </div>
    );
  }

  const profile = student.profiles ?? {};
  const grad = Array.isArray(student.graduations)
    ? student.graduations[0]
    : student.graduations;
  const currentBelt: Belt = grad?.belt ?? "branca";
  const currentDegrees: number = grad?.degrees ?? 0;
  const age = calcAge(student.birth_date);
  const isAptForPromotion =
    grad?.minimum_next_promotion_date &&
    new Date(grad.minimum_next_promotion_date) <= new Date();

  const canPromote = userRole === "admin" || userRole === "instructor";

  return (
    <div className="space-y-4">
      {/* Back */}
      <Link to="/alunos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Alunos
      </Link>

      {/* Header card */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={profile.full_name ?? "?"} size={64} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 style={{ fontSize: 20, fontWeight: 500 }}>{profile.full_name ?? "Sem nome"}</h1>
              <BeltBadge belt={currentBelt} size="lg" />
              <DegreeDots degrees={currentDegrees} size={10} />
              <StudentStatusBadge status={student.status} />
              {isAptForPromotion && (
                <span className="inline-flex items-center rounded-full border border-emerald-400 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 animate-pulse">
                  Apto para promoção
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {[
                profile.cpf,
                profile.phone,
                student.enrollment_date && `Matrícula desde ${formatDateBR(student.enrollment_date)}`,
                age != null && age < 18 && "Menor de idade",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          {(userRole === "admin" || userRole === "instructor") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1 h-4 w-4" /> Excluir aluno
            </Button>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
        title="Excluir aluno?"
        description="Esta ação remove o aluno e todos os dados relacionados (presenças, financeiro, graduações). Não pode ser desfeita."
        confirmLabel={deleting ? "Excluindo..." : "Excluir"}
        destructive
        onConfirm={handleDelete}
      />

      <Tabs defaultValue="geral" className="space-y-4">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="graduacao">Graduação</TabsTrigger>
          <TabsTrigger value="turmas">Turmas</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="presenca">Presença</TabsTrigger>
          <TabsTrigger value="mensagens">Mensagens</TabsTrigger>
          <TabsTrigger value="observacoes">Observações</TabsTrigger>
        </TabsList>

        <TabsContent value="geral">
          <GeralTab student={student} age={age} onChange={reload} organizationId={organizationId!} />
        </TabsContent>
        <TabsContent value="graduacao">
          <GraduacaoTab
            student={student}
            attendance={attendance}
            canPromote={canPromote}
            organizationId={organizationId!}
            userId={user?.id ?? null}
            onChange={reload}
          />
        </TabsContent>
        <TabsContent value="turmas">
          <TurmasTab studentId={student.id} organizationId={organizationId!} />
        </TabsContent>
        <TabsContent value="financeiro">
          <FinanceiroTab
            financial={financial}
            onChange={reload}
            studentId={student.id}
            organizationId={organizationId!}
          />
        </TabsContent>
        <TabsContent value="presenca">
          <PresencaTab attendance={attendance} promotionDate={grad?.promotion_date ?? null} />
        </TabsContent>
        <TabsContent value="mensagens">
          <MensagensTab studentId={student.id} organizationId={organizationId!} />
        </TabsContent>
        <TabsContent value="observacoes">
          <ObservacoesTab student={student} onChange={reload} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Geral ----------
const RELATIONSHIP_LABELS: Record<string, string> = {
  mae: "Mãe",
  pai: "Pai",
  avo_f: "Avó",
  avo_m: "Avô",
  tio: "Tio",
  tia: "Tia",
  conjuge: "Cônjuge",
  outro: "Outro",
};

function GeralTab({
  student,
  age,
  onChange,
  organizationId,
}: {
  student: any;
  age: number | null;
  onChange: () => void;
  organizationId: string;
}) {
  const profile = student.profiles ?? {};
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const removeGuardian = async (sgId: string) => {
    const { error } = await supabase.from("student_guardians").delete().eq("id", sgId);
    if (error) toast.error("Erro ao remover vínculo");
    else {
      toast.success("Vínculo removido");
      onChange();
    }
    setConfirmRemove(null);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Dados pessoais</h2>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Editar
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Field label="Data de nascimento" value={`${formatDateBR(student.birth_date)}${age != null ? ` (${age} anos)` : ""}`} />
          <Field label="CPF" value={profile.cpf ?? "—"} />
          <Field label="Telefone" value={profile.phone ?? "—"} />
          <Field label="E-mail" value={profile.email ?? "—"} />
          <Field label="Sexo" value={student.sex === "M" ? "Masculino" : student.sex === "F" ? "Feminino" : "—"} />
          <Field label="Peso" value={student.weight != null ? `${student.weight} kg` : "—"} />
          <Field label="Data de matrícula" value={formatDateBR(student.enrollment_date)} />
          <Field label="Mensalidade" value={student.monthly_fee != null ? formatBRL(student.monthly_fee) : "Padrão da academia"} />
          {(() => {
            const cat = getWeightCategory({ birthDate: student.birth_date, sex: student.sex, weightKg: student.weight });
            return (
              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground">Categoria FBJJ</div>
                <div className="mt-1 text-sm font-medium">{cat ? cat.label : "—"}</div>
              </div>
            );
          })()}
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="mt-1"><StudentStatusBadge status={student.status} /></div>
          </div>
        </div>
      </section>

      <EditStudentModal
        open={editOpen}
        onOpenChange={setEditOpen}
        student={student}
        onSaved={() => { setEditOpen(false); onChange(); }}
      />

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Responsáveis</h2>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-1 h-4 w-4" /> Adicionar
          </Button>
        </div>
        {(!student.student_guardians || student.student_guardians.length === 0) && (
          <p className="text-sm text-muted-foreground">Nenhum responsável vinculado.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {student.student_guardians?.map((sg: any) => {
            const g = sg.guardians ?? {};
            const gp = g.profiles ?? {};
            return (
              <div key={sg.id} className="rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <Avatar name={gp.full_name ?? "?"} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{gp.full_name ?? "Sem nome"}</div>
                    <div className="text-xs text-muted-foreground">
                      {RELATIONSHIP_LABELS[sg.relationship_type] ?? sg.relationship_type}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.financial_responsible && <Tag color="blue">Financeiro</Tag>}
                      {g.legal_responsible && <Tag color="purple">Legal</Tag>}
                      {sg.primary_contact && <Tag color="green">Contato principal</Tag>}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {[gp.phone, gp.email].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setConfirmRemove(sg.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <AddGuardianModal
        open={addOpen}
        onOpenChange={setAddOpen}
        studentId={student.id}
        organizationId={organizationId}
        onSaved={() => {
          setAddOpen(false);
          onChange();
        }}
      />

      <ConfirmModal
        open={!!confirmRemove}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
        title="Remover responsável?"
        description="Esta ação remove apenas o vínculo com o aluno."
        destructive
        onConfirm={() => { if (confirmRemove) void removeGuardian(confirmRemove); }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: "blue" | "purple" | "green" }) {
  const map = {
    blue: "bg-blue-100 text-blue-800 border-blue-300",
    purple: "bg-purple-100 text-purple-800 border-purple-300",
    green: "bg-emerald-100 text-emerald-800 border-emerald-300",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[color]}`}>{children}</span>;
}

function AddGuardianModal({
  open,
  onOpenChange,
  studentId,
  organizationId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentId: string;
  organizationId: string;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [rel, setRel] = useState("mae");
  const [fin, setFin] = useState(false);
  const [legal, setLegal] = useState(false);
  const [primary, setPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFullName(""); setCpf(""); setPhone(""); setEmail("");
    setRel("mae"); setFin(false); setLegal(false); setPrimary(false);
  };

  const save = async () => {
    if (!fullName || !cpf || !phone) {
      toast.error("Nome, CPF e telefone são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const profileId = crypto.randomUUID();
      const guardianId = crypto.randomUUID();

      const { error: e1 } = await supabase.from("profiles").insert({
        id: profileId,
        organization_id: organizationId,
        full_name: fullName,
        email: email || null,
        phone,
        cpf,
        role: "responsavel",
      });
      if (e1) throw e1;

      const { error: e2 } = await supabase.from("guardians").insert({
        id: guardianId,
        organization_id: organizationId,
        profile_id: profileId,
        financial_responsible: fin,
        legal_responsible: legal,
      });
      if (e2) throw e2;

      if (primary) {
        await supabase
          .from("student_guardians")
          .update({ primary_contact: false })
          .eq("student_id", studentId);
      }

      const { error: e3 } = await supabase.from("student_guardians").insert({
        organization_id: organizationId,
        student_id: studentId,
        guardian_id: guardianId,
        relationship_type: rel,
        primary_contact: primary,
      });
      if (e3) throw e3;

      toast.success("Responsável adicionado");
      reset();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar responsável");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar responsável</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome completo *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>CPF *</Label>
              <Input value={cpf} onChange={(e) => setCpf(e.target.value)} />
            </div>
            <div>
              <Label>Telefone *</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Tipo de relacionamento</Label>
            <Select value={rel} onValueChange={setRel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(RELATIONSHIP_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={fin} onCheckedChange={(c) => setFin(!!c)} /> Responsável financeiro
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={legal} onCheckedChange={(c) => setLegal(!!c)} /> Responsável legal
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={primary} onCheckedChange={(c) => setPrimary(!!c)} /> Marcar como contato principal
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Graduação ----------
function GraduacaoTab({
  student,
  attendance,
  canPromote,
  organizationId,
  userId,
  onChange,
}: {
  student: any;
  attendance: any[];
  canPromote: boolean;
  organizationId: string;
  userId: string | null;
  onChange: () => void;
}) {
  const grad = Array.isArray(student.graduations) ? student.graduations[0] : student.graduations;
  const belt: Belt = grad?.belt ?? "branca";
  const degrees: number = grad?.degrees ?? 0;
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const [confirmDeleteHistory, setConfirmDeleteHistory] = useState<string | null>(null);
  const [deletingHistory, setDeletingHistory] = useState(false);

  const handleDeleteHistory = async (historyId: string) => {
    if (!organizationId) return;
    setDeletingHistory(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      const { deleteGraduationHistoryEntry } = await import("@/lib/registrations.functions");
      await deleteGraduationHistoryEntry({
        data: { accessToken, organizationId, historyId },
      });
      toast.success("Graduação removida do histórico");
      onChange();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao excluir graduação");
    } finally {
      setDeletingHistory(false);
      setConfirmDeleteHistory(null);
    }
  };

  const presencesSincePromotion = useMemo(() => {
    if (!grad?.promotion_date) return 0;
    return attendance.filter(
      (a) => a.present && a.class_date >= grad.promotion_date,
    ).length;
  }, [attendance, grad?.promotion_date]);

  const maxDeg = getMaxDegrees(belt);
  const minDate = grad?.minimum_next_promotion_date;
  const today = todayISO();

  let nextStatus: { text: string; tone: "neutral" | "yellow" | "green" } = {
    text: "Sem tempo mínimo definido — a critério do instrutor",
    tone: "neutral",
  };
  if (minDate) {
    const d = diffDays(minDate, today);
    if (d > 0) {
      nextStatus = { text: `Disponível em ${d} dias (${formatDateBR(minDate)})`, tone: "yellow" };
    } else {
      nextStatus = { text: `Apto para promoção há ${-d} dias`, tone: "green" };
    }
  }

  const history = [...(student.graduation_history ?? [])].sort(
    (a: any, b: any) => (b.promotion_date ?? "").localeCompare(a.promotion_date ?? ""),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Atual */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">Graduação atual</h3>
            {canPromote && grad && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1 h-4 w-4" /> Editar
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <BeltBadge belt={belt} size="lg" />
            <span style={{ fontSize: 18 }}>{getBeltLabel(belt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <DegreeDots degrees={degrees} size={12} />
            <span className="text-sm text-muted-foreground">
              Grau {degrees} de {maxDeg}
            </span>
          </div>
          {grad?.promotion_date && (
            <p className="text-sm">Promovido em {formatDateBR(grad.promotion_date)}</p>
          )}
          <p className="text-sm">
            <span className="font-medium">{presencesSincePromotion}</span> presenças desde a última promoção
          </p>
        </div>

        {/* Próxima */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Próxima promoção</h3>
          <div
            className={`inline-flex items-center rounded-md px-2 py-1 text-sm ${
              nextStatus.tone === "green"
                ? "bg-emerald-100 text-emerald-800 animate-pulse"
                : nextStatus.tone === "yellow"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-gray-100 text-gray-700"
            }`}
          >
            {nextStatus.text}
          </div>
          {belt === "preta" && (
            <p className="text-sm text-muted-foreground">
              Próximo grau ({degrees + 1}°) requer{" "}
              {BLACK_BELT_DEGREE_YEARS[degrees + 1] === Infinity || !BLACK_BELT_DEGREE_YEARS[degrees + 1]
                ? "—"
                : `${BLACK_BELT_DEGREE_YEARS[degrees + 1]} anos`}{" "}
              totais de faixa preta.
            </p>
          )}
          {canPromote && (
            <Button onClick={() => setModalOpen(true)}>Registrar promoção</Button>
          )}
        </div>
      </div>

      {/* Histórico */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Histórico de promoções</h3>
          {canPromote && (
            <Button size="sm" variant="outline" onClick={() => setPastOpen(true)}>
              Adicionar graduação anterior
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Faixa</TableHead>
              <TableHead>Professor / Equipe anterior</TableHead>
              <TableHead>Observações</TableHead>
              {canPromote && <TableHead className="w-16">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 && (
              <TableRow>
                <TableCell colSpan={canPromote ? 5 : 4} className="text-center text-muted-foreground">Sem promoções registradas</TableCell>
              </TableRow>
            )}
            {history.map((h: any) => (
              <TableRow key={h.id}>
                <TableCell>{formatDateBR(h.promotion_date)}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    {h.old_belt && h.old_belt !== h.new_belt ? (
                      <>
                        <BeltBadge belt={h.old_belt} size="sm" />
                        <span>→</span>
                      </>
                    ) : null}
                    <BeltBadge belt={h.new_belt} size="sm" />
                    <DegreeDots degrees={h.new_degrees ?? 0} size={6} />
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {[h.previous_instructor, h.previous_team].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{h.notes ?? "—"}</TableCell>
                {canPromote && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setConfirmDeleteHistory(h.id)}
                      title="Excluir graduação"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PastGraduationModal
        open={pastOpen}
        onOpenChange={setPastOpen}
        studentId={student.id}
        organizationId={organizationId}
        onSaved={() => { setPastOpen(false); onChange(); }}
      />

      <ConfirmModal
        open={!!confirmDeleteHistory}
        onOpenChange={(o) => !o && setConfirmDeleteHistory(null)}
        title="Excluir graduação do histórico?"
        description="Esta ação remove o registro de graduação do histórico. Não pode ser desfeita."
        confirmLabel={deletingHistory ? "Excluindo..." : "Excluir"}
        destructive
        onConfirm={() => { if (confirmDeleteHistory) void handleDeleteHistory(confirmDeleteHistory); }}
      />

      <PromotionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        student={student}
        organizationId={organizationId}
        userId={userId}
        onSaved={() => {
          setModalOpen(false);
          onChange();
        }}
      />

      {grad && (
        <EditGraduationModal
          open={editOpen}
          onOpenChange={setEditOpen}
          graduation={grad}
          organizationId={organizationId}
          onSaved={() => { setEditOpen(false); onChange(); }}
        />
      )}
    </div>
  );
}

function PromotionModal({
  open,
  onOpenChange,
  student,
  organizationId,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  student: any;
  organizationId: string;
  userId: string | null;
  onSaved: () => void;
}) {
  const grad = Array.isArray(student.graduations) ? student.graduations[0] : student.graduations;
  const currentBelt: Belt = grad?.belt ?? "branca";
  const currentDegrees: number = grad?.degrees ?? 0;
  const birth = student.birth_date ?? new Date().toISOString();
  const isMinor = (() => {
    if (!student.birth_date) return false;
    const b = new Date(student.birth_date);
    const t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    const m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
    return a < 18;
  })();

  const available = useMemo(
    () => getAvailableBeltsForPromotion(currentBelt, currentDegrees, isMinor, birth),
    [currentBelt, currentDegrees, isMinor, birth],
  );

  const [selectedBelt, setSelectedBelt] = useState<Belt>(available[0] ?? currentBelt);
  const isSame = selectedBelt === currentBelt;
  const initialDegrees = isSame ? Math.min(currentDegrees + 1, getMaxDegrees(selectedBelt)) : selectedBelt === "preta" ? 1 : 0;
  const [newDegrees, setNewDegrees] = useState<number>(initialDegrees);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedBelt(available[0] ?? currentBelt);
    }
  }, [open, available, currentBelt]);

  useEffect(() => {
    const same = selectedBelt === currentBelt;
    setNewDegrees(
      same ? Math.min(currentDegrees + 1, getMaxDegrees(selectedBelt)) : selectedBelt === "preta" ? 1 : 0,
    );
  }, [selectedBelt, currentBelt, currentDegrees]);

  const today = todayISO();
  const previewMin = useMemo(
    () => calcMinNextPromotionDate(selectedBelt, newDegrees, today),
    [selectedBelt, newDegrees, today],
  );

  const maxDeg = getMaxDegrees(selectedBelt);
  const degOptions = selectedBelt === "preta"
    ? Array.from({ length: maxDeg }, (_, i) => i + 1)
    : Array.from({ length: maxDeg + 1 }, (_, i) => i);

  const confirm = async () => {
    if (!grad) {
      toast.error("Sem registro de graduação inicial");
      return;
    }
    setSaving(true);
    try {
      const minDate = calcMinNextPromotionDate(selectedBelt, newDegrees, today);
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      const { promoteStudent } = await import("@/lib/registrations.functions");
      await promoteStudent({
        data: {
          accessToken,
          organizationId,
          studentId: student.id,
          graduationId: grad.id,
          newBelt: selectedBelt,
          newDegrees,
          promotionDate: today,
          minimumNextPromotionDate: minDate,
          oldBelt: grad.belt,
          oldDegrees: grad.degrees,
          notes: notes || null,
        },
      });

      toast.success("Promoção registrada");
      setNotes("");
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao registrar promoção");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar promoção de {student.profiles?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma promoção disponível no momento.</p>
          ) : (
            <>
              <div>
                <Label>Faixa</Label>
                <Select value={selectedBelt} onValueChange={(v) => setSelectedBelt(v as Belt)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {available.map((b) => (
                      <SelectItem key={b} value={b}>
                        <span className="inline-flex items-center gap-2">
                          <BeltBadge belt={b} size="sm" showLabel={false} />
                          {b === currentBelt
                            ? `Avançar para grau ${Math.min(currentDegrees + 1, getMaxDegrees(b))} da faixa ${getBeltLabel(b)}`
                            : `Promover para ${getBeltLabel(b)}`}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Grau</Label>
                <Select value={String(newDegrees)} onValueChange={(v) => setNewDegrees(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {degOptions.map((d) => (
                      <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedBelt === "preta" && (
                <p className="text-xs text-muted-foreground">
                  Grau {newDegrees} →{" "}
                  {BLACK_BELT_DEGREE_YEARS[newDegrees + 1] === Infinity || !BLACK_BELT_DEGREE_YEARS[newDegrees + 1]
                    ? "sem próximo grau"
                    : `requer ${BLACK_BELT_DEGREE_YEARS[newDegrees + 1]} anos totais na faixa preta para o próximo`}
                </p>
              )}

              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                Próxima promoção disponível a partir de:{" "}
                <strong>{previewMin ? formatDateBR(previewMin) : "Sem restrição de tempo"}</strong>
              </div>

              <div>
                <Label>Observações (opcional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirm} disabled={saving || available.length === 0}>Confirmar promoção</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditGraduationModal({
  open,
  onOpenChange,
  graduation,
  organizationId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  graduation: any;
  organizationId: string;
  onSaved: () => void;
}) {
  const [belt, setBelt] = useState<Belt>(graduation.belt);
  const [degrees, setDegrees] = useState<number>(graduation.degrees ?? 0);
  const [promotionDate, setPromotionDate] = useState<string>(
    graduation.promotion_date ?? todayISO(),
  );
  const [minDate, setMinDate] = useState<string>(
    graduation.minimum_next_promotion_date ?? "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setBelt(graduation.belt);
      setDegrees(graduation.degrees ?? 0);
      setPromotionDate(graduation.promotion_date ?? todayISO());
      setMinDate(graduation.minimum_next_promotion_date ?? "");
    }
  }, [open, graduation]);

  const allBelts: Belt[] = [
    "branca","azul","roxa","marrom","preta","coral","vermelha",
    "cinza_branco","cinza","cinza_preto",
    "amarela_branco","amarela","amarela_preto",
    "laranja_branco","laranja","laranja_preto",
    "verde_branco","verde","verde_preto",
  ];
  const maxDeg = getMaxDegrees(belt);
  const degOptions = belt === "preta"
    ? Array.from({ length: maxDeg }, (_, i) => i + 1)
    : Array.from({ length: maxDeg + 1 }, (_, i) => i);

  const save = async () => {
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      const { updateStudentGraduation } = await import("@/lib/registrations.functions");
      await updateStudentGraduation({
        data: {
          accessToken,
          organizationId,
          graduationId: graduation.id,
          belt,
          degrees,
          promotionDate,
          minimumNextPromotionDate: minDate || null,
        },
      });
      toast.success("Graduação atualizada");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao atualizar graduação");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar graduação</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Faixa</Label>
            <Select value={belt} onValueChange={(v) => setBelt(v as Belt)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allBelts.map((b) => (
                  <SelectItem key={b} value={b}>{getBeltLabel(b)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Grau</Label>
            <Select value={String(degrees)} onValueChange={(v) => setDegrees(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {degOptions.map((d) => (
                  <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data da promoção</Label>
            <Input type="date" value={promotionDate} onChange={(e) => setPromotionDate(e.target.value)} />
          </div>
          <div>
            <Label>Próxima promoção disponível em (opcional)</Label>
            <Input type="date" value={minDate} onChange={(e) => setMinDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function FinanceiroTab({
  financial,
  onChange,
  studentId,
  organizationId,
}: {
  financial: any[];
  onChange: () => void;
  studentId: string;
  organizationId: string;
}) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const totals = useMemo(() => {
    const paidMonth = financial
      .filter((f) => f.status === "paid" && (f.paid_at ?? "").startsWith(ym))
      .reduce((s, f) => s + Number(f.amount ?? 0), 0);
    const open = financial
      .filter((f) => f.status === "pending" || f.status === "overdue")
      .reduce((s, f) => s + Number(f.amount ?? 0), 0);
    const overdueCount = financial.filter((f) => f.status === "overdue").length;
    return { paidMonth, open, overdueCount };
  }, [financial, ym]);

  const [payOpen, setPayOpen] = useState<any>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [whatsappOpen, setWhatsappOpen] = useState(false);

  const copyPix = async (code: string | null) => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    toast.success("Código PIX copiado!");
  };

  const cancelRecord = async (id: string) => {
    const { error } = await supabase.from("financial_records").update({ status: "canceled" }).eq("id", id);
    if (error) toast.error("Erro ao cancelar");
    else {
      toast.success("Cobrança cancelada");
      onChange();
    }
    setConfirmCancel(null);
  };

  return (
    <div className="space-y-4">
      <PlanoAtualSection studentId={studentId} organizationId={organizationId} />

      <div className="flex justify-end">
        <Button onClick={() => setWhatsappOpen(true)} variant="outline">
          <MessageCircle className="mr-2 h-4 w-4" />
          Enviar Cobrança WhatsApp
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard label="Pago no mês" value={formatBRL(totals.paidMonth)} />
        <SummaryCard label="Em aberto" value={formatBRL(totals.open)} />
        <SummaryCard label="Vencidos" value={String(totals.overdueCount)} />
      </div>




      <div className="rounded-lg border bg-card p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Referência</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {financial.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum registro financeiro</TableCell>
              </TableRow>
            )}
            {financial.map((f) => {
              const ref = f.reference_month ? formatDateBR(f.reference_month).slice(3) : "—";
              return (
                <TableRow key={f.id}>
                  <TableCell>{ref}</TableCell>
                  <TableCell>{formatBRL(Number(f.amount))}</TableCell>
                  <TableCell>{formatDateBR(f.due_date)}</TableCell>
                  <TableCell><StatusBadge status={f.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      {(f.status === "pending" || f.status === "overdue") && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => copyPix(f.pix_code)} disabled={!f.pix_code}>
                            <Copy className="mr-1 h-3 w-3" /> PIX
                          </Button>
                          <Button size="sm" onClick={() => setPayOpen(f)}>Registrar pagamento</Button>
                        </>
                      )}
                      {f.status === "paid" && (
                        <Button size="sm" variant="outline" disabled={!f.invoice_url} onClick={() => f.invoice_url && window.open(f.invoice_url, "_blank")}>
                          Ver recibo
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setConfirmCancel(f.id)}
                            disabled={f.status === "canceled"}
                          >
                            Cancelar cobrança
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <PayModal record={payOpen} onClose={() => setPayOpen(null)} onSaved={() => { setPayOpen(null); onChange(); }} />

      <ConfirmModal
        open={!!confirmCancel}
        onOpenChange={(o) => !o && setConfirmCancel(null)}
        title="Cancelar cobrança?"
        destructive
        onConfirm={() => { if (confirmCancel) void cancelRecord(confirmCancel); }}
      />

      <WhatsappChargeModal
        open={whatsappOpen}
        onOpenChange={setWhatsappOpen}
        studentId={studentId}
        organizationId={organizationId}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function PayModal({ record, onClose, onSaved }: { record: any; onClose: () => void; onSaved: () => void }) {
  const [method, setMethod] = useState("pix");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!record) return;
    setSaving(true);
    const { error } = await supabase
      .from("financial_records")
      .update({ status: "paid", paid_at: new Date().toISOString(), payment_method: method })
      .eq("id", record.id);
    setSaving(false);
    if (error) toast.error("Erro ao registrar pagamento");
    else {
      toast.success("Pagamento registrado");
      onSaved();
    }
  };

  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar pagamento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Presença ----------
function PresencaTab({ attendance, promotionDate }: { attendance: any[]; promotionDate: string | null }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11

  const ymPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthAttendance = attendance.filter((a) => (a.class_date ?? "").startsWith(ymPrefix));
  const byDate = new Map<string, any>();
  for (const a of monthAttendance) byDate.set(a.class_date, a);

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay.getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const presencesMonth = monthAttendance.filter((a) => a.present).length;
  const presencesSincePromotion = promotionDate
    ? attendance.filter((a) => a.present && a.class_date >= promotionDate).length
    : 0;

  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(firstDay);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }).map((_, i) => (
              <SelectItem key={i} value={String(i)}>
                {new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(2024, i, 1))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 5 }).map((_, i) => {
              const y = now.getFullYear() - 2 + i;
              return <SelectItem key={y} value={String(y)}>{y}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const rec = byDate.get(iso);
            let color = "bg-gray-200 border-gray-300";
            let title = "Sem registro";
            if (rec) {
              if (rec.present) {
                color = "bg-emerald-500 border-emerald-600 text-white";
                title = rec.class_schedules?.name ?? "Presente";
              } else {
                color = "bg-red-500 border-red-600 text-white";
                title = "Faltou";
              }
            }
            return (
              <div key={i} className="flex items-center justify-center" title={title}>
                <div className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs ${color}`}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        <p>{presencesMonth} presenças em {monthLabel}</p>
        <p>{presencesSincePromotion} presenças desde a última promoção</p>
      </div>
    </div>
  );
}

// ---------- Observações ----------
function ObservacoesTab({ student, onChange }: { student: any; onChange: () => void }) {
  const [notes, setNotes] = useState(student.medical_notes ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = notes !== (student.medical_notes ?? "");

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("students").update({ medical_notes: notes }).eq("id", student.id);
    setSaving(false);
    if (error) toast.error("Erro ao salvar observações");
    else {
      toast.success("Observações salvas");
      onChange();
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <Label>Observações médicas / gerais</Label>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={10} />
      <Button onClick={save} disabled={!dirty || saving}>Salvar observações</Button>
    </div>
  );
}

// ---------- Editar aluno ----------
function EditStudentModal({
  open,
  onOpenChange,
  student,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  student: any;
  onSaved: () => void;
}) {
  const profile = student.profiles ?? {};
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [cpf, setCpf] = useState(profile.cpf ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [birthDate, setBirthDate] = useState(student.birth_date ?? "");
  const normalizeSex = (v: unknown): Sex | "" => {
    if (v === "M" || v === "F") return v;
    if (v === "male" || v === "masculino") return "M";
    if (v === "female" || v === "feminino") return "F";
    return "";
  };
  const [sex, setSex] = useState<Sex | "">(normalizeSex(student.sex));
  const [weightKg, setWeightKg] = useState<string>(student.weight != null ? String(student.weight) : "");
  const [enrollmentDate, setEnrollmentDate] = useState(student.enrollment_date ?? "");
  const [monthlyFee, setMonthlyFee] = useState<string>(
    student.monthly_fee != null ? String(student.monthly_fee) : "",
  );
  const [status, setStatus] = useState<string>(student.status ?? "active");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(profile.full_name ?? "");
    setCpf(profile.cpf ?? "");
    setPhone(profile.phone ?? "");
    setEmail(profile.email ?? "");
    setBirthDate(student.birth_date ?? "");
    setSex(normalizeSex(student.sex));
    setWeightKg(student.weight != null ? String(student.weight) : "");
    setEnrollmentDate(student.enrollment_date ?? "");
    setMonthlyFee(student.monthly_fee != null ? String(student.monthly_fee) : "");
    setStatus(student.status ?? "active");
  }, [open, student]);

  const save = async () => {
    if (!fullName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      if (profile.id) {
        const { error: pe } = await supabase
          .from("profiles")
          .update({
            full_name: fullName.trim(),
            cpf: cpf || null,
            phone: phone || null,
            email: email || null,
          })
          .eq("id", profile.id);
        if (pe) throw pe;
      }

      const { error: se } = await supabase
        .from("students")
        .update({
          birth_date: birthDate || null,
          sex: sex || null,
          weight: weightKg === "" ? null : Number(weightKg),
          enrollment_date: enrollmentDate || null,
          monthly_fee: monthlyFee === "" ? null : Number(monthlyFee),
          status,
        })
        .eq("id", student.id);
      if (se) throw se;

      toast.success("Aluno atualizado");
      onSaved();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar aluno</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome completo *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>CPF</Label>
              <Input value={cpf} onChange={(e) => setCpf(e.target.value)} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de nascimento</Label>
              <Input type="date" value={birthDate ?? ""} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div>
              <Label>Data de matrícula</Label>
              <Input type="date" value={enrollmentDate ?? ""} onChange={(e) => setEnrollmentDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sexo</Label>
              <Select value={sex} onValueChange={(v) => setSex(v as Sex)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mensalidade (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(e.target.value)}
                placeholder="Padrão da academia"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                  <SelectItem value="suspended">Suspenso</SelectItem>
                  <SelectItem value="trial">Experimental</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ALL_BELTS_PAST: Belt[] = [
  "branca", "cinza_branco", "cinza", "cinza_preto",
  "amarela_branco", "amarela", "amarela_preto",
  "laranja_branco", "laranja", "laranja_preto",
  "verde_branco", "verde", "verde_preto",
  "azul", "roxa", "marrom", "preta",
];

function PastGraduationModal({
  open, onOpenChange, studentId, organizationId, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentId: string;
  organizationId: string;
  onSaved: () => void;
}) {
  const [belt, setBelt] = useState<Belt>("branca");
  const [degrees, setDegrees] = useState(0);
  const [promotionDate, setPromotionDate] = useState(todayISO());
  const [previousInstructor, setPreviousInstructor] = useState("");
  const [previousTeam, setPreviousTeam] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setBelt("branca"); setDegrees(0);
      setPromotionDate(todayISO());
      setPreviousInstructor(""); setPreviousTeam(""); setNotes("");
    }
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      const { addPastGraduation } = await import("@/lib/registrations.functions");
      await addPastGraduation({
        data: {
          accessToken, organizationId, studentId,
          oldBelt: belt, oldDegrees: degrees,
          newBelt: belt, newDegrees: degrees,
          promotionDate,
          previousInstructor: previousInstructor || null,
          previousTeam: previousTeam || null,
          notes: notes || null,
        },
      });
      toast.success("Graduação anterior adicionada");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao adicionar graduação");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar graduação anterior</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Faixa</Label>
              <Select value={belt} onValueChange={(v) => setBelt(v as Belt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_BELTS_PAST.map((b) => (
                    <SelectItem key={b} value={b}>{getBeltLabel(b)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Grau</Label>
              <Input type="number" min={0} max={10} value={degrees}
                onChange={(e) => setDegrees(Number(e.target.value) || 0)} />
            </div>
            <div className="col-span-2">
              <Label>Data da promoção</Label>
              <Input type="date" value={promotionDate} onChange={(e) => setPromotionDate(e.target.value)} />
            </div>
            <div>
              <Label>Professor anterior</Label>
              <Input value={previousInstructor} onChange={(e) => setPreviousInstructor(e.target.value)} />
            </div>
            <div>
              <Label>Equipe anterior</Label>
              <Input value={previousTeam} onChange={(e) => setPreviousTeam(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Adicionar ao histórico"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanoAtualSection({
  studentId,
  organizationId,
}: {
  studentId: string;
  organizationId: string;
}) {
  const fetchSub = useServerFn(getStudentSubscription);
  const fetchPlans = useServerFn(listSubscriptionPlansForOrg);
  const createSub = useServerFn(createSubscriptionRecord);

  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planId, setPlanId] = useState("");
  const [startedAt, setStartedAt] = useState(todayISO());
  const [nextDueDate, setNextDueDate] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");
      const res = await fetchSub({ data: { accessToken, organizationId, studentId } });
      setSubscription(res.subscription);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar plano");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, organizationId]);

  const openModal = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");
      const res = await fetchPlans({ data: { accessToken, organizationId } });
      const active = (res.plans ?? []).filter((p: any) => p.active);
      setPlans(active);
      if (!active.length) {
        toast.error("Cadastre um plano em Financeiro > Planos.");
        return;
      }
      setPlanId(active[0].id);
      setStartedAt(todayISO());
      const next = new Date();
      next.setMonth(next.getMonth() + 1);
      setNextDueDate(next.toISOString().split("T")[0]);
      setModalOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar planos");
    }
  };

  const handleSave = async () => {
    if (!planId) return;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");
      await createSub({
        data: { accessToken, organizationId, studentId, planId, startedAt, nextDueDate },
      });
      toast.success("Plano vinculado");
      setModalOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao vincular plano");
    } finally {
      setSaving(false);
    }
  };

  const plan = subscription
    ? Array.isArray(subscription.subscription_plans)
      ? subscription.subscription_plans[0]
      : subscription.subscription_plans
    : null;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Plano Atual</h3>
        <Button size="sm" variant="outline" onClick={openModal}>
          <Plus className="mr-1 h-4 w-4" /> {subscription ? "Trocar plano" : "Vincular plano"}
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !subscription || !plan ? (
        <p className="text-sm text-muted-foreground">Aluno sem plano vinculado.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Plano</div>
            <div className="font-medium">{plan.name}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Valor</div>
            <div className="font-medium">{formatBRL(Number(plan.amount))}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Frequência</div>
            <div className="font-medium capitalize">{plan.frequency}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="font-medium capitalize">{subscription.status}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Início</div>
            <div className="font-medium">{formatDateBR(subscription.started_at)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Próximo vencimento</div>
            <div className="font-medium">{formatDateBR(subscription.next_due_date)}</div>
          </div>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular plano</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Plano</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {formatBRL(Number(p.amount))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data de início</Label>
              <Input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </div>
            <div>
              <Label>Próximo vencimento</Label>
              <Input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !planId}>{saving ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- WhatsApp Charge Modal ----------
function WhatsappChargeModal({
  open,
  onOpenChange,
  studentId,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentId: string;
  organizationId: string;
}) {
  const getCharge = useServerFn(getStudentChargeForWhatsapp);
  const sendCharge = useServerFn(sendIndividualWhatsappCharge);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [noCharge, setNoCharge] = useState(false);
  const [noPhone, setNoPhone] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setInfo(null);
      setNoCharge(false);
      setNoPhone(false);
      try {
        const { data: session } = await supabase.auth.getSession();
        const accessToken = session.session?.access_token;
        if (!accessToken) throw new Error("Sessão inválida");
        const res: any = await getCharge({
          data: { accessToken, organizationId, studentId },
        });
        if (cancelled) return;
        if (!res.hasPhone) {
          setNoPhone(true);
        } else if (!res.hasCharge) {
          setNoCharge(true);
        } else {
          setInfo(res);
          setMessage(res.message);
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Erro ao carregar dados");
        onOpenChange(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, organizationId, studentId, getCharge, onOpenChange]);

  const handleSend = async () => {
    if (!info) return;
    setSending(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      await sendCharge({
        data: {
          accessToken,
          organizationId,
          studentId,
          financialRecordId: info.financialRecordId,
          phone: info.phone,
          message,
        },
      });
      toast.success("✅ Mensagem enviada com sucesso");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`❌ Falha no envio: ${e?.message ?? "erro desconhecido"}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar cobrança via WhatsApp</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && noPhone && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
            Este aluno não possui telefone cadastrado.
          </div>
        )}

        {!loading && noCharge && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            Não existe cobrança pendente para este aluno.
          </div>
        )}

        {!loading && info && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoRow label="Aluno" value={info.studentName} />
              <InfoRow label="Telefone" value={info.phone} />
              <InfoRow label="Plano" value={info.planName} />
              <InfoRow label="Valor" value={info.amountFormatted} />
              <InfoRow label="Vencimento" value={info.dueDateFormatted} />
              <InfoRow
                label="Link de pagamento"
                value={info.paymentUrl || "—"}
                mono
              />
            </div>
            <div className="space-y-1">
              <Label>Mensagem</Label>
              <Textarea
                rows={12}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Fechar
          </Button>
          {!loading && info && (
            <Button onClick={handleSend} disabled={sending || !message.trim()}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "text-xs break-all font-mono" : "text-sm"}>{value}</div>
    </div>
  );
}

// ---------- Mensagens tab ----------
function MensagensTab({
  studentId,
  organizationId,
}: {
  studentId: string;
  organizationId: string;
}) {
  const listLogs = useServerFn(listWhatsappMessageLogs);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: session } = await supabase.auth.getSession();
        const accessToken = session.session?.access_token;
        if (!accessToken) throw new Error("Sessão inválida");
        const res: any = await listLogs({
          data: { accessToken, organizationId, studentId },
        });
        if (!cancelled) setLogs(res.logs ?? []);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Erro ao carregar histórico");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, organizationId, listLogs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        Nenhuma mensagem enviada ainda.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Telefone</TableHead>
            <TableHead>Mensagem</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Resposta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="whitespace-nowrap text-xs">
                {new Date(l.created_at).toLocaleString("pt-BR")}
              </TableCell>
              <TableCell className="text-xs">{l.phone}</TableCell>
              <TableCell className="max-w-md">
                <div className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                  {l.message}
                </div>
              </TableCell>
              <TableCell>
                {l.status === "sent" ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    Enviado
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    Falhou
                  </span>
                )}
              </TableCell>
              <TableCell className="max-w-xs">
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {l.provider_response ?? "—"}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
