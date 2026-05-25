import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, Check, ChevronLeft, ChevronRight } from "lucide-react";
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
import { Avatar } from "@/components/Avatar";
import { BeltBadge } from "@/components/BeltBadge";
import { supabase } from "@/lib/supabase";
import { createInstructor, updateInstructor } from "@/lib/instructors.functions";
import { getBeltLabel } from "@/lib/graduation";
import type { Belt } from "@/types/database";

const CERTIFICATIONS = [
  { id: "CBJJ", title: "CBJJ", subtitle: "Confederação Brasileira de Jiu-Jitsu" },
  { id: "IBJJF", title: "IBJJF", subtitle: "International Brazilian Jiu-Jitsu Federation" },
  { id: "Primeiros Socorros", title: "Primeiros Socorros", subtitle: "Atendimento de emergência" },
  { id: "CPR", title: "CPR", subtitle: "Reanimação Cardiopulmonar" },
] as const;

const SPECIALTIES = [
  "Jiu-Jitsu Gi",
  "No-Gi",
  "BJJ Infantil",
  "BJJ Feminino",
  "MMA",
  "Wrestling",
  "Grappling",
  "Defesa Pessoal",
  "Competição",
  "Preparação Física",
] as const;

const CONTRACT_TYPES = ["CLT", "PJ", "Autônomo", "Parceria", "Sócio"] as const;
const GENDERS = ["Masculino", "Feminino", "Outro", "Prefiro não informar"] as const;
const BELTS: Belt[] = ["branca", "azul", "roxa", "marrom", "preta"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PERIODS = [
  { id: "morning", label: "Manhã", hint: "6h–12h" },
  { id: "afternoon", label: "Tarde", hint: "12h–18h" },
  { id: "evening", label: "Noite", hint: "18h–23h" },
];

function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10)
    return d.replace(/(\d{0,2})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) =>
      [a && `(${a})`, b && ` ${b}`, c && `-${c}`].filter(Boolean).join(""),
    );
    return d.replace(/(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
}

export interface InstructorFormData {
  fullName: string;
  email: string;
  phone: string;
  birthDate: string;
  gender: string;
  belt: Belt;
  degrees: number;
  experienceYears: string;
  certifications: string[];
  specialties: string[];
  contractType: string;
  paymentModel: "hourly" | "monthly";
  hourlyRate: string;
  monthlySalary: string;
  notes: string;
  availability: string[];
  photoUrl: string;
}

const empty: InstructorFormData = {
  fullName: "",
  email: "",
  phone: "",
  birthDate: "",
  gender: "",
  belt: "preta",
  degrees: 0,
  experienceYears: "",
  certifications: [],
  specialties: [],
  contractType: "",
  paymentModel: "hourly",
  hourlyRate: "",
  monthlySalary: "",
  notes: "",
  availability: [],
  photoUrl: "",
};

interface Props {
  organizationId: string;
  initial?: Partial<InstructorFormData>;
  instructorId?: string;
}

export function InstructorWizard({ organizationId, initial, instructorId }: Props) {
  const navigate = useNavigate();
  const createFn = useServerFn(createInstructor);
  const updateFn = useServerFn(updateInstructor);
  const isEdit = !!instructorId;

  const [step, setStep] = useState(1);
  const [data, setData] = useState<InstructorFormData>({ ...empty, ...initial });
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>(initial?.photoUrl ?? "");

  const update = <K extends keyof InstructorFormData>(k: K, v: InstructorFormData[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const toggleArr = (key: "certifications" | "specialties" | "availability", v: string) =>
    setData((d) => ({
      ...d,
      [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v],
    }));

  const stepTitles = [
    "Informações Básicas",
    "Profissional",
    "Disponibilidade",
    "Revisão",
  ];

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!data.fullName.trim()) return "Informe o nome completo";
      if (!data.email.trim()) return "Informe o e-mail";
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      toast.error(err);
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const onPhotoSelect = (file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Foto deve ter no máximo 4MB");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(String(e.target?.result ?? ""));
    reader.readAsDataURL(file);
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!photoFile) return data.photoUrl || null;
    const ext = (photoFile.name.split(".").pop() ?? "jpg").toLowerCase();
    const path = `instructors/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, photoFile, { upsert: false, contentType: photoFile.type });
    if (error) {
      toast.warning("A foto não foi enviada, mas o instrutor será salvo sem imagem.");
      return data.photoUrl || null;
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    return pub.publicUrl;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      const photoUrl = await uploadPhoto();

      const payload = {
        accessToken,
        organizationId,
        fullName: data.fullName.trim(),
        belt: data.belt,
        degrees: Number(data.degrees) || 0,
        phone: data.phone || null,
        email: data.email || null,
        notes: data.notes || null,
        photoUrl: photoUrl || null,
        birthDate: data.birthDate || null,
        gender: data.gender || null,
        experienceYears: data.experienceYears ? Number(data.experienceYears) : null,
        certifications: data.certifications,
        specialties: data.specialties,
        contractType: data.contractType || null,
        paymentModel: data.paymentModel,
        hourlyRate:
          data.paymentModel === "hourly" && data.hourlyRate
            ? Number(data.hourlyRate)
            : null,
        monthlySalary:
          data.paymentModel === "monthly" && data.monthlySalary
            ? Number(data.monthlySalary)
            : null,
        availability: data.availability,
      };

      if (isEdit && instructorId) {
        await updateFn({ data: { ...payload, instructorId } });
        toast.success("Instrutor atualizado");
        navigate({ to: "/instrutores/$instructorId", params: { instructorId } });
      } else {
        await createFn({ data: payload });
        toast.success("Instrutor cadastrado");
        navigate({ to: "/instrutores" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Stepper */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {stepTitles.map((title, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <div key={title} className="flex flex-1 items-center gap-2 min-w-0">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    active
                      ? "bg-emerald-600 text-white"
                      : done
                        ? "bg-emerald-200 text-emerald-900"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : n}
                </div>
                <span
                  className={`truncate text-xs sm:text-sm ${
                    active ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {title}
                </span>
                {n < 4 && <div className="hidden h-px flex-1 bg-border sm:block" />}
              </div>
            );
          })}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-600 transition-all"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6">
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2">
              <label className="relative cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPhotoSelect(f);
                  }}
                />
                {photoPreview ? (
                  <img
                    src={photoPreview}
                    alt=""
                    className="h-24 w-24 rounded-full object-cover ring-2 ring-emerald-600"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Camera className="h-8 w-8" />
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Camera className="h-3.5 w-3.5" />
                </span>
              </label>
              <span className="text-xs text-muted-foreground">Clique para enviar foto</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Nome completo *</Label>
                <Input
                  value={data.fullName}
                  onChange={(e) => update("fullName", e.target.value)}
                />
              </div>
              <div>
                <Label>E-mail *</Label>
                <Input
                  type="email"
                  value={data.email}
                  onChange={(e) => update("email", e.target.value)}
                />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  value={data.phone}
                  onChange={(e) => update("phone", maskPhone(e.target.value))}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div>
                <Label>Data de nascimento</Label>
                <Input
                  type="date"
                  value={data.birthDate}
                  onChange={(e) => update("birthDate", e.target.value)}
                />
              </div>
              <div>
                <Label>Gênero</Label>
                <Select value={data.gender} onValueChange={(v) => update("gender", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Faixa atual</Label>
                <Select
                  value={data.belt}
                  onValueChange={(v) => update("belt", v as Belt)}
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
                <Label>Graus</Label>
                <Select
                  value={String(data.degrees)}
                  onValueChange={(v) => update("degrees", Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Anos de experiência</Label>
                <Input
                  type="number"
                  min={0}
                  value={data.experienceYears}
                  onChange={(e) => update("experienceYears", e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <Label className="mb-2 block">Certificações</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {CERTIFICATIONS.map((c) => {
                  const checked = data.certifications.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleArr("certifications", c.id)}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                        checked
                          ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                          : "border-border hover:border-emerald-300"
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        {checked && <Check className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium">{c.title}</div>
                        <div className="text-xs text-muted-foreground">{c.subtitle}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Especialidades</Label>
              <div className="flex flex-wrap gap-2">
                {SPECIALTIES.map((s) => {
                  const sel = data.specialties.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleArr("specialties", s)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        sel
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-border hover:border-emerald-300"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Tipo de Contrato</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {CONTRACT_TYPES.map((t) => {
                  const sel = data.contractType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => update("contractType", t)}
                      className={`rounded-lg border p-3 text-sm font-medium transition ${
                        sel
                          ? "border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                          : "border-border hover:border-emerald-300"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Modelo de Pagamento</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["hourly", "monthly"] as const).map((m) => {
                  const sel = data.paymentModel === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => update("paymentModel", m)}
                      className={`rounded-lg border p-3 text-sm font-medium transition ${
                        sel
                          ? "border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                          : "border-border hover:border-emerald-300"
                      }`}
                    >
                      {m === "hourly" ? "Por Hora/Aula" : "Salário Mensal"}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                {data.paymentModel === "hourly" ? (
                  <div>
                    <Label>Valor por hora (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={data.hourlyRate}
                      onChange={(e) => update("hourlyRate", e.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <Label>Salário mensal (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={data.monthlySalary}
                      onChange={(e) => update("monthlySalary", e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea
                rows={3}
                value={data.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Toque nos quadrados para marcar os horários em que o instrutor está disponível.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1">
                <thead>
                  <tr>
                    <th className="w-20"></th>
                    {WEEKDAYS.map((d) => (
                      <th key={d} className="text-xs font-medium text-muted-foreground">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERIODS.map((p) => (
                    <tr key={p.id}>
                      <td className="pr-2 text-right">
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="text-[10px] text-muted-foreground">{p.hint}</div>
                      </td>
                      {WEEKDAYS.map((_, dayIdx) => {
                        const key = `${dayIdx}-${p.id}`;
                        const sel = data.availability.includes(key);
                        return (
                          <td key={key}>
                            <button
                              type="button"
                              onClick={() => toggleArr("availability", key)}
                              className={`h-10 w-full rounded-md border transition ${
                                sel
                                  ? "border-emerald-700 bg-emerald-600"
                                  : "border-border bg-muted/40 hover:border-emerald-400"
                              }`}
                              aria-pressed={sel}
                              aria-label={`${WEEKDAYS[dayIdx]} ${p.label}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <Avatar name={data.fullName} size={64} />
              )}
              <div>
                <div className="text-lg font-semibold">{data.fullName || "—"}</div>
                <BeltBadge belt={data.belt} stripes={data.degrees} size="sm" />
              </div>
            </div>

            <ReviewSection title="Dados pessoais">
              <ReviewRow label="E-mail" value={data.email} />
              <ReviewRow label="Telefone" value={data.phone} />
              <ReviewRow label="Nascimento" value={data.birthDate} />
              <ReviewRow label="Gênero" value={data.gender} />
              <ReviewRow
                label="Experiência"
                value={data.experienceYears ? `${data.experienceYears} anos` : ""}
              />
            </ReviewSection>

            <ReviewSection title="Certificações">
              <div className="flex flex-wrap gap-2">
                {data.certifications.length === 0 && (
                  <span className="text-sm text-muted-foreground">Nenhuma</span>
                )}
                {data.certifications.map((c) => (
                  <span
                    key={c}
                    className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                  >
                    ✓ {c}
                  </span>
                ))}
              </div>
            </ReviewSection>

            <ReviewSection title="Especialidades">
              <div className="flex flex-wrap gap-2">
                {data.specialties.length === 0 && (
                  <span className="text-sm text-muted-foreground">Nenhuma</span>
                )}
                {data.specialties.map((s) => (
                  <span key={s} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                    {s}
                  </span>
                ))}
              </div>
            </ReviewSection>

            <ReviewSection title="Contrato">
              <ReviewRow label="Tipo" value={data.contractType} />
              <ReviewRow
                label="Pagamento"
                value={
                  data.paymentModel === "hourly"
                    ? `Por hora · R$ ${data.hourlyRate || "—"}`
                    : `Mensal · R$ ${data.monthlySalary || "—"}`
                }
              />
            </ReviewSection>

            <ReviewSection title="Disponibilidade">
              <div className="text-sm">
                {data.availability.length === 0
                  ? "Nenhum horário marcado"
                  : `${data.availability.length} horário(s) marcado(s)`}
              </div>
            </ReviewSection>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        {step > 1 ? (
          <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={saving}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
        ) : (
          <span />
        )}
        {step < 4 ? (
          <Button
            onClick={goNext}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Próximo <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSave}
            disabled={saving}
            size="lg"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {saving ? "Salvando..." : isEdit ? "Salvar alterações" : "Confirmar e Cadastrar"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}
