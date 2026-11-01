import { DomainError } from "./errors";
import { addDays, addMonthsClamped, dateParts, diffDays, maxDate, minDate, parseDate, type CivilDate } from "./dates";

export type Frequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "yearly"
  | "installments";

export const FREQUENCIES: readonly Frequency[] = [
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semiannual",
  "yearly",
  "installments",
];

export const FREQUENCY_LABELS_FR: Record<Frequency, string> = {
  weekly: "Chaque semaine",
  biweekly: "Aux deux semaines",
  monthly: "Chaque mois",
  bimonthly: "Aux deux mois",
  quarterly: "Chaque trimestre",
  semiannual: "Deux fois par année",
  yearly: "Chaque année",
  installments: "Versements à dates fixes",
};

export interface RecurrenceRule {
  frequency: Frequency;
  anchorDate: CivilDate;
  installmentDates?: CivilDate[];
  endDate?: CivilDate | null;
}

/** Plafond d'occurrences retournées par `occurrencesBetween` (les suivantes sont tronquées). */
export const MAX_OCCURRENCES = 1000;

const DAY_STEP: Partial<Record<Frequency, number>> = { weekly: 7, biweekly: 14 };
const MONTH_STEP: Partial<Record<Frequency, number>> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

function validateRule(rule: RecurrenceRule): void {
  if (!(rule.frequency in FREQUENCY_LABELS_FR)) {
    throw new DomainError("INVALID_FREQUENCY", "Fréquence inconnue.", { frequency: rule.frequency });
  }
  parseDate(rule.anchorDate);
  if (rule.endDate) parseDate(rule.endDate);
  if (rule.frequency === "installments") {
    if (!rule.installmentDates || rule.installmentDates.length === 0) {
      throw new DomainError("INSTALLMENTS_MISSING", "Ajoute au moins une date de versement.");
    }
    rule.installmentDates.forEach(parseDate);
  }
}

/** k-ième occurrence (k ≥ 0) d'une règle périodique, calculée depuis l'ancre (sans dérive). */
function occurrenceAt(rule: RecurrenceRule, k: number): CivilDate {
  const ds = DAY_STEP[rule.frequency];
  if (ds) return addDays(rule.anchorDate, k * ds);
  const ms = MONTH_STEP[rule.frequency]!;
  return addMonthsClamped(rule.anchorDate, k * ms, dateParts(rule.anchorDate).day);
}

/** Premier k ≥ 0 dont l'occurrence est ≥ date. */
function firstIndexOnOrAfter(rule: RecurrenceRule, date: CivilDate): number {
  if (date <= rule.anchorDate) return 0;
  const ds = DAY_STEP[rule.frequency];
  if (ds) return Math.ceil(diffDays(rule.anchorDate, date) / ds);
  const ms = MONTH_STEP[rule.frequency]!;
  const a = dateParts(rule.anchorDate);
  const d = dateParts(date);
  const months = (d.year - a.year) * 12 + (d.month - a.month);
  let k = Math.max(0, Math.floor(months / ms) - 1);
  while (occurrenceAt(rule, k) < date) k++;
  return k;
}

/**
 * Occurrences dans [from, to] (bornes incluses), triées, jamais avant l'ancre ni
 * après endDate. Les pas mensuels sont calculés ancre + k×pas avec le jour de
 * l'ancre (31 janv. → 28 févr. → 31 mars). `installments` : dates explicites dans
 * la plage, triées et dédupliquées. Au plus MAX_OCCURRENCES résultats.
 */
export function occurrencesBetween(rule: RecurrenceRule, from: CivilDate, to: CivilDate): CivilDate[] {
  validateRule(rule);
  parseDate(from);
  parseDate(to);
  const lo = maxDate(from, rule.anchorDate);
  const hi = rule.endDate ? minDate(to, rule.endDate) : to;
  if (lo > hi) return [];

  if (rule.frequency === "installments") {
    return [...new Set(rule.installmentDates ?? [])]
      .filter((d) => d >= lo && d <= hi)
      .sort()
      .slice(0, MAX_OCCURRENCES);
  }

  const out: CivilDate[] = [];
  for (let k = firstIndexOnOrAfter(rule, lo); out.length < MAX_OCCURRENCES; k++) {
    const d = occurrenceAt(rule, k);
    if (d > hi) break;
    out.push(d);
  }
  return out;
}

/** Prochaine occurrence ≥ date, ou null si la règle est terminée. */
export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, date: CivilDate): CivilDate | null {
  validateRule(rule);
  parseDate(date);
  const lo = maxDate(date, rule.anchorDate);
  let next: CivilDate | undefined;
  if (rule.frequency === "installments") {
    next = [...(rule.installmentDates ?? [])].sort().find((d) => d >= lo);
  } else {
    next = occurrenceAt(rule, firstIndexOnOrAfter(rule, lo));
  }
  if (!next || (rule.endDate && next > rule.endDate)) return null;
  return next;
}
