import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { InstructorWizard, type InstructorFormData } from "@/components/InstructorWizard";
import type { Belt } from "@/types/database";

export const Route = createFileRoute("/_authenticated/instrutores/$instructorId/editar")({
  component: EditInstructorPage,
  head: () => ({ meta: [{ title: "Editar instrutor — JJ Manager" }] }),
});

function EditInstructorPage() {
  const { instructorId } = Route.useParams();
  const { organizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<Partial<InstructorFormData> | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select(
          "full_name, belt, degrees, phone, email, photo_url, gender, birth_date, experience_years, certifications, specialties, contract_type, payment_model, hourly_rate, monthly_salary, notes, availability",
        )
        .eq("id", instructorId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Instrutor não encontrado");
        setLoading(false);
        return;
      }
      const row = data as {
        full_name: string;
        belt: Belt;
        degrees: number;
        phone: string | null;
        email: string | null;
        photo_url: string | null;
        gender: string | null;
        birth_date: string | null;
        experience_years: number | null;
        certifications: string[] | null;
        specialties: string[] | null;
        contract_type: string | null;
        payment_model: string | null;
        hourly_rate: number | null;
        monthly_salary: number | null;
        notes: string | null;
        availability: string[] | null;
      };
      setInitial({
        fullName: row.full_name,
        belt: row.belt,
        degrees: row.degrees,
        phone: row.phone ?? "",
        email: row.email ?? "",
        photoUrl: row.photo_url ?? "",
        gender: row.gender ?? "",
        birthDate: row.birth_date ?? "",
        experienceYears: row.experience_years ? String(row.experience_years) : "",
        certifications: row.certifications ?? [],
        specialties: row.specialties ?? [],
        contractType: row.contract_type ?? "",
        paymentModel: row.payment_model === "monthly" ? "monthly" : "hourly",
        hourlyRate: row.hourly_rate ? String(row.hourly_rate) : "",
        monthlySalary: row.monthly_salary ? String(row.monthly_salary) : "",
        notes: row.notes ?? "",
        availability: row.availability ?? [],
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [instructorId, organizationId]);

  if (loading || !initial || !organizationId) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to="/instrutores/$instructorId"
        params={{ instructorId }}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="mr-1 h-4 w-4" /> Voltar ao perfil
      </Link>
      <h1 className="text-2xl font-semibold">Editar Instrutor</h1>
      <InstructorWizard
        organizationId={organizationId}
        initial={initial}
        instructorId={instructorId}
      />
    </div>
  );
}
