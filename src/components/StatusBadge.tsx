import { cn } from "@/lib/utils";
import type { FinancialStatus } from "@/types/database";

const LABELS: Record<FinancialStatus, string> = {
  pending: "Pendente",
  paid: "Pago",
  overdue: "Atrasado",
  canceled: "Cancelado",
};

const STYLES: Record<FinancialStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
  paid: "bg-emerald-100 text-emerald-800 border-emerald-300",
  overdue: "bg-red-100 text-red-800 border-red-300",
  canceled: "bg-gray-100 text-gray-700 border-gray-300",
};

export function StatusBadge({
  status,
  className,
}: {
  status: FinancialStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  );
}
