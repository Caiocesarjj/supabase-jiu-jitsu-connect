import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { CheckSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/presenca")({
  component: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Presença</h1>
      <EmptyState
        icon={<CheckSquare className="h-10 w-10" />}
        title="Em breve (Fase 3)"
        description="A chamada de presença será adicionada na Fase 3."
      />
    </div>
  ),
});
