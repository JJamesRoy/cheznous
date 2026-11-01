import { assertCents, divRoundHalfUp, type Cents } from "./money";
import { dateParts, daysInMonth, monthOf, parseDate, parseMonth, type CivilDate, type CivilMonth } from "./dates";

/** Clé utilisée pour les dépenses sans catégorie. */
export const NO_CATEGORY = "__none__";

/** Seuil d'avertissement (ratio dépensé/budget). */
export const BUDGET_WARNING_RATIO = 0.85;
/** Minimum number of days the spending pace is measured over (early-month damping). */
export const MIN_PACE_DAYS = 7;

/**
 * Budget en vigueur par catégorie pour un mois : la ligne la plus récente dont le
 * mois ≤ mois cible (un budget reste valide tant qu'il n'est pas remplacé).
 * `rows[].month` est le 1er du mois (`YYYY-MM-01`; `YYYY-MM` accepté aussi).
 * À mois égal, la dernière ligne du tableau gagne.
 */
export function effectiveBudgets(
  rows: { categoryId: string; month: string; amountCents: Cents }[],
  month: CivilMonth,
): Record<string, Cents> {
  parseMonth(month);
  const best = new Map<string, { month: string; amountCents: Cents }>();
  for (const r of rows) {
    const m = r.month.slice(0, 7);
    parseMonth(m);
    assertCents(r.amountCents, "budget");
    if (m > month) continue;
    const cur = best.get(r.categoryId);
    if (!cur || m >= cur.month) best.set(r.categoryId, { month: m, amountCents: r.amountCents });
  }
  const out: Record<string, Cents> = {};
  for (const [k, v] of best) out[k] = v.amountCents;
  return out;
}

/**
 * Dépenses partagées par catégorie sur [start, endExclusive). Les dépenses privées
 * sont exclues; les remboursements (datés refundedOn) réduisent la catégorie.
 * Choix : chaque catégorie est plafonnée à 0 vers le bas (un remboursement d'un
 * achat du mois précédent ne rend pas la catégorie « négative »).
 * Les dépenses payées par le compte conjoint comptent (c'est de la dépense du foyer).
 */
export function spendingByCategory(
  expenses: { categoryId: string | null; amountCents: Cents; isPrivate: boolean; spentOn: CivilDate }[],
  refunds: { categoryId: string | null; amountCents: Cents; refundedOn: CivilDate }[],
  range: { start: CivilDate; endExclusive: CivilDate },
): Record<string, Cents> {
  parseDate(range.start);
  parseDate(range.endExclusive);
  const inRange = (d: CivilDate) => d >= range.start && d < range.endExclusive;
  const acc = new Map<string, number>();
  const add = (k: string | null, v: number) => acc.set(k ?? NO_CATEGORY, (acc.get(k ?? NO_CATEGORY) ?? 0) + v);
  for (const e of expenses) {
    assertCents(e.amountCents);
    if (e.isPrivate || !inRange(e.spentOn)) continue;
    add(e.categoryId, e.amountCents);
  }
  for (const r of refunds) {
    assertCents(r.amountCents);
    if (!inRange(r.refundedOn)) continue;
    add(r.categoryId, -r.amountCents);
  }
  const out: Record<string, Cents> = {};
  for (const [k, v] of acc) out[k] = Math.max(0, v);
  return out;
}

export type BudgetState = "none" | "under" | "warning" | "over";

export interface BudgetStatus {
  remainingCents: Cents;
  /** dépensé / budget; 0 s'il n'y a pas de budget. */
  ratio: number;
  state: BudgetState;
  /** Projection de fin de mois. */
  projectedCents: Cents;
}

/**
 * État d'un budget. none : pas de budget (null ou ≤ 0); over : dépensé > budget;
 * warning : ratio ≥ 85 %; sinon under.
 * Projection : mois courant = arrondi(dépensé / jours écoulés × jours du mois), où
 * les jours écoulés incluent aujourd'hui; mois passé = dépensé; mois futur = 0.
 */
export function budgetStatus(input: {
  budgetCents: Cents | null;
  spentCents: Cents;
  month: CivilMonth;
  today: CivilDate;
}): BudgetStatus {
  const { spentCents, month, today } = input;
  const budget = input.budgetCents ?? 0;
  assertCents(budget, "budget");
  assertCents(spentCents, "montant dépensé");
  parseMonth(month);
  const todayMonth = monthOf(today);

  let projectedCents: Cents;
  if (month === todayMonth) {
    // Linear pace, but measured over at least MIN_PACE_DAYS: on the 1st of the month a single
    // purchase would otherwise be multiplied by 30.
    const elapsed = dateParts(today).day;
    const remaining = daysInMonth(month) - elapsed;
    const paceDays = Math.max(elapsed, MIN_PACE_DAYS);
    projectedCents = spentCents + Number(divRoundHalfUp(BigInt(spentCents) * BigInt(remaining), BigInt(paceDays)));
  } else if (month < todayMonth) {
    projectedCents = spentCents;
  } else {
    projectedCents = 0;
  }

  if (budget <= 0) {
    return { remainingCents: budget - spentCents, ratio: 0, state: "none", projectedCents };
  }
  const ratio = spentCents / budget;
  const state: BudgetState = spentCents > budget ? "over" : ratio >= BUDGET_WARNING_RATIO ? "warning" : "under";
  return { remainingCents: budget - spentCents, ratio, state, projectedCents };
}

export interface CategoryDelta {
  categoryId: string;
  aCents: Cents;
  bCents: Cents;
  /** b − a (variation du mois a vers le mois b). */
  deltaCents: Cents;
}

/**
 * Compare deux relevés par catégorie (typiquement a = mois précédent, b = mois
 * courant). Union des catégories, triée par |delta| décroissant puis categoryId.
 */
export function compareMonths(a: Record<string, Cents>, b: Record<string, Cents>): CategoryDelta[] {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: CategoryDelta[] = [];
  for (const id of ids) {
    const av = a[id] ?? 0;
    const bv = b[id] ?? 0;
    out.push({ categoryId: id, aCents: av, bCents: bv, deltaCents: bv - av });
  }
  return out.sort(
    (x, y) => Math.abs(y.deltaCents) - Math.abs(x.deltaCents) || (x.categoryId < y.categoryId ? -1 : x.categoryId > y.categoryId ? 1 : 0),
  );
}
