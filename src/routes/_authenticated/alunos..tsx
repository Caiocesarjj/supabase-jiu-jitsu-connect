
// ---------- Editar aluno ----------
function EditStudentModal({
  open,
  onOpenChange,
  student,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  student: any;
  onSaved: () => void;
}) {
  const profile = student.profiles ?? {};
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [cpf, setCpf] = useState(profile.cpf ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [birthDate, setBirthDate] = useState(student.birth_date ?? "");
  const [enrollmentDate, setEnrollmentDate] = useState(student.enrollment_date ?? "");
  const [monthlyFee, setMonthlyFee] = useState<string>(
    student.monthly_fee != null ? String(student.monthly_fee) : "",
  );
  const [status, setStatus] = useState<string>(student.status ?? "active");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(profile.full_name ?? "");
    setCpf(profile.cpf ?? "");
    setPhone(profile.phone ?? "");
    setEmail(profile.email ?? "");
    setBirthDate(student.birth_date ?? "");
    setEnrollmentDate(student.enrollment_date ?? "");
    setMonthlyFee(student.monthly_fee != null ? String(student.monthly_fee) : "");
    setStatus(student.status ?? "active");
  }, [open, student]);

  const save = async () => {
    if (!fullName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      if (profile.id) {
        const { error: pe } = await supabase
          .from("profiles")
          .update({
            full_name: fullName.trim(),
            cpf: cpf || null,
            phone: phone || null,
            email: email || null,
          })
          .eq("id", profile.id);
        if (pe) throw pe;
      }

      const { error: se } = await supabase
        .from("students")
        .update({
          birth_date: birthDate || null,
          enrollment_date: enrollmentDate || null,
          monthly_fee: monthlyFee === "" ? null : Number(monthlyFee),
          status,
        })
        .eq("id", student.id);
      if (se) throw se;

      toast.success("Aluno atualizado");
      onSaved();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar aluno</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome completo *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>CPF</Label>
              <Input value={cpf} onChange={(e) => setCpf(e.target.value)} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de nascimento</Label>
              <Input type="date" value={birthDate ?? ""} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div>
              <Label>Data de matrícula</Label>
              <Input type="date" value={enrollmentDate ?? ""} onChange={(e) => setEnrollmentDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mensalidade (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(e.target.value)}
                placeholder="Padrão da academia"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                  <SelectItem value="suspended">Suspenso</SelectItem>
                  <SelectItem value="trial">Experimental</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
