import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DoorOpen, UserCheck, Ban, Users, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getAccessDashboard } from "@/lib/access.functions";

interface Kpis {
  presentToday: number;
  entriesToday: number;
  deniedToday: number;
  activeStudents: number;
  overdueCharges: number;
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "primary" | "success" | "danger" | "warning";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-100 text-emerald-700",
    danger: "bg-red-100 text-red-700",
    warning: "bg-amber-100 text-amber-700",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tones[tone]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
    </div>
  );
}

export function AccessKpiStrip({ organizationId }: { organizationId: string }) {
  const get = useServerFn(getAccessDashboard);
  const [kpis, setKpis] = useState<Kpis | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) return;
      try {
        const res = await get({ data: { accessToken, organizationId } });
        setKpis(res as Kpis);
      } catch {
        // silencioso — módulo opcional
      }
    })();
  }, [organizationId, get]);

  if (!kpis) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Presentes hoje"
        value={kpis.presentToday}
        icon={<UserCheck className="h-5 w-5" />}
        tone="success"
      />
      <StatCard
        label="Entradas hoje"
        value={kpis.entriesToday}
        icon={<DoorOpen className="h-5 w-5" />}
        tone="primary"
      />
      <StatCard
        label="Acessos negados"
        value={kpis.deniedToday}
        icon={<Ban className="h-5 w-5" />}
        tone="danger"
      />
      <StatCard
        label="Alunos ativos"
        value={kpis.activeStudents}
        icon={<Users className="h-5 w-5" />}
        tone="primary"
      />
      <StatCard
        label="Mensalidades vencidas"
        value={kpis.overdueCharges}
        icon={<AlertTriangle className="h-5 w-5" />}
        tone="warning"
      />
    </div>
  );
}
