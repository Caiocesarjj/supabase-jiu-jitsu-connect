import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { DollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Financeiro</h1>
      <EmptyState
        icon={<DollarSign className="h-10 w-10" />}
        title="Em breve (Fase 4)"
        description="A gestão financeira será adicionada na Fase 4."
      />
    </div>
  ),
});
