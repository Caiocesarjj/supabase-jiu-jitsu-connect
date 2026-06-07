import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { UserPlus, ChevronRight, Users, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/Avatar";
import { BeltBadge } from "@/components/BeltBadge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Belt } from "@/types/database";
import { getBeltLabel } from "@/lib/graduation";
import { getWeightCategory, formatShortCategory } from "@/lib/weight-category";
import { ConfirmModal } from "@/components/ConfirmModal";
import { deleteStudentRegistration } from "@/lib/registrations.functions";

export const Route = createFileRoute("/_authenticated/alunos/")({
  component: AlunosListPage,
});

const ALL_BELTS: Belt[] = [
  "branca",
  "azul",
  "roxa",
  "marrom",
  "preta",
  "coral",
  "vermelha",
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

function DegreeDots({ degrees }: { degrees: number }) {
  if (!degrees) return null;
  return <span className="ml-1 text-xs opacity-80">{"•".repeat(Math.min(degrees, 4))}</span>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Ativo", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    inactive: {
      label: "Aguardando pagamento",
      cls: "bg-yellow-100 text-yellow-800 border-yellow-300",
    },
  };
  const cfg = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-700 border-gray-300" };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

function AlunosListPage() {
  const { organizationId } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<any[]>([]);
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [beltFilter, setBeltFilter] = useState<string>("all");
  const [reload, setReload] = useState(0);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!toDelete || !organizationId) return;
    setDeleting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida");
      await deleteStudentRegistration({
        data: { accessToken, organizationId, studentId: toDelete.id },
      });
      toast.success("Aluno excluído");
      setToDelete(null);
      setReload((r) => r + 1);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao excluir aluno");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw), 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("students")
        .select(
          `
          id, status, birth_date, sex, weight,
          profiles ( full_name, phone, email, cpf ),
          graduations ( belt, degrees )
        `,
        )
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error("Erro ao carregar alunos");
        setStudents([]);
      } else {
        setStudents(data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, reload]);

  const activeCount = students.filter((s) => s.status === "active").length;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((s) => {
      const name = (s.profiles?.full_name ?? "").toLowerCase();
      if (term && !name.includes(term)) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (beltFilter !== "all") {
        const g = Array.isArray(s.graduations) ? s.graduations[0] : s.graduations;
        if (g?.belt !== beltFilter) return false;
      }
      return true;
    });
  }, [students, search, statusFilter, beltFilter]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando alunos..." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Alunos</h1>
          <p className="text-sm text-muted-foreground">({activeCount} ativos)</p>
        </div>
        <Button
          onClick={() => navigate({ to: "/alunos/novo" as any })}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <UserPlus className="mr-2 h-4 w-4" /> Novo aluno
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder="Buscar por nome..."
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="inactive">Aguardando pagamento</SelectItem>
          </SelectContent>
        </Select>
        <Select value={beltFilter} onValueChange={setBeltFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as faixas</SelectItem>
            {ALL_BELTS.map((b) => (
              <SelectItem key={b} value={b}>
                {getBeltLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {students.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="Nenhum aluno cadastrado"
          action={
            <Button
              onClick={() => navigate({ to: "/alunos/novo" as any })}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Cadastrar primeiro aluno
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-10 w-10" />}
          title={`Nenhum aluno encontrado${search ? ` para "${search}"` : ""}`}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearchRaw("");
                setStatusFilter("all");
                setBeltFilter("all");
              }}
            >
              Limpar busca
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Faixa</TableHead>
                  <TableHead>Categoria FBJJ</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const name = s.profiles?.full_name ?? "Sem nome";
                  const grad = Array.isArray(s.graduations) ? s.graduations[0] : s.graduations;
                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        navigate({ to: "/alunos/$alunoId", params: { alunoId: s.id } })
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={name} size={36} />
                          <div>
                            <div className="font-medium">{name}</div>
                            {s.profiles?.cpf && (
                              <div className="text-xs text-muted-foreground">{s.profiles.cpf}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {grad ? (
                          <span className="inline-flex items-center">
                            <BeltBadge belt={grad.belt} size="sm" />
                            <DegreeDots degrees={grad.degrees ?? 0} />
                          </span>
                        ) : (
                          <BeltBadge belt="branca" size="sm" />
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatShortCategory(
                          getWeightCategory({
                            birthDate: s.birth_date,
                            sex: s.sex,
                            weightKg: s.weight,
                          }),
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.profiles?.phone ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={s.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Excluir"
                            onClick={(e) => {
                              e.stopPropagation();
                              setToDelete({ id: s.id, name: s.profiles?.full_name ?? "aluno" });
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((s) => {
              const name = s.profiles?.full_name ?? "Sem nome";
              const grad = Array.isArray(s.graduations) ? s.graduations[0] : s.graduations;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border bg-card p-3 hover:bg-muted/50"
                >
                  <button
                    onClick={() => navigate({ to: "/alunos/$alunoId", params: { alunoId: s.id } })}
                    className="flex flex-1 items-center gap-3 text-left min-w-0"
                  >
                    <Avatar name={name} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <BeltBadge belt={grad?.belt ?? "branca"} size="sm" showLabel={false} />
                        <StatusPill status={s.status} />
                      </div>
                    </div>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Excluir"
                    onClick={() => setToDelete({ id: s.id, name })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {toDelete && (
        <ConfirmModal
          open={!!toDelete}
          onOpenChange={(o) => !o && !deleting && setToDelete(null)}
          title={`Excluir "${toDelete.name}"?`}
          description="O aluno será removido. Esta ação não pode ser desfeita."
          confirmLabel={deleting ? "Excluindo..." : "Excluir"}
          destructive
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
