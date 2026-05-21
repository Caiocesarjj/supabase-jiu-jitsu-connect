import { createFileRoute } from "@tanstack/react-router";
import { Repeat } from "lucide-react";

export const Route = createFileRoute("/_authenticated/financeiro/recorrentes")({
  component: Page,
  head: () => ({ meta: [{ title: "Recorrentes · Financeiro" }] }),
});

function Page() {
  return (
    <div className="rounded-xl border bg-card p-10 text-center">
      <Repeat className="h-10 w-10 mx-auto text-muted-foreground" />
      <h2 className="mt-3 text-lg font-semibold">Planos e assinaturas recorrentes</h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Em breve — crie planos (mensal, trimestral, anual) e gerencie assinaturas
        de alunos. Rode o SQL de <code>subscription_plans</code> /{" "}
        <code>subscription_records</code> para habilitar esta área.
      </p>
    </div>
  );
}
