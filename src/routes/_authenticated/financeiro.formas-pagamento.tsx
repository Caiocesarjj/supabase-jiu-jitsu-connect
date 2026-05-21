import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, Banknote, QrCode, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/financeiro/formas-pagamento")({
  component: Page,
  head: () => ({ meta: [{ title: "Formas de Pagamento · Financeiro" }] }),
});

const DEFAULTS = [
  { type: "pix", name: "PIX", icon: QrCode, desc: "Recomendado para academias no Brasil" },
  { type: "credit", name: "Cartão de Crédito", icon: CreditCard, desc: "Aceita parcelamento" },
  { type: "debit", name: "Cartão de Débito", icon: CreditCard, desc: "Pagamento à vista" },
  { type: "boleto", name: "Boleto Bancário", icon: Receipt, desc: "Pagamento bancário" },
  { type: "cash", name: "Dinheiro", icon: Banknote, desc: "Pagamento presencial" },
];

function Page() {
  const { organizationId } = useAuth();
  const [methods, setMethods] = useState<Record<string, boolean>>({});
  const [pixKey, setPixKey] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      const [{ data: m }, { data: s }] = await Promise.all([
        supabase.from("payment_methods").select("type, active").eq("organization_id", organizationId),
        supabase.from("organization_settings").select("pix_key").eq("organization_id", organizationId).maybeSingle(),
      ]);
      const map: Record<string, boolean> = {};
      for (const row of (m ?? []) as { type: string; active: boolean }[]) map[row.type] = row.active;
      setMethods(map);
      setPixKey((s as { pix_key: string | null } | null)?.pix_key ?? null);
    })();
  }, [organizationId]);

  const toggle = async (type: string, name: string) => {
    if (!organizationId) return;
    const next = !methods[type];
    setMethods({ ...methods, [type]: next });
    const { error } = await supabase
      .from("payment_methods")
      .upsert(
        { organization_id: organizationId, type, name, active: next },
        { onConflict: "organization_id,type,name" },
      );
    if (error) {
      toast.error("Tabela payment_methods não encontrada. Rode o SQL.");
      setMethods({ ...methods, [type]: !next });
    } else toast.success(`${name} ${next ? "ativado" : "desativado"}`);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {DEFAULTS.map((m) => {
        const Icon = m.icon;
        const active = methods[m.type] ?? false;
        return (
          <div key={m.type} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Icon className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.desc}</div>
                </div>
              </div>
              <Switch checked={active} onCheckedChange={() => toggle(m.type, m.name)} />
            </div>
            {m.type === "pix" && (
              <div className="mt-3 text-xs text-muted-foreground">
                Chave PIX: {pixKey ?? <span className="italic">não configurada</span>} · ajuste em Configurações &gt; Pagamentos.
              </div>
            )}
          </div>
        );
      })}
      <div className="rounded-xl border border-dashed bg-card p-4 text-center text-sm text-muted-foreground flex items-center justify-center">
        <Wallet className="h-4 w-4 mr-2" /> Adicionar método personalizado (em breve)
      </div>
    </div>
  );
}
