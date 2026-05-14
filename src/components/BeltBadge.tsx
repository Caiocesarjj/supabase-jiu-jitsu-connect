import { cn } from "@/lib/utils";
import type { Belt } from "@/types/database";

const BELT_LABELS: Record<Belt, string> = {
  white: "Branca",
  blue: "Azul",
  purple: "Roxa",
  brown: "Marrom",
  black: "Preta",
  gray: "Cinza",
  yellow: "Amarela",
  orange: "Laranja",
  green: "Verde",
};

const BELT_STYLES: Record<Belt, string> = {
  white: "bg-white text-gray-900 border border-gray-300",
  blue: "bg-blue-600 text-white",
  purple: "bg-purple-700 text-white",
  brown: "bg-amber-800 text-white",
  black: "bg-black text-white",
  gray: "bg-gray-500 text-white",
  yellow: "bg-yellow-400 text-gray-900",
  orange: "bg-orange-500 text-white",
  green: "bg-emerald-600 text-white",
};

interface Props {
  belt: Belt;
  stripes?: number;
  className?: string;
}

export function BeltBadge({ belt, stripes, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        BELT_STYLES[belt],
        className,
      )}
    >
      {BELT_LABELS[belt]}
      {typeof stripes === "number" && stripes > 0 && (
        <span className="ml-1 opacity-90">{"•".repeat(Math.min(stripes, 4))}</span>
      )}
    </span>
  );
}
