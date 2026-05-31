import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: FinanceiroLayout,
  head: () => ({ meta: [{ title: "Financeiro — JJ Manager" }] }),
});

const tabs = [
  { label: "Dashboard", to: "/financeiro/dashboard" },
  { label: "Mensalidades", to: "/financeiro/mensalidades" },
  { label: "Planos", to: "/financeiro/recorrentes" },
  { label: "Formas de Pagamento", to: "/financeiro/formas-pagamento" },
  { label: "Crescimento", to: "/financeiro/crescimento" },
] as const;

function FinanceiroLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Financeiro</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie todas as operações financeiras da academia.
        </p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => {
          const active = pathname === t.to;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
