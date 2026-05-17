import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Users, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  createInstructor,
  updateInstructor,
  deleteInstructor,
  addInstructorPastBelt,
  deleteInstructorPastBelt,
} from "@/lib/instructors.functions";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { BeltBadge } from "@/components/BeltBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ADULT_BELT_ORDER, JUNIOR_BELT_ORDER, getBeltLabel } from "@/lib/graduation";
import { formatDateBR } from "@/lib/format";
import type { Belt } from "@/types/database";

export const Route = createFileRoute("/_authenticated/instrutores")({
  component: InstructorsPage,
  head: () => ({ meta: [{ title: "Instrutores — JJ Manager" }] }),
});

const ALL_BELTS: Belt[] = [...ADULT_BELT_ORDER, "coral", "vermelha", ...JUNIOR_BELT_ORDER];

interface Instructor {
  id: string;
  full_name: string;
  belt: Belt;
  degrees: number;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

interface History {
  id: string;
  belt: Belt;
  degrees: number;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
}

function diffMonths(start: string, end: string | null): string {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const months = Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}a ${rem}m` : `${years} ${years === 1 ? "ano" : "anos"}`;
}

function InstructorsPage() {
  const { organizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [reload, setReload] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [confirmDel, setConfirmDel] = useState<Instructor | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select("id, full_name, belt, degrees, phone, email, notes")
        .eq("organization_id", organizationId)
        .order("full_name");
      if (cancelled) return;
      if (error) toast.error("Erro ao carregar instrutores");
      setInstructors(((data as Instructor[] | null) ?? []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, reload]);

  const deleteFn = useServerFn(deleteInstructor);

  const handleDelete = async () => {
    if (!confirmDel || !organizationId) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      await deleteFn({ data: { accessToken, organizationId, instructorId: confirmDel.id } });
      toast.success("Instrutor removido");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
    setConfirmDel(null);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando instrutores..." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Instrutores</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="mr-2 h-4 w-4" /> Novo instrutor
        </Button>
      </div>

      {instructors.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="Nenhum instrutor cadastrado"
          action={
            <Button
              onClick={() => setModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Cadastrar instrutor
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {instructors.map((i) => (
            <InstructorRow
              key={i.id}
              instructor={i}
              expanded={expandedId === i.id}
              onToggle={() => setExpandedId(expandedId === i.id ? null : i.id)}
              onEdit={() => {
                setEditing(i);
                setModalOpen(true);
              }}
              onDelete={() => setConfirmDel(i)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <InstructorModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          instructor={editing}
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
          title={`Remover ${confirmDel.full_name}?`}
          description="Esta ação não pode ser desfeita."
          confirmLabel="Remover"
          destructive
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function InstructorRow({
  instructor,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  instructor: Instructor;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { organizationId } = useAuth();
  const [history, setHistory] = useState<History[] | null>(null);
  const [reloadH, setReloadH] = useState(0);
  const [adding, setAdding] = useState(false);
  const addFn = useServerFn(addInstructorPastBelt);
  const delHistFn = useServerFn(deleteInstructorPastBelt);

  useEffect(() => {
    if (!expanded || !organizationId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("instructor_belt_history")
        .select("id, belt, degrees, started_at, ended_at, notes")
        .eq("instructor_id", instructor.id)
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false });
      if (!cancelled) setHistory((data as History[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, organizationId, instructor.id, reloadH]);

  const handleDeleteHist = async (id: string) => {
    if (!organizationId) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      await delHistFn({ data: { accessToken, organizationId, historyId: id } });
      toast.success("Removido");
      setReloadH((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        <BeltBadge belt={instructor.belt} stripes={instructor.degrees} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{instructor.full_name}</div>
          <div className="text-xs text-muted-foreground">
            {getBeltLabel(instructor.belt)} • {instructor.degrees}º grau
            {instructor.phone ? ` • ${instructor.phone}` : ""}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="ml-1 hidden sm:inline">Histórico</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t p-3 space-y-3">
          {!adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-3 w-3" /> Adicionar faixa anterior
            </Button>
          )}
          {adding && (
            <AddPastBeltForm
              instructorId={instructor.id}
              organizationId={organizationId!}
              addFn={addFn}
              onDone={(reload) => {
                setAdding(false);
                if (reload) setReloadH((r) => r + 1);
              }}
            />
          )}

          {history === null ? (
            <div className="text-sm text-muted-foreground">Carregando histórico...</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma faixa anterior cadastrada.</div>
          ) : (
            <div className="space-y-1">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 rounded border bg-background p-2"
                >
                  <BeltBadge belt={h.belt} stripes={h.degrees} size="sm" />
                  <div className="flex-1 text-sm">
                    <div>
                      {getBeltLabel(h.belt)} • {h.degrees}º grau
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateBR(h.started_at)} →{" "}
                      {h.ended_at ? formatDateBR(h.ended_at) : "atual"} ·{" "}
                      {diffMonths(h.started_at, h.ended_at)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteHist(h.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddPastBeltForm({
  instructorId,
  organizationId,
  addFn,
  onDone,
}: {
  instructorId: string;
  organizationId: string;
  addFn: ReturnType<typeof useServerFn<typeof addInstructorPastBelt>>;
  onDone: (reload: boolean) => void;
}) {
  const [belt, setBelt] = useState<Belt>("branca");
  const [degrees, setDegrees] = useState("0");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!startedAt) {
      toast.error("Informe a data de início");
      return;
    }
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      await addFn({
        data: {
          accessToken,
          organizationId,
          instructorId,
          belt,
          degrees: Number(degrees),
          startedAt,
          endedAt: endedAt || null,
        },
      });
      toast.success("Faixa adicionada");
      onDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
      setSaving(false);
    }
  };

  return (
    <div className="rounded border bg-background p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Faixa</Label>
          <Select value={belt} onValueChange={(v) => setBelt(v as Belt)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_BELTS.map((b) => (
                <SelectItem key={b} value={b}>
                  {getBeltLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Grau</Label>
          <Select value={degrees} onValueChange={setDegrees}>
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
          <Label className="text-xs">Início</Label>
          <Input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Fim (opcional)</Label>
          <Input type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => onDone(false)}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

interface PastBeltDraft {
  key: string;
  belt: Belt;
  degrees: number;
  startedAt: string;
  endedAt: string;
}

function InstructorModal({
  open,
  onClose,
  instructor,
  organizationId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  instructor: Instructor | null;
  organizationId: string;
  onSaved: () => void;
}) {
  const isEdit = !!instructor;
  const createFn = useServerFn(createInstructor);
  const updateFn = useServerFn(updateInstructor);
  const [fullName, setFullName] = useState(instructor?.full_name ?? "");
  const [belt, setBelt] = useState<Belt>((instructor?.belt as Belt) ?? "preta");
  const [degrees, setDegrees] = useState(String(instructor?.degrees ?? 0));
  const [phone, setPhone] = useState(instructor?.phone ?? "");
  const [email, setEmail] = useState(instructor?.email ?? "");
  const [notes, setNotes] = useState(instructor?.notes ?? "");
  const [pastBelts, setPastBelts] = useState<PastBeltDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const maxDegrees = useMemo(() => (belt === "preta" ? 10 : 4), [belt]);

  const addRow = () =>
    setPastBelts((p) => [
      ...p,
      { key: crypto.randomUUID(), belt: "branca", degrees: 0, startedAt: "", endedAt: "" },
    ]);
  const updateRow = (key: string, patch: Partial<PastBeltDraft>) =>
    setPastBelts((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setPastBelts((p) => p.filter((r) => r.key !== key));

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error("Informe o nome");
      return;
    }
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      if (isEdit) {
        await updateFn({
          data: {
            accessToken,
            organizationId,
            instructorId: instructor!.id,
            fullName: fullName.trim(),
            belt,
            degrees: Number(degrees),
            phone: phone || null,
            email: email || null,
            notes: notes || null,
          },
        });
        toast.success("Instrutor atualizado");
      } else {
        const past = pastBelts
          .filter((p) => p.startedAt)
          .map((p) => ({
            belt: p.belt,
            degrees: p.degrees,
            startedAt: p.startedAt,
            endedAt: p.endedAt || null,
          }));
        await createFn({
          data: {
            accessToken,
            organizationId,
            fullName: fullName.trim(),
            belt,
            degrees: Number(degrees),
            phone: phone || null,
            email: email || null,
            notes: notes || null,
            pastBelts: past,
          },
        });
        toast.success("Instrutor cadastrado");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar instrutor" : "Novo instrutor"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome completo *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Faixa atual *</Label>
              <Select value={belt} onValueChange={(v) => setBelt(v as Belt)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_BELTS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {getBeltLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Grau atual</Label>
              <Select value={degrees} onValueChange={setDegrees}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: maxDegrees + 1 }, (_, i) => i).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {!isEdit && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Faixas anteriores</Label>
                <Button type="button" size="sm" variant="outline" onClick={addRow}>
                  <Plus className="mr-1 h-3 w-3" /> Adicionar
                </Button>
              </div>
              {pastBelts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Opcional. Você também pode adicionar depois.
                </p>
              )}
              {pastBelts.map((row) => (
                <div
                  key={row.key}
                  className="rounded border bg-muted/30 p-2 grid grid-cols-12 gap-2 items-end"
                >
                  <div className="col-span-4">
                    <Label className="text-xs">Faixa</Label>
                    <Select
                      value={row.belt}
                      onValueChange={(v) => updateRow(row.key, { belt: v as Belt })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_BELTS.map((b) => (
                          <SelectItem key={b} value={b}>
                            {getBeltLabel(b)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Grau</Label>
                    <Select
                      value={String(row.degrees)}
                      onValueChange={(v) => updateRow(row.key, { degrees: Number(v) })}
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
                  <div className="col-span-3">
                    <Label className="text-xs">Início</Label>
                    <Input
                      type="date"
                      value={row.startedAt}
                      onChange={(e) => updateRow(row.key, { startedAt: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Fim</Label>
                    <Input
                      type="date"
                      value={row.endedAt}
                      onChange={(e) => updateRow(row.key, { endedAt: e.target.value })}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(row.key)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
