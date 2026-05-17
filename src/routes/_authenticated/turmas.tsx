import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { deactivateClassSchedule, saveClassSchedules } from "@/lib/registrations.functions";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/turmas")({
  component: TurmasPage,
});

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface Schedule {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  duration_min: number;
  active: boolean;
  instructor_record_id?: string | null;
  instructors?: { full_name: string } | null;
}

function TurmasPage() {
  const { organizationId } = useAuth();
  const deactivateSchedule = useServerFn(deactivateClassSchedule);
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [instructors, setInstructors] = useState<{ id: string; full_name: string }[]>([]);
  const [reload, setReload] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [confirmDel, setConfirmDel] = useState<Schedule | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [sch, ins] = await Promise.all([
        supabase
          .from("class_schedules")
          .select(
            `id, name, weekday, start_time, duration_min, active, instructor_id, profiles ( full_name )`,
          )
          .eq("organization_id", organizationId)
          .eq("active", true)
          .order("weekday")
          .order("start_time"),
        supabase
          .from("profiles")
          .select("id, full_name, role")
          .eq("organization_id", organizationId)
          .in("role", ["admin", "instructor", "instrutor"]),
      ]);
      if (cancelled) return;
      if (sch.error) toast.error("Erro ao carregar turmas");
      if (ins.error) toast.error("Erro ao carregar instrutores");
      setSchedules((sch.data as any) ?? []);
      setInstructors((ins.data as any) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, reload]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (s: Schedule) => {
    setEditing(s);
    setModalOpen(true);
  };

  const handleDeactivate = async () => {
    if (!confirmDel) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken || !organizationId)
        throw new Error("Sessão inválida. Faça login novamente.");
      await deactivateSchedule({ data: { accessToken, organizationId, id: confirmDel.id } });
      toast.success("Turma desativada");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao desativar turma");
    }
    setConfirmDel(null);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando turmas..." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Turmas</h1>
        <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="mr-2 h-4 w-4" /> Nova turma
        </Button>
      </div>

      {schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-10 w-10" />}
          title="Nenhuma turma cadastrada"
          action={
            <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Criar primeira turma
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {schedules.map((s) => (
            <div key={s.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{s.name}</h3>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setConfirmDel(s)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                <div>{WEEKDAYS[s.weekday]}</div>
                <div>
                  {s.start_time?.slice(0, 5)} ({s.duration_min} min)
                </div>
                <div>{s.profiles?.full_name ?? "Sem instrutor"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ScheduleModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          schedule={editing}
          instructors={instructors}
          organizationId={organizationId!}
          onSaved={() => {
            setModalOpen(false);
            setReload((r) => r + 1);
          }}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          open={!!confirmDel}
          onOpenChange={(o) => !o && setConfirmDel(null)}
          title={`Desativar a turma "${confirmDel.name}"?`}
          description="Os registros de presença serão mantidos."
          confirmLabel="Desativar"
          destructive
          onConfirm={handleDeactivate}
        />
      )}
    </div>
  );
}

function ScheduleModal({
  open,
  onClose,
  schedule,
  instructors,
  organizationId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  schedule: Schedule | null;
  instructors: { id: string; full_name: string }[];
  organizationId: string;
  onSaved: () => void;
}) {
  const isEdit = !!schedule;
  const saveSchedules = useServerFn(saveClassSchedules);
  const [name, setName] = useState(schedule?.name ?? "");
  const [days, setDays] = useState<number[]>(schedule ? [schedule.weekday] : []);
  const [startTime, setStartTime] = useState(schedule?.start_time?.slice(0, 5) ?? "19:00");
  const [duration, setDuration] = useState(String(schedule?.duration_min ?? 60));
  const [instructorId, setInstructorId] = useState<string>(schedule?.instructor_id ?? "none");
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Informe o nome da turma");
      return;
    }
    if (days.length === 0) {
      toast.error("Selecione ao menos um dia");
      return;
    }
    setSaving(true);
    const base = {
      name: name.trim(),
      start_time: startTime,
      durationMin: Number(duration),
      instructorId: instructorId === "none" ? null : instructorId,
    };
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      const result = await saveSchedules({
        data: { accessToken, organizationId, id: schedule?.id, days, ...base },
      });
      toast.success(
        isEdit
          ? "Turma atualizada"
          : `Turma criada (${result.count} ${result.count === 1 ? "dia" : "dias"})`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isEdit
            ? "Erro ao salvar turma"
            : "Erro ao criar turma",
      );
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar turma" : "Nova turma"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome da turma *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Adulto avançado"
            />
          </div>
          <div>
            <Label>Dias da semana *</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {WEEKDAYS.map((label, idx) => (
                <label
                  key={idx}
                  className="flex items-center gap-1 rounded border px-2 py-1 cursor-pointer"
                >
                  <Checkbox
                    checked={days.includes(idx)}
                    onCheckedChange={() => toggleDay(idx)}
                    disabled={isEdit && days.includes(idx) && days.length === 1}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
            {isEdit && (
              <p className="text-xs text-muted-foreground mt-1">
                Na edição, apenas o primeiro dia é atualizado.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Horário *</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label>Duração</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="45">45 min</SelectItem>
                  <SelectItem value="60">60 min</SelectItem>
                  <SelectItem value="90">90 min</SelectItem>
                  <SelectItem value="120">120 min</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Instrutor</Label>
            <Select value={instructorId} onValueChange={setInstructorId}>
              <SelectTrigger>
                <SelectValue placeholder="Sem instrutor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem instrutor</SelectItem>
                {instructors.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
