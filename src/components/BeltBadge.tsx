import type { Belt } from "@/types/database";

const BELT_CONFIG: Record<
  Belt,
  {
    label: string;
    bg: string;
    border: string;
    friso?: string;
    textColor?: string;
  }
> = {
  // Adulto
  branca: { label: "Branca", bg: "#F5F4EF", border: "#D0CFC9", textColor: "#555" },
  azul: { label: "Azul", bg: "#1565C0", border: "#0D47A1" },
  roxa: { label: "Roxa", bg: "#7B1FA2", border: "#4A148C" },
  marrom: { label: "Marrom", bg: "#5D4037", border: "#3E2723" },
  preta: { label: "Preta", bg: "#212121", border: "#000" },
  coral: { label: "Coral", bg: "#212121", border: "#000" },
  vermelha: { label: "Vermelha", bg: "#C62828", border: "#8B0000" },
  // Infantil — sem friso
  cinza: { label: "Cinza", bg: "#9E9E9E", border: "#757575" },
  amarela: { label: "Amarela", bg: "#FDD835", border: "#F9A825", textColor: "#5D4037" },
  laranja: { label: "Laranja", bg: "#F57C00", border: "#E65100" },
  verde: { label: "Verde", bg: "#388E3C", border: "#1B5E20" },
  // Infantil — friso branco
  cinza_branco: { label: "Cinza / branco", bg: "#9E9E9E", border: "#757575", friso: "#fff" },
  amarela_branco: { label: "Amarela / branco", bg: "#FDD835", border: "#F9A825", friso: "#fff", textColor: "#5D4037" },
  laranja_branco: { label: "Laranja / branco", bg: "#F57C00", border: "#E65100", friso: "#fff" },
  verde_branco: { label: "Verde / branco", bg: "#388E3C", border: "#1B5E20", friso: "#fff" },
  // Infantil — friso preto
  cinza_preto: { label: "Cinza / preto", bg: "#9E9E9E", border: "#757575", friso: "#000" },
  amarela_preto: { label: "Amarela / preto", bg: "#FDD835", border: "#F9A825", friso: "#000", textColor: "#5D4037" },
  laranja_preto: { label: "Laranja / preto", bg: "#F57C00", border: "#E65100", friso: "#000" },
  verde_preto: { label: "Verde / preto", bg: "#388E3C", border: "#1B5E20", friso: "#000" },
};

interface Props {
  belt: Belt;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  stripes?: number;
  className?: string;
}

export function BeltBadge({ belt, size = "md", showLabel = true, stripes, className }: Props) {
  const cfg = BELT_CONFIG[belt] ?? BELT_CONFIG.branca;
  const dims = { sm: { w: 40, h: 10 }, md: { w: 64, h: 14 }, lg: { w: 96, h: 20 } };
  const d = dims[size];
  const textSize = { sm: 10, md: 12, lg: 14 }[size];

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "inline-block",
          width: d.w,
          height: d.h,
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          borderRadius: 2,
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {cfg.friso && (
          <span
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: Math.max(3, d.h * 0.25),
              transform: "translateY(-50%)",
              background: cfg.friso,
            }}
          />
        )}
        {belt === "preta" && (
          <span
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: d.w * 0.18,
              background: "#C62828",
            }}
          />
        )}
        {belt === "coral" && (
          <span
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: "50%",
              background: "#C62828",
            }}
          />
        )}
      </span>
      {showLabel && (
        <span
          style={{
            fontSize: textSize,
            fontWeight: 500,
            color: cfg.textColor ?? "#fff",
            background: cfg.bg,
            border: `1px solid ${cfg.border}`,
            borderRadius: 20,
            padding: "1px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {cfg.label}
          {typeof stripes === "number" && stripes > 0 && (
            <span style={{ marginLeft: 4, opacity: 0.9 }}>{"•".repeat(Math.min(stripes, 4))}</span>
          )}
        </span>
      )}
    </span>
  );
}
