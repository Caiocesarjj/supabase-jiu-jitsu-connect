import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  getOrganizationConfig,
  updateAcademyConfig,
  updateFinancialConfig,
  updateIntegrationsConfig,
  updateWhatsappConfig,
} from "@/lib/registrations.functions";
import { formatDateBR } from "@/lib/format";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: ConfiguracoesPage,
  head: () => ({ meta: [{ title: "Configurações — JJ Manager" }] }),
});

interface Org {
  id: string;
  name: string;
  phone: string | null;
  email: string;
  logo_url: string | null;
  plan: string | null;
  trial_ends_at: string | null;
  public_code: string | null;
}


interface Settings {
  organization_id: string;
  monthly_fee_default: number;
  due_day: number;
  pix_key: string | null;
  pix_key_type: string | null;
  whatsapp_notifications: boolean;
  botbot_token: string | null;
  charge_reminder_days: number[] | null;
  payment_gateway: string | null;
  payment_gateway_api_key: string | null;
}

function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function pixPlaceholder(type: string | null): string {
  switch (type) {
    case "cpf":
      return "000.000.000-00";
    case "cnpj":
      return "00.000.000/0000-00";
    case "email":
      return "email@exemplo.com";
    case "phone":
      return "(11) 90000-0000";
    case "random":
      return "chave aleatória";
    default:
      return "";
  }
}

function ConfiguracoesPage() {
  const { organizationId, user, profile, refreshProfile } = useAuth();
  const getConfig = useServerFn(getOrganizationConfig);
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Org | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      const result = await getConfig({ data: { accessToken } });
      setOrg(result.org as Org);
      setSettings(result.settings as Settings);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar configurações.");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  if (loading || !org || !settings) {
    return <LoadingSpinner label="Carregando..." />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      <Tabs defaultValue="academia" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
          <TabsTrigger value="academia">Academia</TabsTrigger>
          <TabsTrigger value="plano">Plano</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="conta">Conta</TabsTrigger>
        </TabsList>

        <TabsContent value="academia" className="mt-6">
          <AcademySection
            org={org}
            onSaved={async () => {
              await refreshProfile();
              await load();
            }}
          />
        </TabsContent>

        <TabsContent value="plano" className="mt-6">
          <PlanSection org={org} />
        </TabsContent>

        <TabsContent value="financeiro" className="mt-6">
          <FinancialSection
            settings={settings}
            organizationId={organizationId!}
            onSaved={load}
          />
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-6">
          <WhatsappSection
            settings={settings}
            organizationId={organizationId!}
            onSaved={load}
          />
        </TabsContent>

        <TabsContent value="integracoes" className="mt-6">
          <IntegrationsSection
            settings={settings}
            organizationId={organizationId!}
            onSaved={load}
          />
        </TabsContent>

        <TabsContent value="conta" className="mt-6">
          <AccountSection
            userEmail={user?.email ?? ""}
            userName={profile?.full_name ?? ""}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-lg font-semibold">{title}</h2>;
}

function SaveButton({ saving }: { saving: boolean }) {
  return (
    <Button type="submit" disabled={saving}>
      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Salvar
    </Button>
  );
}

function AcademySection({ org, onSaved }: { org: Org; onSaved: () => Promise<void> }) {
  const updateAcademy = useServerFn(updateAcademyConfig);
  const [name, setName] = useState(org.name);
  const [phone, setPhone] = useState(org.phone ?? "");
  const [email, setEmail] = useState(org.email);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      await updateAcademy({
        data: { accessToken, organizationId: org.id, name, phone: phone || null, email },
      });
      toast.success("Academia atualizada.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <SectionHeader title="Academia" />
      {org.public_code && (
        <div className="space-y-1">
          <Label>Código da academia</Label>
          <div className="flex gap-2">
            <Input value={org.public_code} readOnly className="font-mono" />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(org.public_code!);
                toast.success("Código copiado");
              }}
            >
              Copiar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Compartilhe este código (ou o e-mail abaixo) com academias filiadas para que elas solicitem afiliação.
          </p>
        </div>
      )}
      <div className="space-y-1">
        <Label>Nome da academia</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="space-y-1">
        <Label>Telefone</Label>
        <Input
          value={phone}
          onChange={(e) => setPhone(maskPhone(e.target.value))}
          placeholder="(00) 00000-0000"
        />
      </div>
      <div className="space-y-1">
        <Label>E-mail de contato</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <SaveButton saving={saving} />
    </form>
  );
}


function PlanSection({ org }: { org: Org }) {
  const plan = org.plan ?? "starter";
  const planLabel = plan === "pro" ? "Pro" : plan === "scale" ? "Scale" : "Starter";
  const trialActive = org.trial_ends_at && new Date(org.trial_ends_at) > new Date();
  const trialEnded = org.trial_ends_at && new Date(org.trial_ends_at) <= new Date();
  return (
    <div className="space-y-3">
      <SectionHeader title="Plano atual" />
      <div className="rounded-md border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Plano:</span>
          <Badge variant="secondary">{planLabel}</Badge>
        </div>
        {trialActive && <p className="text-sm">Trial até {formatDateBR(org.trial_ends_at!)}</p>}
        {trialEnded && <p className="text-sm text-red-600">Trial encerrado</p>}
        <p className="text-sm text-muted-foreground">
          Para mudar de plano,{" "}
          <a href="mailto:suporte@jjmanager.com" className="text-primary underline">
            entre em contato
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function FinancialSection({
  settings,
  organizationId,
  onSaved,
}: {
  settings: Settings;
  organizationId: string;
  onSaved: () => Promise<void>;
}) {
  const [fee, setFee] = useState(String(settings.monthly_fee_default ?? ""));
  const [dueDay, setDueDay] = useState(String(settings.due_day ?? 10));
  const [pixType, setPixType] = useState(settings.pix_key_type ?? "");
  const [pixKey, setPixKey] = useState(settings.pix_key ?? "");
  const [saving, setSaving] = useState(false);
  const updateFinancial = useServerFn(updateFinancialConfig);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      await updateFinancial({
        data: {
          accessToken,
          organizationId,
          monthlyFeeDefault: parseFloat(fee) || 0,
          dueDay: parseInt(dueDay, 10) || 10,
          pixKeyType: pixType || null,
          pixKey: pixKey || null,
        },
      });
      toast.success("Configurações financeiras atualizadas.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    }
    setSaving(false);
  };


  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <SectionHeader title="Financeiro" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Mensalidade padrão (R$)</Label>
          <Input type="number" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Dia de vencimento</Label>
          <Input
            type="number"
            min={1}
            max={28}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Tipo da chave PIX</Label>
          <Select value={pixType} onValueChange={setPixType}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cpf">CPF</SelectItem>
              <SelectItem value="cnpj">CNPJ</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="phone">Telefone</SelectItem>
              <SelectItem value="random">Chave aleatória</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Chave PIX</Label>
          <Input
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder={pixPlaceholder(pixType)}
          />
        </div>
      </div>
      <SaveButton saving={saving} />
    </form>
  );
}

function WhatsappSection({
  settings,
  organizationId,
  onSaved,
}: {
  settings: Settings;
  organizationId: string;
  onSaved: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(!!settings.whatsapp_notifications);
  const [token, setToken] = useState(settings.botbot_token ?? "");
  const [showToken, setShowToken] = useState(false);
  const initialDays = settings.charge_reminder_days ?? [];
  const [dMinus3, setDMinus3] = useState(initialDays.includes(-3));
  const [dZero, setDZero] = useState(initialDays.includes(0));
  const [dPlus3, setDPlus3] = useState(initialDays.includes(3));
  const [saving, setSaving] = useState(false);
  const updateWhatsapp = useServerFn(updateWhatsappConfig);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const days = [dMinus3 ? -3 : null, dZero ? 0 : null, dPlus3 ? 3 : null].filter(
      (v): v is number => v !== null,
    );
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      await updateWhatsapp({
        data: {
          accessToken,
          organizationId,
          whatsappNotifications: enabled,
          botbotToken: enabled ? token : null,
          chargeReminderDays: enabled ? days : [],
        },
      });
      toast.success("Notificações atualizadas.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    }
    setSaving(false);
  };


  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <SectionHeader title="Notificações WhatsApp" />
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={setEnabled} id="wpp" />
        <Label htmlFor="wpp" className="cursor-pointer">
          Ativar notificações automáticas de cobrança via WhatsApp
        </Label>
      </div>
      {enabled && (
        <div className="space-y-3 pl-2">
          <div className="space-y-1">
            <Label>Token do BotBot.chat</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="absolute right-2 top-2.5 text-muted-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Dias de disparo</Label>
            <div className="flex items-center gap-2">
              <Checkbox id="d-3" checked={dMinus3} onCheckedChange={(v) => setDMinus3(!!v)} />
              <Label htmlFor="d-3" className="cursor-pointer">
                D-3 (3 dias antes do vencimento)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="d0" checked={dZero} onCheckedChange={(v) => setDZero(!!v)} />
              <Label htmlFor="d0" className="cursor-pointer">
                D0 (no dia do vencimento)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="d3" checked={dPlus3} onCheckedChange={(v) => setDPlus3(!!v)} />
              <Label htmlFor="d3" className="cursor-pointer">
                D+3 (3 dias após o vencimento)
              </Label>
            </div>
          </div>
        </div>
      )}
      <SaveButton saving={saving} />
    </form>
  );
}

function IntegrationsSection({
  settings,
  organizationId,
  onSaved,
}: {
  settings: Settings;
  organizationId: string;
  onSaved: () => Promise<void>;
}) {
  const [provider, setProvider] = useState(settings.payment_gateway ?? "");
  const [apiKey, setApiKey] = useState(settings.payment_gateway_api_key ?? "");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const updateIntegrations = useServerFn(updateIntegrationsConfig);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      await updateIntegrations({
        data: {
          accessToken,
          organizationId,
          paymentGateway: provider || null,
          paymentGatewayApiKey: apiKey || null,
        },
      });
      toast.success("Integração atualizada.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    }
    setSaving(false);
  };


  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <SectionHeader title="Integrações" />
      <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
        A API key é armazenada de forma segura e usada apenas para geração de cobranças PIX.
      </div>
      <div className="space-y-1">
        <Label>Provedor</Label>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asaas">Asaas</SelectItem>
            <SelectItem value="mercadopago">Mercado Pago</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>API Key</Label>
        <div className="relative">
          <Input
            type={show ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-2.5 text-muted-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <SaveButton saving={saving} />
    </form>
  );
}

function AccountSection({ userEmail, userName }: { userEmail: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const handleChange = async () => {
    if (pwd.length < 8) {
      toast.error("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (pwd !== confirm) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Senha alterada com sucesso.");
      setPwd("");
      setConfirm("");
      setOpen(false);
    }
  };

  return (
    <div className="space-y-3">
      <SectionHeader title="Conta" />
      <div className="text-sm">
        <p>
          <span className="text-muted-foreground">Nome:</span> {userName}
        </p>
        <p>
          <span className="text-muted-foreground">E-mail:</span> {userEmail}
        </p>
      </div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Alterar senha
      </Button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nova senha</Label>
              <PasswordInput value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Confirmar nova senha</Label>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleChange} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
