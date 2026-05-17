import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

// Tempos mínimos por faixa (meses) — espelha src/lib/graduation.ts
const MIN_MONTHS: Record<string, number> = {
  branca: 0,
  azul: 24,
  roxa: 18,
  marrom: 12,
  preta: 0,
  cinza: 0,
  amarela: 0,
  laranja: 0,
  verde: 0,
  cinza_branco: 0,
  cinza_preto: 0,
  amarela_branco: 0,
  amarela_preto: 0,
  laranja_branco: 0,
  laranja_preto: 0,
  verde_branco: 0,
  verde_preto: 0,
};

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}

export const checkGraduationAlerts = createServerFn({ method: "GET" }).handler(
  async () => {
    // Admin client criado dentro do handler para garantir acesso ao process.env em runtime
    const supabaseAdmin = createClient(
      process.env.APP_SUPABASE_URL!,
      process.env.APP_SUPABASE_SERVICE_ROLE_KEY!,
    );

    const today = new Date().toISOString().split("T")[0];
    let processed = 0;
    let updated = 0;
    let alreadyEligible = 0;

    const { data: graduations, error } = await supabaseAdmin
      .from("graduations")
      .select(
        `
        id, belt, degrees, promotion_date, minimum_next_promotion_date,
        students ( id, status, birth_date )
      `,
      );

    if (error || !graduations) {
      console.error("check-graduation-alerts: fetch failed", error);
      return {
        ok: false as const,
        error: error?.message ?? "unknown error",
      };
    }

    for (const grad of graduations as unknown as Array<{
      id: string;
      belt: string;
      degrees: number;
      promotion_date: string;
      minimum_next_promotion_date: string | null;
      students:
        | { id: string; status: string; birth_date: string | null }
        | Array<{ id: string; status: string; birth_date: string | null }>
        | null;
    }>) {
      const student = Array.isArray(grad.students)
        ? grad.students[0]
        : grad.students;
      if (!student || student.status !== "active") continue;

      processed++;

      const months = MIN_MONTHS[grad.belt] ?? 0;

      if (grad.minimum_next_promotion_date) {
        if (grad.minimum_next_promotion_date <= today) alreadyEligible++;
        continue;
      }

      if (months > 0) {
        const minDate = addMonths(grad.promotion_date, months);
        await supabaseAdmin
          .from("graduations")
          .update({ minimum_next_promotion_date: minDate })
          .eq("id", grad.id);
        updated++;
        if (minDate <= today) alreadyEligible++;
      }
    }

    return {
      ok: true as const,
      processed,
      updated,
      alreadyEligible,
      runAt: new Date().toISOString(),
    };
  },
);
