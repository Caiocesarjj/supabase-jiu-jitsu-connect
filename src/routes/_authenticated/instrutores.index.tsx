import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { UserPlus, UserCheck, Mail, Phone, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { BeltBadge } from "@/components/BeltBadge";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ConfirmModal";
import { deleteInstructor } from "@/lib/instructors.functions";
import type { Belt } from "@/types/database";

export const Route = createFileRoute("/_authenticated/instrutores/")({
  component: InstructorsPage,
  head: () => ({ meta: [{ title: "Instrutores — JJ Manager" }] }),
});

interface InstructorCard {
  id: string;
  full_name: string;
  belt: Belt;
  degrees: number;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  certifications: string[] | null;
  specialties: string[] | null;
  contract_type: string | null;
  active: boolean | null;
}

function InstructorsPage() {
  const navigate = useNavigate();
  const { organizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [instructors, setInstructors] = useState<InstructorCard[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select(
          "id, full_name, belt, degrees, phone, email, photo_url, certifications, specialties, contract_type, active",
        )
        .eq("organization_id", organizationId)
        .order("full_name");
      if (cancelled) return;
      if (error) toast.error("Erro ao carregar instrutores");
      setInstructors((data as InstructorCard[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner label="Carregando instrutores..." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Instrutores</h1>
        <Button
          onClick={() => navigate({ to: "/instrutores/novo" })}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <UserPlus className="mr-2 h-4 w-4" /> Cadastrar Instrutor
        </Button>
      </div>

      {instructors.length === 0 ? (
        <EmptyState
          icon={<UserCheck className="h-10 w-10" />}
          title="Nenhum instrutor cadastrado"
          action={
            <Button
              onClick={() => navigate({ to: "/instrutores/novo" })}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Cadastrar instrutor
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {instructors.map((i) => (
            <InstructorCardView key={i.id} instructor={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstructorCardView({ instructor: i }: { instructor: InstructorCard }) {
  const navigate = useNavigate();
  const specs = i.specialties ?? [];
  const visible = specs.slice(0, 3);
  const remaining = specs.length - visible.length;
  const certs = i.certifications ?? [];

  return (
    <div className="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {i.photo_url ? (
          <img
            src={i.photo_url}
            alt={i.full_name}
            className="h-24 w-24 shrink-0 rounded-full object-cover"
          />
        ) : (
          <Avatar name={i.full_name} size={96} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{i.full_name}</div>
          <div className="mt-1">
            <BeltBadge belt={i.belt} stripes={i.degrees} size="sm" />
          </div>
          {i.contract_type && (
            <div className="mt-1 text-xs text-muted-foreground">{i.contract_type}</div>
          )}
        </div>
      </div>

      {visible.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {visible.map((s) => (
            <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
              {s}
            </span>
          ))}
          {remaining > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
              +{remaining}
            </span>
          )}
        </div>
      )}

      {certs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {certs.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <Check className="h-3 w-3" /> {c}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        {i.phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="h-3 w-3" /> {i.phone}
          </div>
        )}
        {i.email && (
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{i.email}</span>
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() =>
            navigate({
              to: "/instrutores/$instructorId",
              params: { instructorId: i.id },
            })
          }
        >
          Ver perfil
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() =>
            navigate({
              to: "/instrutores/$instructorId/editar",
              params: { instructorId: i.id },
            })
          }
        >
          Editar
        </Button>
      </div>
    </div>
  );
}
