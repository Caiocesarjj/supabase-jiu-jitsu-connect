import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { listTodayAttendance, listAccessLogs } from "@/lib/access.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export const Route = createFileRoute("/_authenticated/recepcao/presencas")({
  component: PresencasPage,
});

function PresencasPage() {
  const { organizationId } = useAuth();
  const today = useServerFn(listTodayAttendance);
  const logsFn = useServerFn(listAccessLogs);
  const [records, setRecords] = useState<unknown[]>([]);
  const [logs, setLogs] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) return;
      const [r1, r2] = await Promise.all([
        today({ data: { accessToken, organizationId } }),
        logsFn({ data: { accessToken, organizationId, limit: 200 } }),
      ]);
      setRecords(r1.records as unknown[]);
      setLogs(r2.logs as unknown[]);
      setLoading(false);
    })();
  }, [organizationId, today, logsFn]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Presenças e Acessos</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de entradas e tentativas registradas hoje.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entradas registradas hoje</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {records.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Sem entradas ainda.</p>
            ) : (
              <ul className="divide-y">
                {records.map((r) => {
                  const rec = r as {
                    id: string;
                    checkin_at: string;
                    access_method: string;
                    students?: { profiles?: { full_name?: string } | null } | null;
                  };
                  return (
                    <li key={rec.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span>{rec.students?.profiles?.full_name ?? "Aluno"}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(rec.checkin_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {rec.access_method}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log de tentativas</CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[60vh] overflow-auto">
            {logs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhum log.</p>
            ) : (
              <ul className="divide-y text-sm">
                {logs.map((l) => {
                  const log = l as {
                    id: string;
                    created_at: string;
                    access_method: string;
                    status: "granted" | "denied";
                    reason: string | null;
                    students?: { profiles?: { full_name?: string } | null } | null;
                  };
                  return (
                    <li key={log.id} className="flex items-center justify-between px-4 py-2">
                      <div className="min-w-0">
                        <div className="truncate">
                          {log.students?.profiles?.full_name ?? "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {log.access_method} · {log.reason ?? "ok"}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                          log.status === "granted"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                            : "bg-red-100 text-red-800 border-red-300"
                        }`}
                      >
                        {log.status === "granted" ? "OK" : "Negado"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
