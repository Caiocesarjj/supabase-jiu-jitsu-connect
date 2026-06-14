import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Settings as SettingsIcon, Building2, CreditCard, MessageCircle, Wallet, Plug, UserCircle2, Copy, KeyRound, ShieldCheck, Send, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  getOrganizationConfig,
  sendChargeNotifications,
  updateAcademyConfig,
  updateIntegrationsConfig,
  updateWhatsappConfig,
  getWhatsappTemplates,
  updateWhatsappTemplates,
  sendTestWhatsappMessage,
} from "@/lib/registrations.functions";
import { Textarea } from "@/components/ui/textarea";
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
import { PaymentIntegrationsSection } from "@/components/PaymentIntegrationsSection";

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
  botbot_app_key: string | null;
  botbot_auth_key: string | null;
  charge_reminder_days: number[] | null;
  payment_gateway: string | null;
  payment_gateway_api_key: string | null;
  whatsapp_templates: Record<string, unknown> | null;
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
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-6">
          <TabsTrigger value="academia">Academia</TabsTrigger>
          <TabsTrigger value="plano">Plano</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
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

        <TabsContent value="whatsapp" className="mt-6 space-y-6">
          <WhatsappSection
            settings={settings}
            organizationId={organizationId!}
            onSaved={load}
          />
          <WhatsappTemplatesSection organizationId={organizationId!} />
        </TabsContent>

        <TabsContent value="pagamentos" className="mt-6">
          <PaymentIntegrationsSection organizationId={organizationId!} />
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
  const [appKey, setAppKey] = useState(settings.botbot_app_key ?? "");
  const [authKey, setAuthKey] = useState(settings.botbot_auth_key ?? "");
  const [showAppKey, setShowAppKey] = useState(false);
  const [showAuthKey, setShowAuthKey] = useState(false);
  const initialDays = settings.charge_reminder_days ?? [];
  const [dMinus7, setDMinus7] = useState(initialDays.includes(-7));
  const [dMinus3, setDMinus3] = useState(initialDays.includes(-3));
  const [dZero, setDZero] = useState(initialDays.includes(0));
  const [dPlus3, setDPlus3] = useState(initialDays.includes(3));
  const initialHours = Array.isArray((settings.whatsapp_templates as any)?.__hours)
    ? ((settings.whatsapp_templates as any).__hours as number[])
    : [];
  const [hour1, setHour1] = useState<string>(String(initialHours[0] ?? 9));
  const [hour2, setHour2] = useState<string>(initialHours[1] !== undefined ? String(initialHours[1]) : "none");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  // Test message state
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Teste de mensagem do JJ Manager ✅");
  const [testSending, setTestSending] = useState(false);
  const sendTest = useServerFn(sendTestWhatsappMessage);
  const updateWhatsapp = useServerFn(updateWhatsappConfig);
  const sendNotifications = useServerFn(sendChargeNotifications);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const days = [
      dMinus7 ? -7 : null,
      dMinus3 ? -3 : null,
      dZero ? 0 : null,
      dPlus3 ? 3 : null,
    ].filter((v): v is number => v !== null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      const hours = [
        Number(hour1),
        hour2 !== "none" ? Number(hour2) : null,
      ].filter((v): v is number => v !== null && !Number.isNaN(v));
      await updateWhatsapp({
        data: {
          accessToken,
          organizationId,
          whatsappNotifications: enabled,
          botbotToken: null,
          botbotAppKey: enabled ? appKey : null,
          botbotAuthKey: enabled ? authKey : null,
          chargeReminderDays: enabled ? days : [],
          notificationHours: enabled ? hours : [],
        },
      });
      toast.success("Notificações atualizadas.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    }
    setSaving(false);
  };

  const handleSendNow = async () => {
    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      const result = await sendNotifications({ data: { accessToken, organizationId } });
      toast.success(`Enviadas: ${result.sent} • Ignoradas: ${result.skipped} • Total: ${result.total}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar notificações.");
    }
    setSending(false);
  };

  const handleSendTest = async () => {
    setTestSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      const result = await sendTest({
        data: { accessToken, organizationId, phone: testPhone, message: testMessage },
      });
      toast.success(`Mensagem de teste enviada para ${result.phone}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar teste.");
    }
    setTestSending(false);
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
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
            <p className="text-sm font-medium">Credenciais BotBot</p>
            <div className="space-y-1">
              <Label>App Key do BotBot</Label>
              <div className="relative">
                <Input
                  type={showAppKey ? "text" : "password"}
                  value={appKey}
                  onChange={(e) => setAppKey(e.target.value)}
                  placeholder="App Key do BotBot"
                />
                <button
                  type="button"
                  onClick={() => setShowAppKey((s) => !s)}
                  className="absolute right-2 top-2.5 text-muted-foreground"
                >
                  {showAppKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Auth Key do BotBot</Label>
              <div className="relative">
                <Input
                  type={showAuthKey ? "text" : "password"}
                  value={authKey}
                  onChange={(e) => setAuthKey(e.target.value)}
                  placeholder="Auth Key do BotBot"
                />
                <button
                  type="button"
                  onClick={() => setShowAuthKey((s) => !s)}
                  className="absolute right-2 top-2.5 text-muted-foreground"
                >
                  {showAuthKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Em botbot.chat → Aplicativos → app "JJ Manager" → Configurações, copie App Key e Auth Key.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Dias de disparo</Label>
            <div className="flex items-center gap-2">
              <Checkbox id="d-7" checked={dMinus7} onCheckedChange={(v) => setDMinus7(!!v)} />
              <Label htmlFor="d-7" className="cursor-pointer">
                D-7 (7 dias antes do vencimento)
              </Label>
            </div>
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
          <div className="space-y-2">
            <Label>Horários de envio (até 2)</Label>
            <p className="text-xs text-muted-foreground">
              As notificações automáticas serão disparadas apenas nestes horários (fuso de Brasília).
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-sm">
              <div className="space-y-1">
                <Label className="text-xs">Horário 1</Label>
                <Select value={hour1} onValueChange={setHour1}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Horário 2 (opcional)</Label>
                <Select value={hour2} onValueChange={setHour2}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="none">Nenhum</SelectItem>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
            <p className="text-sm font-medium">Enviar mensagem de teste</p>
            <div className="space-y-1">
              <Label>Número (formato internacional)</Label>
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value.replace(/\D/g, "").slice(0, 15))}
                placeholder="5511999999999"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Formato: <strong>55</strong> (país) + <strong>DDD</strong> (2 dígitos) + <strong>número</strong>. Ex: 5511999999999
              </p>
            </div>
            <div className="space-y-1">
              <Label>Mensagem</Label>
              <Textarea
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                rows={3}
              />
            </div>
            <Button type="button" variant="outline" onClick={handleSendTest} disabled={testSending || !testPhone}>
              {testSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar teste agora
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <SaveButton saving={saving} />
        {enabled && (
          <Button type="button" variant="outline" onClick={handleSendNow} disabled={sending}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar notificações agora
          </Button>
        )}
      </div>
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

const TAGS = [
  { tag: "{name}", desc: "Nome do aluno" },
  { tag: "{plan_name}", desc: "Nome do plano" },
  { tag: "{plan_price}", desc: "Valor da mensalidade" },
  { tag: "{expires_at}", desc: "Data de vencimento" },
  { tag: "{academy_name}", desc: "Nome da academia" },
  { tag: "{payment_link}", desc: "Link de pagamento" },
];

function applyPreview(text: string, academyName: string) {
  return text
    .replaceAll("{name}", "João Silva")
    .replaceAll("{plan_name}", "Plano Mensal")
    .replaceAll("{plan_price}", "R$ 150,00")
    .replaceAll("{expires_at}", "10/12/2026")
    .replaceAll("{academy_name}", academyName || "Sua Academia")
    .replaceAll("{payment_link}", "https://pag.exemplo.com/123");
}

function WhatsappTemplatesSection({ organizationId }: { organizationId: string }) {
  const fetchTpl = useServerFn(getWhatsappTemplates);
  const saveTpl = useServerFn(updateWhatsappTemplates);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [dueSoon, setDueSoon] = useState("");
  const [overdue, setOverdue] = useState("");
  const [paid, setPaid] = useState("");
  const [academyName, setAcademyName] = useState("Sua Academia");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("Sessão inválida.");
        const res = await fetchTpl({ data: { accessToken, organizationId } });
        setDefaults(res.defaults);
        setDueSoon(res.templates.due_soon);
        setOverdue(res.templates.overdue);
        setPaid(res.templates.paid);
        const { data: org } = await supabase
          .from("organizations").select("name").eq("id", organizationId).maybeSingle();
        if (org?.name) setAcademyName(org.name as string);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao carregar templates");
      } finally {
        setLoading(false);
      }
    })();
  }, [organizationId, fetchTpl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");
      await saveTpl({
        data: {
          accessToken,
          organizationId,
          templates: { due_soon: dueSoon, overdue, paid },
        },
      });
      toast.success("Templates salvos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar templates");
    } finally {
      setSaving(false);
    }
  };

  const restore = (which: "due_soon" | "overdue" | "paid") => {
    if (which === "due_soon") setDueSoon(defaults.due_soon ?? "");
    if (which === "overdue") setOverdue(defaults.overdue ?? "");
    if (which === "paid") setPaid(defaults.paid ?? "");
  };

  if (loading) return <p className="text-sm text-muted-foreground">Carregando templates…</p>;

  const items: Array<{ key: "due_soon" | "overdue" | "paid"; title: string; value: string; setter: (v: string) => void }> = [
    { key: "due_soon", title: "Aviso de Vencimento", value: dueSoon, setter: setDueSoon },
    { key: "overdue", title: "Mensalidade Vencida", value: overdue, setter: setOverdue },
    { key: "paid", title: "Pagamento Confirmado", value: paid, setter: setPaid },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader title="Templates de Mensagens" />
      <div className="rounded-md border bg-muted/30 p-3 text-xs">
        <p className="font-medium mb-1">Tags disponíveis:</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TAGS.map((t) => (
            <span key={t.tag}>
              <code className="bg-background px-1 rounded">{t.tag}</code> {t.desc}
            </span>
          ))}
        </div>
      </div>

      {items.map((item) => (
        <div key={item.key} className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{item.title}</h3>
            <Button type="button" size="sm" variant="ghost" onClick={() => restore(item.key)}>
              Restaurar padrão
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Editor</Label>
              <Textarea
                value={item.value}
                onChange={(e) => item.setter(e.target.value)}
                rows={10}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Preview</Label>
              <div className="whitespace-pre-wrap rounded-md border bg-background p-3 text-sm min-h-[12rem]">
                {applyPreview(item.value, academyName)}
              </div>
            </div>
          </div>
        </div>
      ))}

      <Button onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Salvar templates
      </Button>
    </div>
  );
}
