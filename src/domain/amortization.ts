import { DomainError } from "./errors";
import { assertNonNegativeCents, type Cents } from "./money";
import { addDays, addMonthsClamped, dateParts, parseDate, type CivilDate } from "./dates";

export type PaymentFrequency =
  | "monthly"
  | "semimonthly"
  | "biweekly"
  | "accelerated_biweekly"
  | "weekly"
  | "accelerated_weekly";

export type Compounding = "semiannual" | "monthly";

export const PAYMENT_FREQUENCY_LABELS_FR: Record<PaymentFrequency, string> = {
  monthly: "Mensuel",
  semimonthly: "Bimensuel (2 fois par mois)",
  biweekly: "Aux deux semaines",
  accelerated_biweekly: "Aux deux semaines accéléré",
  weekly: "Hebdomadaire",
  accelerated_weekly: "Hebdomadaire accéléré",
};

export function paymentsPerYear(freq: PaymentFrequency): number {
  switch (freq) {
    case "monthly":
      return 12;
    case "semimonthly":
      return 24;
    case "biweekly":
    case "accelerated_biweekly":
      return 26;
    case "weekly":
    case "accelerated_weekly":
      return 52;
    default: {
      const never: never = freq;
      throw new DomainError("INVALID_FREQUENCY", "Fréquence de paiement inconnue.", { frequency: never });
    }
  }
}

function assertRate(annualRatePct: number): void {
  if (!Number.isFinite(annualRatePct) || annualRatePct < 0 || annualRatePct >= 100) {
    throw new DomainError("INVALID_RATE", "Taux d'intérêt invalide.", { annualRatePct });
  }
}

/**
 * Taux périodique. semiannual (taux fixe, Loi sur l'intérêt) : (1 + r/2)^(2/n) − 1;
 * monthly (variable, approximation) : (1 + r/12)^(12/n) − 1.
 */
export function periodicRate(annualRatePct: number, perYear: number, compounding: Compounding): number {
  assertRate(annualRatePct);
  if (!Number.isInteger(perYear) || perYear <= 0) {
    throw new DomainError("INVALID_NUMBER", "Nombre de paiements par année invalide.", { perYear });
  }
  const r = annualRatePct / 100;
  const m = compounding === "semiannual" ? 2 : 12;
  return Math.pow(1 + r / m, m / perYear) - 1;
}

/** Arrondi demi vers le haut, au cent (valeurs ≥ 0). */
function roundCents(x: number): Cents {
  return Math.floor(x + 0.5);
}

export interface PaymentInput {
  principalCents: Cents;
  annualRatePct: number;
  amortizationMonths: number;
  frequency: PaymentFrequency;
  compounding: Compounding;
}

/**
 * Versement d'annuité standard : P × i / (1 − (1 + i)^−N), N = mois/12 × paiements/an.
 * accelerated_biweekly = versement mensuel / 2; accelerated_weekly = mensuel / 4.
 * Arrondi demi vers le haut au cent (mensuel arrondi d'abord pour les accélérés).
 */
export function computePayment(input: PaymentInput): Cents {
  const { principalCents, annualRatePct, amortizationMonths, frequency, compounding } = input;
  assertNonNegativeCents(principalCents, "capital");
  if (!Number.isInteger(amortizationMonths) || amortizationMonths <= 0 || amortizationMonths > 600) {
    throw new DomainError("INVALID_AMORTIZATION", "Période d'amortissement invalide.", { amortizationMonths });
  }
  if (frequency === "accelerated_biweekly" || frequency === "accelerated_weekly") {
    const monthly = computePayment({ ...input, frequency: "monthly" });
    return roundCents(monthly / (frequency === "accelerated_biweekly" ? 2 : 4));
  }
  const perYear = paymentsPerYear(frequency);
  const n = Math.round((amortizationMonths * perYear) / 12);
  const i = periodicRate(annualRatePct, perYear, compounding);
  if (i === 0) return Math.ceil(principalCents / n);
  return roundCents((principalCents * i) / (1 - Math.pow(1 + i, -n)));
}

export interface ScheduleRow {
  n: number;
  date: CivilDate;
  paymentCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  balanceCents: Cents;
}

export interface ScheduleInput {
  balanceCents: Cents;
  annualRatePct: number;
  paymentCents: Cents;
  frequency: PaymentFrequency;
  compounding: Compounding;
  /** Date du 1er versement (n = 1). */
  startDate: CivilDate;
  maxPeriods?: number;
}

/**
 * Date du versement k (k = 0 pour le 1er).
 * monthly : startDate + k mois (jour d'ancrage conservé, fin de mois ramenée);
 * semimonthly : k pair → startDate + k/2 mois; k impair → ce même jour + 15 jours
 *   (ex. 1er et 16, ou 15 et 30); biweekly/accéléré : +14 j; weekly/accéléré : +7 j.
 */
export function paymentDate(startDate: CivilDate, frequency: PaymentFrequency, k: number): CivilDate {
  const day = dateParts(startDate).day;
  switch (frequency) {
    case "monthly":
      return addMonthsClamped(startDate, k, day);
    case "semimonthly": {
      const base = addMonthsClamped(startDate, Math.floor(k / 2), day);
      return k % 2 === 0 ? base : addDays(base, 15);
    }
    case "biweekly":
    case "accelerated_biweekly":
      return addDays(startDate, 14 * k);
    case "weekly":
    case "accelerated_weekly":
      return addDays(startDate, 7 * k);
    default: {
      const never: never = frequency;
      throw new DomainError("INVALID_FREQUENCY", "Fréquence de paiement inconnue.", { frequency: never });
    }
  }
}

/**
 * Tableau d'amortissement. Intérêt de chaque période arrondi au cent (demi vers le
 * haut). S'arrête quand le solde atteint 0 (dernier versement réduit) ou après
 * maxPeriods (défaut 3000). Lance PAYMENT_TOO_LOW si le versement ≤ intérêt du 1er terme.
 */
export function amortizationSchedule(input: ScheduleInput): ScheduleRow[] {
  const { balanceCents, annualRatePct, paymentCents, frequency, compounding, startDate } = input;
  assertNonNegativeCents(balanceCents, "solde");
  assertNonNegativeCents(paymentCents, "versement");
  parseDate(startDate);
  const maxPeriods = input.maxPeriods ?? 3000;
  const i = periodicRate(annualRatePct, paymentsPerYear(frequency), compounding);
  const rows: ScheduleRow[] = [];
  let balance = balanceCents;
  if (balance === 0) return rows;
  if (paymentCents <= roundCents(balance * i)) {
    throw new DomainError(
      "PAYMENT_TOO_LOW",
      "Ce versement ne couvre même pas les intérêts : le solde ne baisserait jamais.",
      { paymentCents, firstInterestCents: roundCents(balance * i) },
    );
  }
  for (let k = 0; k < maxPeriods && balance > 0; k++) {
    const interest = roundCents(balance * i);
    let payment = paymentCents;
    if (payment >= balance + interest) payment = balance + interest;
    const principal = payment - interest;
    balance -= principal;
    rows.push({
      n: k + 1,
      date: paymentDate(startDate, frequency, k),
      paymentCents: payment,
      interestCents: interest,
      principalCents: principal,
      balanceCents: balance,
    });
  }
  return rows;
}

export interface MortgageSummary {
  periods: number;
  totalInterestCents: Cents;
  totalPaidCents: Cents;
  payoffDate: CivilDate | null;
  /** false si maxPeriods a été atteint avant le remboursement complet. */
  paidOff: boolean;
}

export function summarizeMortgage(schedule: ScheduleRow[]): MortgageSummary {
  let totalInterestCents = 0;
  let totalPaidCents = 0;
  for (const r of schedule) {
    totalInterestCents += r.interestCents;
    totalPaidCents += r.paymentCents;
  }
  const last = schedule[schedule.length - 1];
  return {
    periods: schedule.length,
    totalInterestCents,
    totalPaidCents,
    payoffDate: last && last.balanceCents === 0 ? last.date : null,
    paidOff: !last || last.balanceCents === 0,
  };
}

export interface PrepaymentPrivilegeInput {
  originalPrincipalCents: Cents;
  /** Ex. 1500 = 15 % du capital d'origine par année. */
  privilegeBp: number;
  /** Date anniversaire (début du prêt ou 1er anniversaire); seuls le mois et le jour comptent. */
  anniversaryDate: CivilDate;
  prepayments: { amountCents: Cents; paidOn: CivilDate }[];
  today: CivilDate;
}

export interface PrepaymentPrivilege {
  yearStart: CivilDate;
  yearEndExclusive: CivilDate;
  allowedCents: Cents;
  usedCents: Cents;
  /** max(0, permis − utilisé). */
  remainingCents: Cents;
}

/**
 * Privilège de remboursement anticipé de l'année d'anniversaire en cours :
 * [dernier anniversaire ≤ aujourd'hui, anniversaire suivant). Un anniversaire le
 * 29 févr. tombe le 28 les années non bissextiles.
 * permis = ⌊capital d'origine × bp / 10 000⌋ (BigInt).
 */
export function prepaymentPrivilege(input: PrepaymentPrivilegeInput): PrepaymentPrivilege {
  const { originalPrincipalCents, privilegeBp, anniversaryDate, prepayments, today } = input;
  assertNonNegativeCents(originalPrincipalCents, "capital");
  if (!Number.isSafeInteger(privilegeBp) || privilegeBp < 0 || privilegeBp > 10_000) {
    throw new DomainError("INVALID_PRIVILEGE", "Le privilège doit être entre 0 % et 100 %.", { privilegeBp });
  }
  parseDate(today);
  const a = dateParts(anniversaryDate);
  const t = dateParts(today);
  let years = t.year - a.year;
  let yearStart = addMonthsClamped(anniversaryDate, 12 * years, a.day);
  if (yearStart > today) {
    years -= 1;
    yearStart = addMonthsClamped(anniversaryDate, 12 * years, a.day);
  }
  const yearEndExclusive = addMonthsClamped(anniversaryDate, 12 * (years + 1), a.day);
  const allowedCents = Number((BigInt(originalPrincipalCents) * BigInt(privilegeBp)) / BigInt(10_000));
  let usedCents = 0;
  for (const p of prepayments) {
    assertNonNegativeCents(p.amountCents, "remboursement anticipé");
    parseDate(p.paidOn);
    if (p.paidOn >= yearStart && p.paidOn < yearEndExclusive) usedCents += p.amountCents;
  }
  return {
    yearStart,
    yearEndExclusive,
    allowedCents,
    usedCents,
    remainingCents: Math.max(0, allowedCents - usedCents),
  };
}
