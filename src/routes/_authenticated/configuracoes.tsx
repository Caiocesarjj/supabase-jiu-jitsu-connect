import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <EmptyState
        icon={<Settings className="h-10 w-10" />}
        title="Em breve (Fase 5)"
        description="As configurações da academia serão adicionadas na Fase 5."
      />
    </div>
  ),
});
