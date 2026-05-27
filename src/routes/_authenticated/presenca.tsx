import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { saveAttendanceRegistration } from "@/lib/registrations.functions";
import { Avatar } from "@/components/Avatar";
import { BeltBadge } from "@/components/BeltBadge";
import type { Belt } from "@/types/database";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/presenca")({
  component: PresencaPage,
});

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface ScheduleOption {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  duration_min: number;
}

interface AttendanceStudent {
  id: string;
  profiles?: { full_name?: string | null } | null;
  graduations?: Array<{ belt?: string | null; degrees?: number | null }> | null;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function PresencaPage() {
  const { organizationId } = useAuth();
  const saveAttendance = useServerFn(saveAttendanceRegistration);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [allStudents, setAllStudents] = useState<AttendanceStudent[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [saving, setSaving] = useState(false);

  const students = useMemo<AttendanceStudent[]>(() => {
    if (!selectedScheduleId) return [];
    if (!enrolledIds) return [];
    return allStudents.filter((s) => enrolledIds.has(s.id));
  }, [allStudents, enrolledIds, selectedScheduleId]);


  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [sch, st] = await Promise.all([
        supabase
          .from("class_schedules")
          .select("id, name, weekday, start_time, duration_min")
          .eq("organization_id", organizationId)
          .eq("active", true)
          .order("start_time"),
        supabase
          .from("students")
          .select("id, profiles(full_name), graduations(belt, degrees)")
          .eq("organization_id", organizationId)
          .eq("status", "active")
          .is("deleted_at", null),
      ]);
      if (cancelled) return;
      if (sch.error) toast.error("Erro ao carregar turmas");
      if (st.error) toast.error("Erro ao carregar alunos");
      const studentList = ((st.data as AttendanceStudent[] | null) ?? [])
        .slice()
        .sort((a, b) =>
          (a.profiles?.full_name ?? "").localeCompare(b.profiles?.full_name ?? ""),
        );
      setSchedules((sch.data as ScheduleOption[] | null) ?? []);
      setAllStudents(studentList);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Load enrolled students for the selected schedule
  useEffect(() => {
    if (!organizationId || !selectedScheduleId) {
      setEnrolledIds(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("student_class_enrollments")
        .select("student_id")
        .eq("organization_id", organizationId)
        .eq("schedule_id", selectedScheduleId);
      if (cancelled) return;
      if (error) {
        toast.error("Erro ao carregar matrículas da turma");
        setEnrolledIds(new Set());
        return;
      }
      setEnrolledIds(new Set((data ?? []).map((r: { student_id: string }) => r.student_id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, selectedScheduleId]);


  // Load existing attendance and initialize checks
  useEffect(() => {
    if (!organizationId || !selectedScheduleId || !selectedDate) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("student_id, present")
        .eq("organization_id", organizationId)
        .eq("schedule_id", selectedScheduleId)
        .eq("class_date", selectedDate);
      if (cancelled) return;
      if (error) {
        toast.error("Erro ao carregar presença");
        return;
      }
      const map: Record<string, boolean> = {};
      students.forEach((s) => {
        map[s.id] = true;
      });
      (data ?? []).forEach((r: { student_id: string; present: boolean }) => {
        map[r.student_id] = !!r.present;
      });
      setChecked(map);
      setAlreadyRegistered((data ?? []).length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, selectedScheduleId, selectedDate, students]);

  const presentCount = useMemo(
    () => students.filter((s) => checked[s.id]).length,
    [students, checked],
  );

  const handleConfirm = async () => {
    if (!organizationId || !selectedScheduleId || !selectedDate) return;
    setSaving(true);
    const records = students.map((s) => ({ studentId: s.id, present: checked[s.id] ?? true }));
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setSaving(false);
      toast.error("Sessão inválida. Faça login novamente.");
      return;
    }
    try {
      await saveAttendance({
        data: {
          accessToken,
          organizationId,
          scheduleId: selectedScheduleId,
          classDate: selectedDate,
          records,
        },
      });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : "Erro ao registrar chamada");
      return;
    }
    setSaving(false);
    const scheduleName = schedules.find((s) => s.id === selectedScheduleId)?.name ?? "turma";
    toast.success(
      `Chamada de ${scheduleName} registrada — ${presentCount} presentes de ${students.length} alunos.`,
    );
    setAlreadyRegistered(true);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando..." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Presença</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="min-w-[200px]">
          <Label>Turma</Label>
          <Select
            value={selectedClassName}
            onValueChange={(v) => {
              setSelectedClassName(v);
              setSelectedScheduleId("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione a turma" />
            </SelectTrigger>
            <SelectContent>
              {classNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[200px]">
          <Label>Dia / Horário</Label>
          <Select
            value={selectedScheduleId}
            onValueChange={setSelectedScheduleId}
            disabled={!selectedClassName}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o dia" />
            </SelectTrigger>
            <SelectContent>
              {schedulesForClass.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {WEEKDAYS[s.weekday]} — {s.start_time?.slice(0, 5)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Data</Label>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
        {selectedScheduleId && selectedDate && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
              alreadyRegistered
                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                : "bg-gray-100 text-gray-700 border-gray-300"
            }`}
          >
            {alreadyRegistered ? "Chamada registrada ✓" : "Chamada pendente"}
          </span>
        )}
      </div>

      {!selectedScheduleId || !selectedDate ? (
        <EmptyState
          icon={<CheckSquare className="h-10 w-10" />}
          title="Selecione uma turma e a data para registrar a presença."
        />
      ) : students.length === 0 ? (
        <EmptyState
          icon={<CheckSquare className="h-10 w-10" />}
          title="Nenhum aluno ativo cadastrado. Cadastre alunos primeiro."
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2 text-sm font-medium">
            <span>
              {presentCount} / {students.length} presentes
            </span>
          </div>
          <div className="divide-y">
            {students.map((s) => {
              const name = s.profiles?.full_name ?? "Sem nome";
              const belt = (s.graduations?.[0]?.belt ?? "branca") as Belt;
              const isPresent = checked[s.id] ?? true;
              return (
                <label
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={isPresent}
                    onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [s.id]: !!v }))}
                  />
                  <Avatar name={name} size={32} />
                  <span className="flex-1 text-sm">{name}</span>
                  <BeltBadge belt={belt} size="sm" showLabel={false} />
                </label>
              );
            })}
          </div>
          <div className="border-t p-3 flex justify-end">
            <Button
              onClick={handleConfirm}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? "Salvando..." : "Confirmar chamada"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
