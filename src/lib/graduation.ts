import type { Belt } from "@/types/database";

// Sequência completa das faixas infantis
export const JUNIOR_BELT_ORDER: Belt[] = [
  "branca",
  "cinza_branco",
  "cinza",
  "cinza_preto",
  "amarela_branco",
  "amarela",
  "amarela_preto",
  "laranja_branco",
  "laranja",
  "laranja_preto",
  "verde_branco",
  "verde",
  "verde_preto",
];

// Sequência das faixas adulto
export const ADULT_BELT_ORDER: Belt[] = ["branca", "azul", "roxa", "marrom", "preta"];

// Tempo mínimo em meses para avançar da faixa atual para a próxima
export const MIN_MONTHS_IN_BELT: Partial<Record<Belt, number>> = {
  branca: 0,
  azul: 24,
  roxa: 18,
  marrom: 12,
  cinza_branco: 0,
  cinza: 0,
  cinza_preto: 0,
  amarela_branco: 0,
  amarela: 0,
  amarela_preto: 0,
  laranja_branco: 0,
  laranja: 0,
  laranja_preto: 0,
  verde_branco: 0,
  verde: 0,
  verde_preto: 0,
};

// Idade mínima para faixas adulto
export const MIN_AGE_FOR_BELT: Partial<Record<Belt, number>> = {
  azul: 16,
  roxa: 16,
  marrom: 16,
  preta: 18,
};

// Graus da faixa preta e tempo total de preta necessário (em anos)
export const BLACK_BELT_DEGREE_YEARS: Record<number, number> = {
  1: 3,
  2: 6,
  3: 11,
  4: 16,
  5: 21,
  6: 28,
  7: 35,
  8: 45,
  9: 48,
  10: Infinity,
};

export function getBeltLabel(belt: Belt): string {
  const labels: Record<Belt, string> = {
    branca: "Branca",
    azul: "Azul",
    roxa: "Roxa",
    marrom: "Marrom",
    preta: "Preta",
    coral: "Coral",
    vermelha: "Vermelha",
    cinza: "Cinza",
    amarela: "Amarela",
    laranja: "Laranja",
    verde: "Verde",
    cinza_branco: "Cinza / branco",
    amarela_branco: "Amarela / branco",
    laranja_branco: "Laranja / branco",
    verde_branco: "Verde / branco",
    cinza_preto: "Cinza / preto",
    amarela_preto: "Amarela / preto",
    laranja_preto: "Laranja / preto",
    verde_preto: "Verde / preto",
  };
  return labels[belt] ?? belt;
}

export function isJuniorBelt(belt: Belt): boolean {
  return JUNIOR_BELT_ORDER.includes(belt);
}

export function isAdultBelt(belt: Belt): boolean {
  return ADULT_BELT_ORDER.includes(belt) || belt === "coral" || belt === "vermelha";
}

export function getMaxDegrees(belt: Belt): number {
  if (belt === "preta") return 10;
  return 4;
}

/**
 * Retorna as faixas disponíveis para promoção a partir da faixa atual.
 */
export function getAvailableBeltsForPromotion(
  currentBelt: Belt,
  currentDegrees: number,
  isMinor: boolean,
  birthDate: string,
): Belt[] {
  const today = new Date();
  const birth = new Date(birthDate);
  const ageYears = (today.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

  const sameBelt: Belt[] = currentDegrees < getMaxDegrees(currentBelt) ? [currentBelt] : [];

  if (isMinor && isJuniorBelt(currentBelt)) {
    const idx = JUNIOR_BELT_ORDER.indexOf(currentBelt);
    const next = JUNIOR_BELT_ORDER.slice(idx + 1, idx + 2);
    return [...sameBelt, ...next];
  }

  if (!isMinor && isAdultBelt(currentBelt)) {
    if (currentBelt === "preta") return [currentBelt];

    const idx = ADULT_BELT_ORDER.indexOf(currentBelt);
    const nextBelt = ADULT_BELT_ORDER[idx + 1] as Belt | undefined;
    if (!nextBelt) return sameBelt;

    const minAge = MIN_AGE_FOR_BELT[nextBelt];
    if (minAge && ageYears < minAge) return sameBelt;

    return [...sameBelt, nextBelt];
  }

  // Aluno completou 16 anos sendo infantil — migra para adulto
  if (!isMinor && isJuniorBelt(currentBelt)) {
    return ["branca", "azul"];
  }

  return sameBelt;
}

/**
 * Calcula a data mínima para a próxima promoção.
 */
export function calcMinNextPromotionDate(
  newBelt: Belt,
  newDegrees: number,
  promotionDate: string,
): string | null {
  if (newBelt === "preta") {
    const nextDegree = newDegrees + 1;
    const yearsNeeded = BLACK_BELT_DEGREE_YEARS[nextDegree];
    if (!yearsNeeded || yearsNeeded === Infinity) return null;
    const d = new Date(promotionDate);
    d.setFullYear(d.getFullYear() + yearsNeeded);
    return d.toISOString().split("T")[0];
  }

  const months = MIN_MONTHS_IN_BELT[newBelt] ?? 0;
  if (months === 0) return null;

  const d = new Date(promotionDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}
