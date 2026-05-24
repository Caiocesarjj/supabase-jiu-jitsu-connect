import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Check, Mail, Phone, Pencil, Calendar } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import { BeltBadge } from "@/components/BeltBadge";
import type { Belt } from "@/types/database";

export const Route = createFileRoute("/_authenticated/instrutores/$instructorId")({
  component: InstructorProfilePage,
  head: () => ({ meta: [{ title: "Perfil do instrutor — JJ Manager" }] }),
});

interface InstructorDetail {
  id: string;
  full_name: string;
  belt: Belt;
  degrees: number;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  gender: string | null;
  birth_date: string | null;
  experience_years: number | null;
  certifications: string[] | null;
  specialties: string[] | null;
  contract_type: string | null;
  payment_model: string | null;
  hourly_rate: number | null;
  monthly_salary: number | null;
  notes: string | null;
  availability: string[] | null;
}

interface ScheduleRow {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  duration_min: number;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function InstructorProfilePage() {
  const { instructorId } = Route.useParams();
  const { organizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InstructorDetail | null>(null);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: ins, error } = await supabase
        .from("instructors")
        .select(
          "id, full_name, belt, degrees, phone, email, photo_url, gender, birth_date, experience_years, certifications, specialties, contract_type, payment_model, hourly_rate, monthly_salary, notes, availability",
        )
        .eq("id", instructorId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !ins) {
        toast.error("Instrutor não encontrado");
        setLoading(false);
        return;
      }
      setData(ins as InstructorDetail);

      const { data: sch } = await supabase
        .from("class_schedules")
        .select("id, name, weekday, start_time, duration_min")
        .eq("organization_id", organizationId)
        .eq("instructor_record_id", instructorId)
        .eq("active", true)
        .order("weekday")
        .order("start_time");
      if (!cancelled) setSchedules((sch as ScheduleRow[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [instructorId, organizationId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Link to="/instrutores" className="text-sm text-muted-foreground">
          <ChevronLeft className="mr-1 inline h-4 w-4" /> Voltar
        </Link>
        <p>Instrutor não encontrado.</p>
      </div>
    );
  }

  const certs = data.certifications ?? [];
  const specs = data.specialties ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/instrutores"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Voltar para instrutores
        </Link>
        <Button
          asChild
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Link
            to="/instrutores/$instructorId/editar"
            params={{ instructorId: data.id }}
          >
            <Pencil className="mr-2 h-4 w-4" /> Editar
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col items-start gap-4 rounded-lg border bg-card p-5 sm:flex-row sm:items-center">
        {data.photo_url ? (
          <img
            src={data.photo_url}
            alt={data.full_name}
            className="h-24 w-24 rounded-full object-cover"
          />
        ) : (
          <Avatar name={data.full_name} size={96} />
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{data.full_name}</h1>
          <div className="mt-2">
            <BeltBadge belt={data.belt} stripes={data.degrees} />
          </div>
          {specs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {specs.map((s) => (
                <span key={s} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Dados pessoais">
          <Row icon={<Mail className="h-4 w-4" />} label="E-mail" value={data.email} />
          <Row icon={<Phone className="h-4 w-4" />} label="Telefone" value={data.phone} />
          <Row label="Gênero" value={data.gender} />
          <Row label="Nascimento" value={data.birth_date} />
          <Row
            label="Experiência"
            value={data.experience_years ? `${data.experience_years} anos` : null}
          />
        </Section>

        <Section title="Certificações">
          {certs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma certificação cadastrada.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {certs.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  <Check className="h-3.5 w-3.5" /> {c}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section title="Contrato">
          <Row label="Tipo" value={data.contract_type} />
          <Row
            label="Modelo"
            value={
              data.payment_model === "hourly"
                ? "Por Hora/Aula"
                : data.payment_model === "monthly"
                  ? "Salário Mensal"
                  : null
            }
          />
          {data.payment_model === "hourly" && (
            <Row
              label="Valor/hora"
              value={data.hourly_rate ? `R$ ${data.hourly_rate.toFixed(2)}` : null}
            />
          )}
          {data.payment_model === "monthly" && (
            <Row
              label="Salário"
              value={data.monthly_salary ? `R$ ${data.monthly_salary.toFixed(2)}` : null}
            />
          )}
        </Section>

        <Section title="Turmas que leciona">
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma turma vinculada.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {schedules.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground">
                    · {WEEKDAYS[s.weekday]} · {s.start_time.slice(0, 5)} ({s.duration_min}min)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {data.notes && (
          <Section title="Observações" className="md:col-span-2">
            <p className="whitespace-pre-wrap text-sm">{data.notes}</p>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${className ?? ""}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string | null;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-right font-medium">{value || "—"}</span>
    </div>
  );
}
