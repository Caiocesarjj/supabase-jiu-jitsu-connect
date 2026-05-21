// FBJJ — Categorias de peso (fonte: fbjj.org.br/informacoes/categorias-de-peso)

export type Sex = "male" | "female";

export type AgeGroup =
  | "KIDS 1"
  | "KIDS 2"
  | "KIDS 3"
  | "INFANTIL"
  | "JÚNIOR"
  | "ADOLESCENTES"
  | "JUVENIL"
  | "ADULTO"
  | "MASTER 1"
  | "MASTER 2"
  | "MASTER 3"
  | "MASTER 4";

const CATEGORY_NAMES = [
  "Galo",
  "Pluma",
  "Pena",
  "Leve",
  "Médio",
  "Meio-Pesado",
  "Pesado",
  "Super-Pesado",
  "Pesadíssimo",
];

// Limite SUPERIOR (kg) por divisão. Posições null = não existe nessa idade.
// O último número é o limite "Super-Pesado"; acima dele = "Pesadíssimo".
const MALE_LIMITS: Record<AgeGroup, (number | null)[]> = {
  "KIDS 1":        [16, 18, 21, 24, 28, 32, 36, 44, null],
  "KIDS 2":        [18, 20, 23, 26, 30, 34, 38, 46, null],
  "KIDS 3":        [21, 24, 27, 30, 34, 38, 42, 50, null],
  "INFANTIL":      [24, 27, 30, 34, 38, 42, 46, 50, 62],
  "JÚNIOR":        [34, 37, 41, 45, 50, 55, 60, 66, 78],
  "ADOLESCENTES":  [38, 42, 46, 50, 56, 62, 67, 72, 84],
  "JUVENIL":       [46, 50, 55, 60, 66, 73, 81, 94, null],
  "ADULTO":        [56, 62, 69, 77, 85, 94, 120, null, null],
  "MASTER 1":      [56, 62, 69, 77, 85, 94, 120, null, null],
  "MASTER 2":      [56, 62, 69, 77, 85, 94, 120, null, null],
  "MASTER 3":      [56, 62, 69, 77, 85, 94, 120, null, null],
  "MASTER 4":      [56, 62, 69, 77, 85, 94, 120, null, null],
};

const FEMALE_LIMITS: Record<AgeGroup, (number | null)[]> = {
  "KIDS 1":        [16, 18, 21, 24, 28, 32, 36, 44, null],
  "KIDS 2":        [17, 19, 22, 25, 29, 33, 37, 44, null],
  "KIDS 3":        [20, 22, 25, 28, 32, 36, 40, 48, null],
  "INFANTIL":      [22, 25, 28, 32, 36, 40, 44, 48, 60],
  "JÚNIOR":        [32, 36, 40, 44, 48, 52, 57, 63, 75],
  "ADOLESCENTES":  [36, 40, 44, 48, 52, 57, 63, 68, 80],
  "JUVENIL":       [40, 44, 48, 52, 57, 63, 70, 82, null],
  "ADULTO":        [49, 55, 62, 70, 95, null, null, null, null],
  "MASTER 1":      [49, 55, 62, 70, 95, null, null, null, null],
  "MASTER 2":      [49, 55, 62, 70, 95, null, null, null, null],
  "MASTER 3":      [49, 55, 62, 70, 95, null, null, null, null],
  "MASTER 4":      [49, 55, 62, 70, 95, null, null, null, null],
};

export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export function getAgeGroup(birthDate: string | null | undefined): AgeGroup | null {
  const age = calcAge(birthDate);
  if (age == null) return null;
  if (age <= 5) return "KIDS 1";
  if (age <= 7) return "KIDS 2";
  if (age <= 9) return "KIDS 3";
  if (age <= 11) return "INFANTIL";
  if (age <= 13) return "JÚNIOR";
  if (age <= 15) return "ADOLESCENTES";
  if (age <= 17) return "JUVENIL";
  if (age <= 29) return "ADULTO";
  if (age <= 35) return "MASTER 1";
  if (age <= 40) return "MASTER 2";
  if (age <= 45) return "MASTER 3";
  return "MASTER 4";
}

export interface WeightCategory {
  ageGroup: AgeGroup;
  categoryName: string;
  limitKg: number | null; // null = pesadíssimo (acima do último)
  label: string;
}

export function getWeightCategory(opts: {
  birthDate: string | null | undefined;
  sex: Sex | null | undefined;
  weightKg: number | null | undefined;
}): WeightCategory | null {
  if (!opts.sex || opts.weightKg == null) return null;
  const ageGroup = getAgeGroup(opts.birthDate);
  if (!ageGroup) return null;

  const table = opts.sex === "female" ? FEMALE_LIMITS : MALE_LIMITS;
  const limits = table[ageGroup];

  for (let i = 0; i < limits.length; i++) {
    const lim = limits[i];
    if (lim == null) continue;
    if (opts.weightKg <= lim) {
      return {
        ageGroup,
        categoryName: CATEGORY_NAMES[i],
        limitKg: lim,
        label: `${ageGroup} — ${CATEGORY_NAMES[i]} (até ${lim} kg)`,
      };
    }
  }
  // Acima do último limite definido
  return {
    ageGroup,
    categoryName: "Pesadíssimo",
    limitKg: null,
    label: `${ageGroup} — Pesadíssimo`,
  };
}

export function formatShortCategory(c: WeightCategory | null): string {
  if (!c) return "—";
  return `${c.ageGroup} · ${c.categoryName}`;
}
