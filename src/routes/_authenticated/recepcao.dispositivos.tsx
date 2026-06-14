import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cpu, Plus, Trash2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  listAccessDevices,
  upsertAccessDevice,
  deleteAccessDevice,
  testDeviceConnection,
} from "@/lib/access.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export const Route = createFileRoute("/_authenticated/recepcao/dispositivos")({
  component: DispositivosPage,
});

interface Device {
  id?: string;
  name: string;
  manufacturer: "control_id" | "henry" | "topdata" | "mock" | "other";
  model: string | null;
  ip_address: string | null;
  port: number | null;
  api_token: string | null;
  active: boolean;
  last_seen_at?: string | null;
}

const EMPTY: Device = {
  name: "",
  manufacturer: "control_id",
  model: null,
  ip_address: null,
  port: null,
  api_token: null,
  active: true,
};

function DispositivosPage() {
  const { organizationId } = useAuth();
  const list = useServerFn(listAccessDevices);
  const upsert = useServerFn(upsertAccessDevice);
  const remove = useServerFn(deleteAccessDevice);
  const test = useServerFn(testDeviceConnection);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Device>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function reload() {
    if (!organizationId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await list({ data: { accessToken, organizationId } });
      setDevices(res.devices as Device[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function save() {
    if (!organizationId || !form.name.trim()) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return;
    try {
      await upsert({
        data: {
          accessToken,
          organizationId,
          device: { ...form, id: editingId ?? undefined },
        },
      });
      toast.success(editingId ? "Dispositivo atualizado." : "Dispositivo cadastrado.");
      setForm(EMPTY);
      setEditingId(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  async function del(id: string) {
    if (!organizationId) return;
    if (!confirm("Remover dispositivo?")) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return;
    await remove({ data: { accessToken, organizationId, deviceId: id } });
    reload();
  }

  async function testConn(id: string) {
    if (!organizationId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return;
    try {
      const res = await test({ data: { accessToken, organizationId, deviceId: id } });
      if (res.ok) toast.success("Conexão OK");
      else toast.error(res.error ?? "Falha na conexão");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na conexão");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Cpu className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dispositivos</h1>
          <p className="text-sm text-muted-foreground">
            Catracas, leitores e equipamentos de controle de acesso.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center p-6">
                <LoadingSpinner label="Carregando..." />
              </div>
            ) : devices.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Nenhum dispositivo cadastrado.
              </p>
            ) : (
              <ul className="divide-y">
                {devices.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.manufacturer} {d.model ? `· ${d.model}` : ""} {d.ip_address ? `· ${d.ip_address}${d.port ? `:${d.port}` : ""}` : ""}
                      </div>
                    </div>
                    <span
                      className={`text-xs rounded-full border px-2 py-0.5 ${
                        d.active
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-gray-100 text-gray-700 border-gray-300"
                      }`}
                    >
                      {d.active ? "Ativo" : "Inativo"}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => testConn(d.id!)}>
                      <RefreshCw className="h-3 w-3 mr-1" /> Testar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setForm(d);
                        setEditingId(d.id ?? null);
                      }}
                    >
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del(d.id!)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" />
              {editingId ? "Editar dispositivo" : "Novo dispositivo"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Catraca principal"
              />
            </div>
            <div>
              <Label>Fabricante</Label>
              <Select
                value={form.manufacturer}
                onValueChange={(v) => setForm({ ...form, manufacturer: v as Device["manufacturer"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="control_id">Control iD</SelectItem>
                  <SelectItem value="henry">Henry</SelectItem>
                  <SelectItem value="topdata">TopData</SelectItem>
                  <SelectItem value="mock">Manual (Recepção)</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modelo</Label>
              <Input
                value={form.model ?? ""}
                onChange={(e) => setForm({ ...form, model: e.target.value || null })}
              />
            </div>
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <div>
                <Label>IP</Label>
                <Input
                  value={form.ip_address ?? ""}
                  onChange={(e) => setForm({ ...form, ip_address: e.target.value || null })}
                  placeholder="192.168.0.10"
                />
              </div>
              <div>
                <Label>Porta</Label>
                <Input
                  type="number"
                  value={form.port ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, port: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Token API</Label>
              <Input
                type="password"
                value={form.api_token ?? ""}
                onChange={(e) => setForm({ ...form, api_token: e.target.value || null })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Ativo</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={save} className="flex-1">
                {editingId ? "Salvar alterações" : "Cadastrar"}
              </Button>
              {editingId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setForm(EMPTY);
                    setEditingId(null);
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
