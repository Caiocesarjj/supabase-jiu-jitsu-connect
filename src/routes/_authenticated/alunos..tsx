
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
