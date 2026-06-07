import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Loader2, CreditCard, Link as LinkIcon, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  listPaymentIntegrations,
  savePaymentIntegration,
  setActivePaymentIntegration,
  testPaymentIntegration,
} from "@/lib/registrations.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Provider = "manual" | "link" | "asaas" | "mercadopago" | "pagseguro" | "infinitepay";

interface IntegrationRow {
  id: string;
  provider: Provider;
  credentials_json: Record<string, unknown>;
  active: boolean;
  updated_at: string;
}

const PROVIDERS: { id: Provider; name: string; description: string }[] = [
  { id: "manual", name: "Manual", description: "Sem integração — registre pagamentos manualmente." },
  { id: "link", name: "Link de Pagamento", description: "Use um link fixo (Nubank, PagBank, etc.)." },
  { id: "asaas", name: "Asaas", description: "PIX, boleto e cartão com webhook automático." },
  { id: "mercadopago", name: "Mercado Pago", description: "Cobrança via Preference + webhook." },
  { id: "pagseguro", name: "PagSeguro", description: "Cobrança via API PagSeguro." },
  { id: "infinitepay", name: "InfinitePay", description: "Link base de cobrança InfinitePay." },
];

async function getToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão inválida. Faça login novamente.");
  return token;
}

export function PaymentIntegrationsSection({ organizationId }: { organizationId: string }) {
  const list = useServerFn(listPaymentIntegrations);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [tab, setTab] = useState<Provider>("asaas");

  const reload = async () => {
    setLoading(true);
    try {
      const accessToken = await getToken();
      const result = await list({ data: { accessToken, organizationId } });
      setRows((result.integrations ?? []) as IntegrationRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar integrações.");
    }
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const activeRow = rows.find((r) => r.active) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pagamentos</h2>
          <p className="text-sm text-muted-foreground">
            Configure o meio de pagamento da sua academia. Apenas um pode ficar ativo por vez.
          </p>
        </div>
        {activeRow && (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {PROVIDERS.find((p) => p.id === activeRow.provider)?.name} ativo
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PROVIDERS.map((p) => {
              const row = rows.find((r) => r.provider === p.id);
              const isActive = row?.active === true;
              const Icon = p.id === "link" ? LinkIcon : p.id === "manual" ? Wallet : CreditCard;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setTab(p.id)}
                  className={`rounded-xl border bg-card p-4 text-left transition hover:border-primary/60 ${
                    tab === p.id ? "border-primary ring-1 ring-primary/30" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Icon className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      </div>
                    </div>
                    {isActive && (
                      <Badge variant="default" className="shrink-0">Ativo</Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Provider)} className="w-full">
            <TabsList className="hidden">
              {PROVIDERS.map((p) => (
                <TabsTrigger key={p.id} value={p.id}>{p.name}</TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="asaas">
              <ProviderForm
                provider="asaas"
                organizationId={organizationId}
                current={rows.find((r) => r.provider === "asaas")}
                onSaved={reload}
                fields={[
                  { key: "apiKey", label: "API Key", type: "password", placeholder: "Sua chave de API Asaas" },
                  { key: "environment", label: "Ambiente", type: "select", options: [
                    { value: "sandbox", label: "Sandbox" },
                    { value: "production", label: "Produção" },
                  ], defaultValue: "sandbox" },
                ]}
              />
            </TabsContent>

            <TabsContent value="mercadopago">
              <ProviderForm
                provider="mercadopago"
                organizationId={organizationId}
                current={rows.find((r) => r.provider === "mercadopago")}
                onSaved={reload}
                fields={[
                  { key: "accessToken", label: "Access Token", type: "password", placeholder: "APP_USR-..." },
                  { key: "publicKey", label: "Public Key", type: "text", placeholder: "APP_USR-..." },
                ]}
              />
            </TabsContent>

            <TabsContent value="pagseguro">
              <ProviderForm
                provider="pagseguro"
                organizationId={organizationId}
                current={rows.find((r) => r.provider === "pagseguro")}
                onSaved={reload}
                fields={[
                  { key: "token", label: "Token", type: "password", placeholder: "Token de integração" },
                  { key: "email", label: "E-mail da conta", type: "text", placeholder: "voce@email.com" },
                ]}
              />
            </TabsContent>

            <TabsContent value="infinitepay">
              <ProviderForm
                provider="infinitepay"
                organizationId={organizationId}
                current={rows.find((r) => r.provider === "infinitepay")}
                onSaved={reload}
                fields={[
                  { key: "baseUrl", label: "Link Base de Cobrança", type: "text", placeholder: "https://infinitepay.io/sua-loja" },
                ]}
              />
            </TabsContent>

            <TabsContent value="link">
              <ProviderForm
                provider="link"
                organizationId={organizationId}
                current={rows.find((r) => r.provider === "link")}
                onSaved={reload}
                fields={[
                  { key: "paymentUrl", label: "URL de Pagamento", type: "text", placeholder: "https://mpago.la/..." },
                ]}
              />
            </TabsContent>

            <TabsContent value="manual">
              <ProviderForm
                provider="manual"
                organizationId={organizationId}
                current={rows.find((r) => r.provider === "manual")}
                onSaved={reload}
                fields={[]}
                helper="No modo manual, as cobranças são registradas no sistema sem integração externa."
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  placeholder?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
}

function ProviderForm({
  provider,
  organizationId,
  current,
  onSaved,
  fields,
  helper,
}: {
  provider: Provider;
  organizationId: string;
  current?: IntegrationRow;
  onSaved: () => Promise<void>;
  fields: FieldDef[];
  helper?: string;
}) {
  const save = useServerFn(savePaymentIntegration);
  const test = useServerFn(testPaymentIntegration);
  const activate = useServerFn(setActivePaymentIntegration);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      const cur = (current?.credentials_json ?? {}) as Record<string, unknown>;
      initial[f.key] = String(cur[f.key] ?? f.defaultValue ?? "");
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const isActive = current?.active === true;

  const handleSave = async (alsoActivate = false) => {
    setSaving(true);
    try {
      const accessToken = await getToken();
      await save({
        data: {
          accessToken,
          organizationId,
          provider,
          credentials: values,
          setActive: alsoActivate,
        },
      });
      toast.success(alsoActivate ? "Salvo e ativado." : "Configuração salva.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const accessToken = await getToken();
      const result = await test({
        data: { accessToken, organizationId, provider, credentials: values },
      });
      toast.success(result.info ?? "Conexão OK.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no teste de conexão.");
    }
    setTesting(false);
  };

  const handleActivate = async () => {
    try {
      const accessToken = await getToken();
      await activate({ data: { accessToken, organizationId, provider } });
      toast.success("Provedor ativado.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao ativar.");
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4 mt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">
          {PROVIDERS.find((p) => p.id === provider)?.name}
        </h3>
        {isActive ? (
          <Badge variant="default">Ativo</Badge>
        ) : (
          current && (
            <Button type="button" variant="outline" size="sm" onClick={handleActivate}>
              Ativar
            </Button>
          )
        )}
      </div>

      {helper && <p className="text-sm text-muted-foreground">{helper}</p>}

      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label>{f.label}</Label>
          {f.type === "password" ? (
            <PasswordInput
              value={values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              placeholder={f.placeholder}
            />
          ) : f.type === "select" ? (
            <Select
              value={values[f.key] ?? f.defaultValue ?? ""}
              onValueChange={(v) => setValues({ ...values, [f.key]: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={f.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {(f.options ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              placeholder={f.placeholder}
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-2">
        {fields.length > 0 && (
          <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Testar Conexão
          </Button>
        )}
        <Button type="button" onClick={() => handleSave(false)} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
        {!isActive && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleSave(true)}
            disabled={saving}
          >
            Salvar e ativar
          </Button>
        )}
      </div>
    </div>
  );
}
