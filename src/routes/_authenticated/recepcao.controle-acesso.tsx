import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DoorOpen, Hash, Keyboard, QrCode as QrCodeIcon, History } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  validateAccessAttempt,
  listTodayAttendance,
} from "@/lib/access.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessResultCard } from "@/components/access/AccessResultCard";
import { QrScanner } from "@/components/access/QrScanner";

export const Route = createFileRoute("/_authenticated/recepcao/controle-acesso")({
  component: ControleAcessoPage,
});

type Method = "qr" | "code" | "pin";

interface AttemptResult {
  allowed: boolean;
  reason: string | null;
  student: {
    id: string;
    full_name: string | null;
    belt: string | null;
    photo_url: string | null;
  } | null;
  checkinAt: string | null;
}

function ControleAcessoPage() {
  const { organizationId } = useAuth();
  const validate = useServerFn(validateAccessAttempt);
  const listToday = useServerFn(listTodayAttendance);

  const [method, setMethod] = useState<Method>("qr");
  const [codeValue, setCodeValue] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [today, setToday] = useState<unknown[]>([]);

  async function refreshToday() {
    if (!organizationId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return;
    try {
      const res = await listToday({ data: { accessToken, organizationId } });
      setToday(res.records as unknown[]);
    } catch {
      // silencioso
    }
  }

  useEffect(() => {
    refreshToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function attempt(m: Method, value: string) {
    if (!organizationId || !value.trim() || busy) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast.error("Sessão inválida.");
      return;
    }
    setBusy(true);
    try {
      const res = await validate({
        data: { accessToken, organizationId, method: m, value: value.trim() },
      });
      setResult(res as AttemptResult);
      if ((res as AttemptResult).allowed) refreshToday();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao validar acesso");
    } finally {
      setBusy(false);
    }
  }

  const todayList = useMemo(
    () =>
      today.map((r) => {
        const rec = r as {
          id: string;
          checkin_at: string;
          access_method: string;
          students?: { profiles?: { full_name?: string } | null } | null;
        };
        return {
          id: rec.id,
          name: rec.students?.profiles?.full_name ?? "Aluno",
          method: rec.access_method,
          time: new Date(rec.checkin_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
      }),
    [today],
  );

  function reset() {
    setResult(null);
    setCodeValue("");
    setPinValue("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <DoorOpen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Controle de Acesso</h1>
          <p className="text-sm text-muted-foreground">
            Recepção · valide entradas por QR Code, código ou PIN.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {result ? (
            <AccessResultCard
              allowed={result.allowed}
              reason={result.reason}
              student={result.student}
              checkinAt={result.checkinAt}
              onReset={reset}
              onSendCharge={
                result.student
                  ? () => {
                      toast.info("Abra a ficha do aluno para enviar a cobrança.");
                    }
                  : undefined
              }
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Validar entrada</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={method} onValueChange={(v) => setMethod(v as Method)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="qr">
                      <QrCodeIcon className="h-4 w-4 mr-1" /> QR Code
                    </TabsTrigger>
                    <TabsTrigger value="code">
                      <Hash className="h-4 w-4 mr-1" /> Código
                    </TabsTrigger>
                    <TabsTrigger value="pin">
                      <Keyboard className="h-4 w-4 mr-1" /> PIN
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="qr" className="mt-4 space-y-3">
                    <QrScanner active={method === "qr"} onScan={(v) => attempt("qr", v)} />
                    <p className="text-xs text-muted-foreground">
                      Aponte o QR Code do aluno para a câmera.
                    </p>
                  </TabsContent>

                  <TabsContent value="code" className="mt-4 space-y-3">
                    <Label>Código de acesso (6 dígitos)</Label>
                    <Input
                      value={codeValue}
                      onChange={(e) => setCodeValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") attempt("code", codeValue);
                      }}
                      inputMode="numeric"
                      maxLength={12}
                      placeholder="000000"
                      autoFocus
                    />
                    <Button onClick={() => attempt("code", codeValue)} disabled={busy}>
                      Validar
                    </Button>
                  </TabsContent>

                  <TabsContent value="pin" className="mt-4 space-y-3">
                    <Label>PIN (4 dígitos)</Label>
                    <Input
                      value={pinValue}
                      onChange={(e) => setPinValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") attempt("pin", pinValue);
                      }}
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="0000"
                      autoFocus
                    />
                    <Button onClick={() => attempt("pin", pinValue)} disabled={busy}>
                      Validar
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Entradas de hoje
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[60vh] overflow-y-auto p-0">
            {todayList.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhuma entrada ainda.</p>
            ) : (
              <ul className="divide-y">
                {todayList.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
