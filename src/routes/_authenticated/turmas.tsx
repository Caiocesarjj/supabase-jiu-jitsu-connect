import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/turmas")({
  component: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Turmas</h1>
      <EmptyState
        icon={<Calendar className="h-10 w-10" />}
        title="Em breve (Fase 3)"
        description="O gerenciamento de turmas será adicionado na Fase 3."
      />
    </div>
  ),
});
