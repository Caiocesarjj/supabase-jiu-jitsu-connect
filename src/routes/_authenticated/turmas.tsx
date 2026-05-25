import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, CalendarDays, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  deactivateClassSchedule,
  listClassSchedules,
  listInstructors,
  saveClassSchedules,
} from "@/lib/registrations.functions";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { ClassStudentsModal } from "@/components/EnrollmentPanels";
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
  instructor_id?: string | null;
  instructors?: { full_name: string } | null;
}

function TurmasPage() {
  const { organizationId } = useAuth();
  const deactivateSchedule = useServerFn(deactivateClassSchedule);
  const fetchSchedules = useServerFn(listClassSchedules);
  const fetchInstructors = useServerFn(listInstructors);
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [instructors, setInstructors] = useState<{ id: string; full_name: string }[]>([]);
  const [reload, setReload] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [confirmDel, setConfirmDel] = useState<Schedule | null>(null);
  const [studentsModal, setStudentsModal] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("Sessão inválida.");
        const [schRes, insRes] = await Promise.all([
          fetchSchedules({ data: { accessToken, organizationId } }),
          fetchInstructors({ data: { accessToken, organizationId } }),
        ]);
        if (cancelled) return;
        setSchedules((schRes.schedules as any) ?? []);
        setInstructors((insRes.instructors as any) ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, reload, fetchSchedules, fetchInstructors]);

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
          {(() => {
            const groups = new Map<string, Schedule[]>();
            for (const s of schedules) {
              const key = `${s.name}|${s.start_time}|${s.duration_min}`;
              const arr = groups.get(key) ?? [];
              arr.push(s);
              groups.set(key, arr);
            }
            return Array.from(groups.values()).map((group) => {
              const first = group[0];
              const days = Array.from(new Set(group.map((g) => g.weekday))).sort();
              const insNames = Array.from(
                new Set(
                  group
                    .map((g) => g.instructors?.full_name)
                    .filter((n): n is string => !!n),
                ),
              );
              return (
                <div key={first.id} className="rounded-lg border bg-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{first.name}</h3>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Alunos"
                        onClick={() => setStudentsModal({ id: first.id, name: first.name })}
                      >
                        <Users className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(first)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDel(first)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>{days.map((d) => WEEKDAYS[d]).join(", ")}</div>
                    <div>
                      {first.start_time?.slice(0, 5)} ({first.duration_min} min)
                    </div>
                    <div>{insNames.length > 0 ? insNames.join(", ") : "Sem instrutor"}</div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {modalOpen && (
        <ScheduleModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          schedule={editing}
          allSchedules={schedules}
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

      {studentsModal && (
        <ClassStudentsModal
          scheduleId={studentsModal.id}
          className={studentsModal.name}
          organizationId={organizationId!}
          onClose={() => setStudentsModal(null)}
        />
      )}
    </div>
  );
}

function ScheduleModal({
  open,
  onClose,
  schedule,
  allSchedules,
  instructors,
  organizationId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  schedule: Schedule | null;
  allSchedules: Schedule[];
  instructors: { id: string; full_name: string }[];
  organizationId: string;
  onSaved: () => void;
}) {
  const isEdit = !!schedule;
  const saveSchedules = useServerFn(saveClassSchedules);

  // In edit mode, group siblings = same name + start_time + duration_min
  const siblings = schedule
    ? allSchedules.filter(
        (s) =>
          s.name === schedule.name &&
          s.start_time === schedule.start_time &&
          s.duration_min === schedule.duration_min,
      )
    : [];

  const [name, setName] = useState(schedule?.name ?? "");
  const [days, setDays] = useState<number[]>(
    siblings.length > 0
      ? Array.from(new Set(siblings.map((s) => s.weekday))).sort()
      : schedule
        ? [schedule.weekday]
        : [],
  );
  const [startTime, setStartTime] = useState(schedule?.start_time?.slice(0, 5) ?? "19:00");
  const [duration, setDuration] = useState(String(schedule?.duration_min ?? 60));
  const [instructorIds, setInstructorIds] = useState<string[]>(
    siblings.length > 0
      ? Array.from(
          new Set(
            siblings
              .map((s) => s.instructor_id)
              .filter((v): v is string => !!v),
          ),
        )
      : schedule?.instructor_id
        ? [schedule.instructor_id]
        : [],
  );
  const toggleInstructor = (id: string) => {
    setInstructorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };
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
      startTime,
      durationMin: Number(duration),
      instructorIds,
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
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
            {isEdit && (
              <p className="text-xs text-muted-foreground mt-1">
                Editar substitui todas as turmas deste grupo (mesmo nome + horário).
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
            <Label>Instrutores</Label>
            {instructors.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">
                Nenhum instrutor cadastrado. Cadastre em "Instrutores".
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-2">
                {instructors.map((i) => (
                  <label
                    key={i.id}
                    className="flex items-center gap-1 rounded border px-2 py-1 cursor-pointer"
                  >
                    <Checkbox
                      checked={instructorIds.includes(i.id)}
                      onCheckedChange={() => toggleInstructor(i.id)}
                    />
                    <span className="text-sm">{i.full_name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Selecionar mais de um cria uma turma para cada combinação dia × instrutor.
            </p>
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
