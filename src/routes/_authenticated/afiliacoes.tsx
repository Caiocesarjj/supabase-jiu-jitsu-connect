import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, Trash2, Plus, Network, Users, DollarSign, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  requestAffiliation,
  listAffiliations,
  reviewAffiliation,
  cancelAffiliation,
  getConsolidatedStats,
} from "@/lib/affiliations.functions";
import { LoadingSpinner } from "@/components/LoadingSpinner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/afiliacoes")({
  component: AfiliacoesPage,
  head: () => ({ meta: [{ title: "Afiliações — JJ Manager" }] }),
});

async function getToken() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Sessão inválida.");
  return t;
}

type Item = {
  id: string;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  notes: string | null;
  org: { id: string; name: string; slug: string };
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-900",
    approved: "bg-green-100 text-green-900",
    rejected: "bg-red-100 text-red-900",
    canceled: "bg-gray-100 text-gray-900",
  };
  const labels: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Rejeitada",
    canceled: "Cancelada",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${map[status] ?? ""}`}>
      {labels[status] ?? status}
    </span>
  );
}

function AfiliacoesPage() {
  const { organizationId } = useAuth();
  const reqFn = useServerFn(requestAffiliation);
  const listFn = useServerFn(listAffiliations);
  const reviewFn = useServerFn(reviewAffiliation);
  const cancelFn = useServerFn(cancelAffiliation);
  const statsFn = useServerFn(getConsolidatedStats);

  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState<Item[]>([]);
  const [received, setReceived] = useState<Item[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getConsolidatedStats>> | null>(null);
  const [reload, setReload] = useState(0);

  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const accessToken = await getToken();
        const [list, st] = await Promise.all([
          listFn({ data: { accessToken, organizationId } }),
          statsFn({ data: { accessToken, organizationId } }),
        ]);
        if (cancelled) return;
        setSent(list.sent as Item[]);
        setReceived(list.received as Item[]);
        setStats(st);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, reload, listFn, statsFn]);

  const handleRequest = async () => {
    if (!organizationId) return;
    const normalized = slug
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!normalized) return toast.error("Informe o slug da matriz.");
    setSubmitting(true);
    try {
      const accessToken = await getToken();
      const res = await reqFn({
        data: { accessToken, organizationId, matrixSlug: normalized, notes: notes || null },
      });
      toast.success(`Pedido enviado para ${res.matrix.name}`);
      setOpen(false);
      setSlug("");
      setNotes("");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao solicitar");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (id: string, action: "approved" | "rejected") => {
    if (!organizationId) return;
    try {
      const accessToken = await getToken();
      await reviewFn({ data: { accessToken, organizationId, affiliationId: id, action } });
      toast.success(action === "approved" ? "Aprovada" : "Rejeitada");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const handleCancel = async (id: string) => {
    if (!organizationId) return;
    try {
      const accessToken = await getToken();
      await cancelFn({ data: { accessToken, organizationId, affiliationId: id } });
      toast.success("Pedido cancelado");
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="h-6 w-6" /> Afiliações
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie a rede de academias afiliadas à sua matriz.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Solicitar afiliação
        </Button>
      </div>

      {/* Stats consolidados */}
      {stats && stats.affiliateCount > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Rede consolidada ({stats.affiliateCount} afiliada{stats.affiliateCount === 1 ? "" : "s"})</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" /> Alunos ativos
              </div>
              <div className="text-2xl font-bold">{stats.totals.activeStudents}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <DollarSign className="h-4 w-4" /> Recebido no mês
              </div>
              <div className="text-2xl font-bold">{formatBRL(stats.totals.receivedThisMonth)}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" /> Inadimplentes
              </div>
              <div className="text-2xl font-bold">{stats.totals.overdueCount}</div>
            </div>
          </div>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Organização</th>
                  <th className="text-left p-2">Nível</th>
                  <th className="text-right p-2">Alunos</th>
                  <th className="text-right p-2">Recebido (mês)</th>
                  <th className="text-right p-2">Inadimplentes</th>
                </tr>
              </thead>
              <tbody>
                {stats.perOrg.map((r) => (
                  <tr key={r.org.id} className="border-t">
                    <td className="p-2">
                      <div className="font-medium">{r.org.name}</div>
                      <div className="text-xs text-muted-foreground">{r.org.slug}</div>
                    </td>
                    <td className="p-2">{r.depth === 0 ? "Matriz" : `N${r.depth}`}</td>
                    <td className="p-2 text-right">{r.activeStudents}</td>
                    <td className="p-2 text-right">{formatBRL(r.receivedThisMonth)}</td>
                    <td className="p-2 text-right">{r.overdueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Tabs defaultValue="received">
        <TabsList>
          <TabsTrigger value="received">Recebidos ({received.length})</TabsTrigger>
          <TabsTrigger value="sent">Enviados ({sent.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="space-y-2 mt-3">
          {received.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido recebido.</p>
          ) : (
            received.map((r) => (
              <div key={r.id} className="rounded border p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{r.org.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.org.slug} · {new Date(r.requested_at).toLocaleDateString("pt-BR")}
                  </div>
                  {r.notes && <div className="text-sm mt-1">{r.notes}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === "pending" && (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => handleReview(r.id, "approved")}>
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleReview(r.id, "rejected")}>
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="sent" className="space-y-2 mt-3">
          {sent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido enviado.</p>
          ) : (
            sent.map((r) => (
              <div key={r.id} className="rounded border p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{r.org.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.org.slug} · {new Date(r.requested_at).toLocaleDateString("pt-BR")}
                  </div>
                  {r.notes && <div className="text-sm mt-1">{r.notes}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {(r.status === "pending" || r.status === "rejected") && (
                    <Button size="icon" variant="ghost" onClick={() => handleCancel(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar afiliação a uma matriz</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="slug">Slug da matriz</Label>
              <Input
                id="slug"
                placeholder="ex: CT Orelha Figth"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Peça o slug à matriz (aparece no endereço/cadastro dela).
              </p>
            </div>
            <div>
              <Label htmlFor="notes">Mensagem (opcional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleRequest} disabled={submitting}>
              {submitting ? "Enviando..." : "Enviar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
