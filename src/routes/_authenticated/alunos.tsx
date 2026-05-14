import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/alunos")({
  component: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Alunos</h1>
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title="Em breve (Fase 2)"
        description="A gestão de alunos será construída na próxima fase."
      />
    </div>
  ),
});
