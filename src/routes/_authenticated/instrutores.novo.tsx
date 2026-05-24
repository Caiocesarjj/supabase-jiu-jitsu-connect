import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { InstructorWizard } from "@/components/InstructorWizard";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export const Route = createFileRoute("/_authenticated/instrutores/novo")({
  component: NewInstructorPage,
  head: () => ({ meta: [{ title: "Novo instrutor — JJ Manager" }] }),
});

function NewInstructorPage() {
  const { organizationId } = useAuth();
  if (!organizationId)
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  return (
    <div className="space-y-4">
      <Link
        to="/instrutores"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="mr-1 h-4 w-4" /> Voltar para instrutores
      </Link>
      <h1 className="text-2xl font-semibold">Cadastrar Instrutor</h1>
      <InstructorWizard organizationId={organizationId} />
    </div>
  );
}
