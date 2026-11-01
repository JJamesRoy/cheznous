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

export interface ClippedPayPeriod extends PayPeriod {
  /** The pay period as a whole (may start in the previous month). */
  periodStart: CivilDate;
  periodEndExclusive: CivilDate;
  /** True when the period began with a payday in the previous month. */
  carriedOver: boolean;
  /** Days of this period that fall inside the month. */
  days: number;
}

/**
 * Every pay period that overlaps the month, clipped to the month, so that every day of the month
 * belongs to exactly one period (spending before the first payday of the month is not lost).
 */
export function payPeriodsOverlappingMonth(anchorPayday: CivilDate, month: CivilMonth): ClippedPayPeriod[] {
  const { start, endExclusive } = monthRange(month);
  const paydays = paydaysBetween(anchorPayday, addDays(start, -(PAY_PERIOD_DAYS - 1)), addDays(endExclusive, -1));
  return paydays.map((payday) => {
    const periodEndExclusive = addDays(payday, PAY_PERIOD_DAYS);
    const s = payday < start ? start : payday;
    const e = periodEndExclusive > endExclusive ? endExclusive : periodEndExclusive;
    return { payday, start: s, endExclusive: e, periodStart: payday, periodEndExclusive, carriedOver: payday < start, days: diffDays(s, e) };
  });
}
