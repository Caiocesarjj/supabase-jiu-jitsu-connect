import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, RefreshCw, QrCode } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { supabase } from "@/lib/supabase";
import {
  getStudentCredentials,
  regenerateCredentialField,
  updateCredentialIds,
  listStudentAttendance,
} from "@/lib/access.functions";
import { QrCodeView } from "@/components/access/QrScanner";

interface Credential {
  access_code: string;
  pin_code: string;
  qr_code: string;
  rfid_uid: string | null;
  biometric_id: string | null;
  face_id: string | null;
  active: boolean;
}

export function StudentCredentialsPanel({
  organizationId,
  studentId,
}: {
  organizationId: string;
  studentId: string;
}) {
  const get = useServerFn(getStudentCredentials);
  const regen = useServerFn(regenerateCredentialField);
  const updateIds = useServerFn(updateCredentialIds);
  const listAtt = useServerFn(listStudentAttendance);
  const [cred, setCred] = useState<Credential | null>(null);
  const [loading, setLoading] = useState(true);
  const [rfid, setRfid] = useState("");
  const [attendance, setAttendance] = useState<unknown[]>([]);

  async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T | null> {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast.error("Sessão inválida.");
      return null;
    }
    return fn(accessToken);
  }

  async function reload() {
    setLoading(true);
    await withToken(async (accessToken) => {
      const [c, a] = await Promise.all([
        get({ data: { accessToken, organizationId, studentId } }),
        listAtt({ data: { accessToken, organizationId, studentId, limit: 10 } }),
      ]);
      const cc = c.credential as Credential;
      setCred(cc);
      setRfid(cc.rfid_uid ?? "");
      setAttendance(a.records as unknown[]);
    });
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, studentId]);

  async function regenerate(field: "access_code" | "pin_code" | "qr_code") {
    await withToken(async (accessToken) => {
      const res = await regen({
        data: { accessToken, organizationId, studentId, field },
      });
      setCred(res.credential as Credential);
      toast.success("Regenerado.");
    });
  }

  async function saveRfid() {
    await withToken(async (accessToken) => {
      const res = await updateIds({
        data: { accessToken, organizationId, studentId, rfid_uid: rfid.trim() || null },
      });
      setCred(res.credential as Credential);
      toast.success("RFID atualizado.");
    });
  }

  if (loading || !cred) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <LoadingSpinner label="Carregando credenciais..." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Credenciais de Acesso
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <QrCodeView value={cred.qr_code} size={180} />
          <Button size="sm" variant="outline" onClick={() => regenerate("qr_code")}>
            <QrCode className="h-3 w-3 mr-1" /> Regenerar QR
          </Button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Código de acesso</Label>
              <div className="flex gap-2">
                <Input value={cred.access_code} readOnly className="font-mono tracking-widest" />
                <Button size="icon" variant="outline" onClick={() => regenerate("access_code")}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div>
              <Label>PIN</Label>
              <div className="flex gap-2">
                <Input value={cred.pin_code} readOnly className="font-mono tracking-widest" />
                <Button size="icon" variant="outline" onClick={() => regenerate("pin_code")}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <div>
            <Label>RFID / Cartão</Label>
            <div className="flex gap-2">
              <Input
                value={rfid}
                onChange={(e) => setRfid(e.target.value)}
                placeholder="UID do cartão"
              />
              <Button onClick={saveRfid}>Salvar</Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Biometria e reconhecimento facial são sincronizados pelo dispositivo.
            </p>
          </div>

          <div>
            <Label className="mb-1 block">Últimos acessos</Label>
            {attendance.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum acesso registrado.</p>
            ) : (
              <ul className="divide-y rounded border text-sm">
                {attendance.map((r) => {
                  const rec = r as { id: string; checkin_at: string; access_method: string };
                  return (
                    <li key={rec.id} className="flex items-center justify-between px-3 py-1.5">
                      <span>
                        {new Date(rec.checkin_at).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <span className="text-xs text-muted-foreground">{rec.access_method}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
