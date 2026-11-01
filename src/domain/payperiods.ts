import { addDays, diffDays, monthRange, parseDate, type CivilDate, type CivilMonth } from "./dates";

export const PAY_PERIOD_DAYS = 14;

/** Jours de paie aux deux semaines dans [from, to] (inclus); l'ancre peut être avant ou après. */
export function paydaysBetween(anchorPayday: CivilDate, from: CivilDate, to: CivilDate): CivilDate[] {
  parseDate(anchorPayday);
  parseDate(from);
  parseDate(to);
  if (from > to) return [];
  const k0 = Math.ceil(diffDays(anchorPayday, from) / PAY_PERIOD_DAYS);
  const out: CivilDate[] = [];
  for (let d = addDays(anchorPayday, k0 * PAY_PERIOD_DAYS); d <= to; d = addDays(d, PAY_PERIOD_DAYS)) {
    out.push(d);
  }
  return out;
}

export interface PayPeriod {
  payday: CivilDate;
  start: CivilDate;
  endExclusive: CivilDate;
}

/** Périodes de paie qui COMMENCENT (jour de paie) dans le mois. 2 ou 3 par mois. */
export function payPeriodsForMonth(anchorPayday: CivilDate, month: CivilMonth): PayPeriod[] {
  const { start, endExclusive } = monthRange(month);
  return paydaysBetween(anchorPayday, start, addDays(endExclusive, -1)).map((payday) => ({
    payday,
    start: payday,
    endExclusive: addDays(payday, PAY_PERIOD_DAYS),
  }));
}

/** Alias du nom utilisé dans ARCHITECTURE.md §5. */
export const payPeriodsInMonth = payPeriodsForMonth;

export function isThreePaydayMonth(anchorPayday: CivilDate, month: CivilMonth): boolean {
  return payPeriodsForMonth(anchorPayday, month).length === 3;
}
