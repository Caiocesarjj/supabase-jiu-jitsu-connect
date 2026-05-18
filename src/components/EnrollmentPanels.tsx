import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  listStudentEnrollments,
  listClassEnrollments,
  listClassSchedules,
  listOrgStudents,
  enrollStudentInClass,
  unenrollStudentFromClass,
} from "@/lib/registrations.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/LoadingSpinner";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

async function getToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão inválida. Faça login novamente.");
  return token;
}

type Schedule = {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  duration_min: number;
  active: boolean;
};

function groupSchedules(list: Schedule[]) {
  const map = new Map<string, { key: string; name: string; start_time: string; duration_min: number; representativeId: string; days: number[] }>();
  for (const s of list) {
    if (!s.active) continue;
    const key = `${s.name}|${s.start_time}|${s.duration_min}`;
    const g = map.get(key);
    if (!g) {
      map.set(key, {
        key,
        name: s.name,
        start_time: s.start_time,
        duration_min: s.duration_min,
        representativeId: s.id,
        days: [s.weekday],
      });
    } else if (!g.days.includes(s.weekday)) {
      g.days.push(s.weekday);
    }
  }
  return Array.from(map.values()).map((g) => ({ ...g, days: g.days.sort() }));
}

// =========== Tab dentro da ficha do aluno ===========
export function TurmasTab({
  studentId,
  organizationId,
}: {
  studentId: string;
  organizationId: string;
}) {
  const fetchStudentEnr = useServerFn(listStudentEnrollments);
  const fetchSchedules = useServerFn(listClassSchedules);
  const enroll = useServerFn(enrollStudentInClass);
  const unenroll = useServerFn(unenrollStudentFromClass);

  const [loading, setLoading] = useState(true);
  const [allSchedules, setAllSchedules] = useState<Schedule[]>([]);
  const [enrolledScheduleIds, setEnrolledScheduleIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const accessToken = await getToken();
        const [enrRes, schRes] = await Promise.all([
          fetchStudentEnr({ data: { accessToken, organizationId, studentId } }),
          fetchSchedules({ data: { accessToken, organizationId } }),
        ]);
        if (cancelled) return;
        setEnrolledScheduleIds(
          new Set(((enrRes.enrollments as any[]) ?? []).map((e) => e.schedule_id)),
        );
        setAllSchedules((schRes.schedules as Schedule[]) ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, studentId, reload, fetchStudentEnr, fetchSchedules]);

  const groups = useMemo(() => groupSchedules(allSchedules), [allSchedules]);
  const enrolledGroups = groups.filter((g) => enrolledScheduleIds.has(g.representativeId) || g.days.some(() => {
    // any sibling id present? we only track schedule ids; if rep matches => enrolled
    return enrolledScheduleIds.has(g.representativeId);
  }));
  // Better: a group is enrolled if any of its (rep + future siblings) sched id is in set.
  // Since enrollment inserts ALL siblings, checking representativeId is enough.
  const availableGroups = groups.filter((g) => !enrolledScheduleIds.has(g.representativeId));
  const term = search.trim().toLowerCase();
  const filtered = term
    ? availableGroups.filter((g) => g.name.toLowerCase().includes(term))
    : availableGroups;

  const handleEnroll = async (scheduleId: string) => {
    try {
      const accessToken = await getToken();
      await enroll({ data: { accessToken, organizationId, studentId, scheduleId } });
      toast.success("Aluno matriculado na turma");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao matricular");
    }
  };
  const handleUnenroll = async (scheduleId: string) => {
    try {
      const accessToken = await getToken();
      await unenroll({ data: { accessToken, organizationId, studentId, scheduleId } });
      toast.success("Matrícula removida");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
  };

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <LoadingSpinner label="Carregando..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-semibold">Turmas matriculadas</h3>
        {enrolledGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma turma matriculada.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {enrolledGroups.map((g) => (
              <div key={g.key} className="flex items-center justify-between rounded border p-3">
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.days.map((d) => WEEKDAYS[d]).join(", ")} · {g.start_time.slice(0, 5)} ({g.duration_min} min)
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => handleUnenroll(g.representativeId)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Adicionar a uma turma</h3>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar turma pelo nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {availableGroups.length === 0
              ? "Aluno já está em todas as turmas ativas."
              : "Nenhuma turma encontrada."}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 max-h-96 overflow-auto">
            {filtered.map((g) => (
              <div key={g.key} className="flex items-center justify-between rounded border p-3">
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.days.map((d) => WEEKDAYS[d]).join(", ")} · {g.start_time.slice(0, 5)} ({g.duration_min} min)
                  </div>
                </div>
                <Button size="sm" onClick={() => handleEnroll(g.representativeId)}>
                  <Plus className="mr-1 h-4 w-4" /> Adicionar
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// =========== Modal dentro da turma ===========
export function ClassStudentsModal({
  scheduleId,
  className,
  organizationId,
  onClose,
}: {
  scheduleId: string;
  className: string;
  organizationId: string;
  onClose: () => void;
}) {
  const fetchClassEnr = useServerFn(listClassEnrollments);
  const fetchStudents = useServerFn(listOrgStudents);
  const enroll = useServerFn(enrollStudentInClass);
  const unenroll = useServerFn(unenrollStudentFromClass);

  const [loading, setLoading] = useState(true);
  const [enrolled, setEnrolled] = useState<Array<{ id: string; full_name: string }>>([]);
  const [allStudents, setAllStudents] = useState<Array<{ id: string; full_name: string; status?: string }>>([]);
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const accessToken = await getToken();
        const [enrRes, stRes] = await Promise.all([
          fetchClassEnr({ data: { accessToken, organizationId, scheduleId } }),
          fetchStudents({ data: { accessToken, organizationId } }),
        ]);
        if (cancelled) return;
        setEnrolled((enrRes.students as any) ?? []);
        setAllStudents((stRes.students as any) ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, scheduleId, reload, fetchClassEnr, fetchStudents]);

  const enrolledIds = useMemo(() => new Set(enrolled.map((s) => s.id)), [enrolled]);
  const term = search.trim().toLowerCase();
  const available = allStudents.filter((s) => !enrolledIds.has(s.id));
  const filtered = term ? available.filter((s) => s.full_name.toLowerCase().includes(term)) : available;

  const handleAdd = async (studentId: string) => {
    try {
      const accessToken = await getToken();
      await enroll({ data: { accessToken, organizationId, studentId, scheduleId } });
      toast.success("Aluno adicionado");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar");
    }
  };
  const handleRemove = async (studentId: string) => {
    try {
      const accessToken = await getToken();
      await unenroll({ data: { accessToken, organizationId, studentId, scheduleId } });
      toast.success("Aluno removido");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl bg-background rounded-lg shadow-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold">Alunos · {className}</h2>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <LoadingSpinner label="Carregando..." />
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-4 space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Matriculados ({enrolled.length})</h3>
              {enrolled.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum aluno matriculado.</p>
              ) : (
                <div className="space-y-1">
                  {enrolled.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded border p-2">
                      <span>{s.full_name}</span>
                      <Button size="icon" variant="ghost" onClick={() => handleRemove(s.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Adicionar aluno</h3>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar aluno pelo nome..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {available.length === 0 ? "Todos os alunos já estão na turma." : "Nenhum aluno encontrado."}
                </p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-auto">
                  {filtered.slice(0, 50).map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded border p-2">
                      <span>{s.full_name}</span>
                      <Button size="sm" onClick={() => handleAdd(s.id)}>
                        <Plus className="mr-1 h-4 w-4" /> Adicionar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
