import { DomainError } from "./errors";
import { assertNonNegativeCents, type Cents } from "./money";
import { allocate } from "./splits";

export interface BalanceExpense {
  id: string;
  amountCents: Cents;
  /** null = payée par le compte conjoint. */
  paidByUser: string | null;
  isPrivate: boolean;
  splits: { userId: string; shareCents: Cents }[];
}

export interface BalanceRefund {
  expenseId: string;
  amountCents: Cents;
  /** null = reçu dans le compte conjoint. */
  receivedByUser: string | null;
}

export interface BalanceSettlement {
  fromUser: string;
  toUser: string;
  amountCents: Cents;
}

export interface BalanceInput {
  memberOrder: string[];
  expenses: BalanceExpense[];
  refunds: BalanceRefund[];
  settlements: BalanceSettlement[];
}

export interface Transfer {
  from: string;
  to: string;
  amountCents: Cents;
}

export interface BalanceResult {
  /** net > 0 : on doit de l'argent à cette personne. Σ net = 0. */
  net: Record<string, Cents>;
  /** Virements minimaux (gloutons, déterministes) pour tout remettre à zéro. */
  transfers: Transfer[];
}

/**
 * Soldes du foyer (ARCHITECTURE §4) :
 *  - dépense partagée payée par P : net[P] += montant; net[u] −= part_u;
 *  - payée par le compte conjoint (paidByUser null) ou privée : ignorée;
 *  - remboursement reçu par R : net[R] −= montant, réparti au plus fort reste sur
 *    les parts de la dépense d'origine (ordre des membres) : net[u] += partRemb_u;
 *    reçu par le compte (null), ou lié à une dépense inconnue/ignorée : ignoré;
 *  - règlement de A à B : net[A] += montant, net[B] −= montant.
 * Un utilisateur absent de memberOrder (ex. ancien membre) est ajouté à la fin
 * dans l'ordre d'apparition.
 */
export function computeBalances(input: BalanceInput): BalanceResult {
  const order = [...input.memberOrder];
  const net = new Map<string, number>(order.map((m) => [m, 0]));
  const add = (u: string, amt: number) => {
    if (!net.has(u)) {
      net.set(u, 0);
      order.push(u);
    }
    net.set(u, (net.get(u) ?? 0) + amt);
  };
  const rank = (u: string) => {
    const i = order.indexOf(u);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const counted = new Map<string, BalanceExpense>();
  for (const e of input.expenses) {
    assertNonNegativeCents(e.amountCents, "montant");
    if (e.isPrivate || e.paidByUser === null) continue;
    let sum = 0;
    for (const s of e.splits) sum += assertNonNegativeCents(s.shareCents, "part");
    if (sum !== e.amountCents) {
      throw new DomainError(
        "SPLIT_EXACT_SUM",
        "La somme des parts doit être égale au montant de la dépense.",
        { expenseId: e.id, expected: e.amountCents, actual: sum },
      );
    }
    add(e.paidByUser, e.amountCents);
    for (const s of e.splits) add(s.userId, -s.shareCents);
    counted.set(e.id, e);
  }

  for (const r of input.refunds) {
    assertNonNegativeCents(r.amountCents, "remboursement");
    if (r.receivedByUser === null) continue;
    const e = counted.get(r.expenseId);
    if (!e) continue;
    const shares = e.splits
      .filter((s) => s.shareCents > 0)
      .map((s) => ({ id: s.userId, weight: s.shareCents }))
      .sort((a, b) => rank(a.id) - rank(b.id));
    if (shares.length === 0) continue;
    add(r.receivedByUser, -r.amountCents);
    for (const a of allocate(r.amountCents, shares)) add(a.id, a.cents);
  }

  for (const s of input.settlements) {
    assertNonNegativeCents(s.amountCents, "règlement");
    add(s.fromUser, s.amountCents);
    add(s.toUser, -s.amountCents);
  }

  const netRecord: Record<string, Cents> = {};
  for (const u of order) netRecord[u] = (net.get(u) ?? 0) + 0; // + 0 normalise -0
  return { net: netRecord, transfers: minimalTransfers(netRecord, order) };
}

/**
 * Virements gloutons : plus gros débiteur → plus gros créancier, égalités par
 * l'ordre des membres. Pour un foyer de deux, c'est exactement un virement.
 */
export function minimalTransfers(net: Record<string, Cents>, order: string[] = Object.keys(net)): Transfer[] {
  const ids = [...order, ...Object.keys(net).filter((k) => !order.includes(k))];
  const byAmount = (sign: 1 | -1) =>
    ids
      .filter((id) => sign * (net[id] ?? 0) > 0)
      .map((id) => ({ id, left: Math.abs(net[id]) }))
      .sort((a, b) => b.left - a.left || ids.indexOf(a.id) - ids.indexOf(b.id));
  const debtors = byAmount(-1);
  const creditors = byAmount(1);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].left, creditors[j].left);
    out.push({ from: debtors[i].id, to: creditors[j].id, amountCents: amt });
    debtors[i].left -= amt;
    creditors[j].left -= amt;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return out;
}

export interface BalanceSentence {
  /** owed : on me doit; owes : je dois; even : quittes. */
  kind: "owed" | "owes" | "even";
  amountCents: Cents;
  partnerName: string;
}

/** Valeur structurée pour « {partnerName} te doit 12,34 $ » / « Tu dois … » / « Vous êtes quittes ». */
export function balanceSentence(net: Record<string, Cents>, meId: string, partnerName: string): BalanceSentence {
  const mine = net[meId] ?? 0;
  if (mine > 0) return { kind: "owed", amountCents: mine, partnerName };
  if (mine < 0) return { kind: "owes", amountCents: -mine, partnerName };
  return { kind: "even", amountCents: 0, partnerName };
}
