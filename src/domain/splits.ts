import { DomainError } from "./errors";
import { assertNonNegativeCents, type Cents } from "./money";

export type SplitMode = "equal" | "percentage" | "exact" | "income";

export const SPLIT_MODES: readonly SplitMode[] = ["equal", "percentage", "exact", "income"];

/** 100 % en points de base. */
export const FULL_BP = 10_000;

export interface Weighted {
  id: string;
  weight: number;
}

/**
 * Répartition au plus fort reste (ARCHITECTURE §4) :
 *  floor_i = ⌊total × w_i / Σw⌋, rem_i = (total × w_i) mod Σw (BigInt);
 *  les r = total − Σfloor cents restants vont aux r plus grands rem_i;
 *  égalités départagées par l'ordre du tableau (l'appelant passe l'ordre canonique).
 * Sortie dans l'ordre d'entrée. Σ résultat = total, toujours.
 */
export function allocate(total: Cents, weights: Weighted[]): { id: string; cents: Cents }[] {
  assertNonNegativeCents(total, "total");
  if (weights.length === 0) {
    throw new DomainError("ALLOCATE_NO_WEIGHTS", "Il faut au moins une personne pour répartir.");
  }
  let sum = BigInt(0);
  for (const w of weights) {
    if (!Number.isSafeInteger(w.weight) || w.weight < 0) {
      throw new DomainError(
        "ALLOCATE_INVALID_WEIGHT",
        "Les poids de répartition doivent être des entiers positifs ou nuls.",
        { id: w.id, weight: w.weight },
      );
    }
    sum += BigInt(w.weight);
  }
  if (sum === BigInt(0)) {
    throw new DomainError("ALLOCATE_ZERO_WEIGHTS", "La somme des poids doit être plus grande que zéro.");
  }
  const t = BigInt(total);
  const floors: bigint[] = [];
  const rems: bigint[] = [];
  let given = BigInt(0);
  for (const w of weights) {
    const p = t * BigInt(w.weight);
    const f = p / sum;
    floors.push(f);
    rems.push(p % sum);
    given += f;
  }
  const r = Number(t - given);
  const order = weights.map((_, i) => i);
  order.sort((a, b) => (rems[a] === rems[b] ? a - b : rems[a] > rems[b] ? -1 : 1));
  for (let k = 0; k < r; k++) floors[order[k]] += BigInt(1);
  return weights.map((w, i) => ({ id: w.id, cents: Number(floors[i]) }));
}

export interface ComputeSplitsInput {
  totalCents: Cents;
  mode: SplitMode;
  /** Ordre canonique des membres (joined_at puis user_id). */
  memberOrder: string[];
  /** Mode `equal` et `income` : sous-ensemble des membres (défaut : tous). */
  participants?: string[];
  percentagesBp?: Record<string, number>;
  exactCents?: Record<string, Cents>;
  incomeWeightsBp?: Record<string, number>;
}

export interface SplitShare {
  userId: string;
  shareCents: Cents;
  weight: number | null;
}

function checkKnown(ids: Iterable<string>, known: Set<string>): void {
  for (const id of ids) {
    if (!known.has(id)) {
      throw new DomainError(
        "SPLIT_UNKNOWN_MEMBER",
        "Cette personne ne fait pas partie du foyer.",
        { userId: id },
      );
    }
  }
}

function isBp(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Calcule les parts d'une dépense. Sortie toujours dans l'ordre de `memberOrder`;
 * seules les personnes ayant un poids/montant figurent (les parts à 0 sont gardées).
 * Σ shareCents = totalCents, pour tous les modes.
 */
export function computeSplits(input: ComputeSplitsInput): SplitShare[] {
  const { totalCents, mode, memberOrder } = input;
  assertNonNegativeCents(totalCents, "montant");
  const known = new Set(memberOrder);
  const inOrder = (ids: Set<string>) => memberOrder.filter((m) => ids.has(m));

  const weighted = (entries: { id: string; weight: number }[]): SplitShare[] =>
    allocate(totalCents, entries).map((a, i) => ({
      userId: a.id,
      shareCents: a.cents,
      weight: entries[i].weight,
    }));

  switch (mode) {
    case "equal": {
      const parts = input.participants ?? memberOrder;
      checkKnown(parts, known);
      const ids = inOrder(new Set(parts));
      if (ids.length === 0) {
        throw new DomainError("SPLIT_NO_PARTICIPANTS", "Choisis au moins une personne pour partager la dépense.");
      }
      return weighted(ids.map((id) => ({ id, weight: 1 })));
    }
    case "percentage": {
      const bp = input.percentagesBp ?? {};
      checkKnown(Object.keys(bp), known);
      const ids = inOrder(new Set(Object.keys(bp)));
      let sum = 0;
      for (const id of ids) {
        if (!isBp(bp[id])) {
          throw new DomainError("SPLIT_PERCENT_SUM", "Les pourcentages doivent être des nombres entiers de points de base.", {
            userId: id,
            value: bp[id],
          });
        }
        sum += bp[id];
      }
      if (sum !== FULL_BP) {
        throw new DomainError("SPLIT_PERCENT_SUM", "Les pourcentages doivent totaliser exactement 100 %.", {
          expected: FULL_BP,
          actual: sum,
        });
      }
      return weighted(ids.map((id) => ({ id, weight: bp[id] })));
    }
    case "income": {
      const w = input.incomeWeightsBp ?? {};
      checkKnown(Object.keys(w), known);
      const parts = input.participants ?? memberOrder;
      checkKnown(parts, known);
      const ids = inOrder(new Set(parts));
      let sum = 0;
      const missing: string[] = [];
      for (const id of ids) {
        if (!isBp(w[id])) missing.push(id);
        else sum += w[id];
      }
      if (ids.length === 0 || missing.length > 0 || sum <= 0) {
        throw new DomainError(
          "SPLIT_INCOME_MISSING",
          "Les proportions de revenus du foyer ne sont pas configurées. Va dans les réglages du foyer pour les ajouter.",
          { missing },
        );
      }
      return weighted(ids.map((id) => ({ id, weight: w[id] })));
    }
    case "exact": {
      const ex = input.exactCents ?? {};
      checkKnown(Object.keys(ex), known);
      const ids = inOrder(new Set(Object.keys(ex)));
      let sum = 0;
      for (const id of ids) {
        assertNonNegativeCents(ex[id], "part");
        sum += ex[id];
      }
      if (ids.length === 0 || sum !== totalCents) {
        throw new DomainError(
          "SPLIT_EXACT_SUM",
          "La somme des parts doit être égale au montant de la dépense.",
          { expected: totalCents, actual: sum },
        );
      }
      return ids.map((id) => ({ userId: id, shareCents: ex[id], weight: null }));
    }
    default: {
      const never: never = mode;
      throw new DomainError("SPLIT_INVALID_MODE", "Mode de partage inconnu.", { mode: never });
    }
  }
}

/**
 * Résumé lisible d'un partage : pourcentages entiers du total (répartis au plus
 * fort reste pour que la somme fasse 100), dans l'ordre des membres; un membre
 * sans part compte pour 0. Ex. "50/50", "55/45", "100/0".
 */
export function describeSplit(
  splits: { userId: string; shareCents: Cents }[],
  memberOrder: string[],
): { label: string; percents: { userId: string; percent: number }[] } {
  const byUser = new Map<string, number>();
  for (const s of splits) byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + s.shareCents);
  const ids = [...memberOrder, ...[...byUser.keys()].filter((id) => !memberOrder.includes(id))];
  const total = ids.reduce((acc, id) => acc + (byUser.get(id) ?? 0), 0);
  if (ids.length === 0 || total <= 0) {
    return { label: "—", percents: ids.map((userId) => ({ userId, percent: 0 })) };
  }
  const pct = allocate(100, ids.map((id) => ({ id, weight: byUser.get(id) ?? 0 })));
  return {
    label: pct.map((p) => p.cents).join("/"),
    percents: pct.map((p) => ({ userId: p.id, percent: p.cents })),
  };
}
