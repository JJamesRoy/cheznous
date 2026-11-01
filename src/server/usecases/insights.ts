import { z } from "zod";
import { defineOp, execute } from "../op";
import { AppError, unwrap } from "../errors";
import type { HouseholdCtx } from "../ctx";
import { selectAll, today } from "../support";
import { addDays, monthOf } from "../../domain/dates";
import { normalizeKey } from "../../domain/text";
import { aiConfigured, recommend, RecommendationSchema, type Recommendation } from "../ai";
import { budgetHistory, monthBudget } from "./budget";
import { listRecurring } from "./recurring";
import { getMortgageSummary, getProperty } from "./condo";
import { listGoals } from "./goals";
import { getBalances } from "./balances";

/** A second click within this delay returns the advice just generated (no new model call). */
const COOLDOWN_MS = 2 * 60_000;

type InsightRow = { id: string; model: string; result: unknown; created_at: string };

function toDto(r: InsightRow) {
  const parsed = RecommendationSchema.safeParse(r.result);
  const meta = (r.result ?? {}) as { provider?: string; fallbackReason?: string | null };
  return {
    id: r.id,
    createdAt: r.created_at,
    model: r.model,
    provider: meta.provider === "openrouter" ? ("openrouter" as const) : ("anthropic" as const),
    fallbackReason: meta.fallbackReason ?? null,
    advice: parsed.success ? parsed.data : null,
  };
}

async function latest(ctx: HouseholdCtx) {
  const rows = unwrap(
    await ctx.db
      .from("ai_insights")
      .select("id, model, result, created_at")
      .eq("household_id", ctx.household.id)
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ) as InsightRow[];
  return rows[0] ?? null;
}

const cents = (c: number | null | undefined) => (c === null || c === undefined ? null : Math.round(c) / 100);

/**
 * Compact snapshot of the household's finances, as the signed-in member sees them. RLS keeps
 * the partner's private expenses, private recurring rules and personal budget out of it.
 * Amounts are in dollars to keep the prompt readable.
 */
export async function insightSnapshot(ctx: HouseholdCtx) {
  const t = today(ctx);
  const month = monthOf(t);
  const me = ctx.household.members.find((m) => m.userId === ctx.userId)!;
  const [household, personal, history, rules, mortgage, property, goals, balances, recent] = await Promise.all([
    monthBudget(ctx, month, "household"),
    monthBudget(ctx, month, "personal"),
    execute(budgetHistory, ctx, { months: 6 }),
    execute(listRecurring, ctx, {}),
    execute(getMortgageSummary, ctx, {}),
    execute(getProperty, ctx, {}),
    execute(listGoals, ctx, {}),
    execute(getBalances, ctx, {}),
    selectAll<{ description: string; amount_cents: number; is_private: boolean; spent_on: string; budget_categories: { name: string } | null }>((from, to) =>
      ctx.db
        .from("expenses")
        .select("description, amount_cents, is_private, spent_on, budget_categories(name)")
        .eq("household_id", ctx.household.id)
        .gte("spent_on", addDays(t, -90))
        .order("id")
        .range(from, to),
    ),
  ]);

  // Where the money goes over 90 days: the biggest repeat descriptions (merchants, subscriptions).
  const byKey = new Map<string, { description: string; category: string | null; perso: boolean; count: number; totalCents: number }>();
  for (const e of recent) {
    const key = `${e.is_private ? "p" : "f"}:${normalizeKey(e.description)}`;
    const cur = byKey.get(key) ?? { description: e.description, category: e.budget_categories?.name ?? null, perso: e.is_private, count: 0, totalCents: 0 };
    cur.count++;
    cur.totalCents += Number(e.amount_cents);
    byKey.set(key, cur);
  }
  const topSpending = [...byKey.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 25)
    .map((x) => ({ description: x.description, categorie: x.category, perso: x.perso, nombre: x.count, total: cents(x.totalCents) }));

  const lines = (b: Awaited<ReturnType<typeof monthBudget>>) =>
    b.lines
      .filter((l) => l.budgetCents || l.spentCents || l.previousCents)
      .map((l) => ({ categorie: l.name, type: l.kind === "fixed" ? "fixe" : "variable", budget: cents(l.budgetCents), depense: cents(l.spentCents), moisPrecedent: cents(l.previousCents), projection: cents(l.projectedCents) }));

  const m = mortgage.mortgage;
  const p = property.property;
  return {
    date: t,
    jourDuMois: Number(t.slice(8, 10)),
    personneQuiConsulte: me.displayName,
    foyer: {
      nom: ctx.household.name,
      membres: ctx.household.members.map((x) => ({ nom: x.displayName, poidsRevenuPct: x.incomeWeightBp / 100 })),
      repartitionParDefaut: ctx.household.defaultSplitMode === "income" ? "au prorata des revenus" : "50/50",
      balance: balances.sentence,
    },
    budgetFoyerMoisCourant: { totalBudget: cents(household.totals.budgetCents), totalDepense: cents(household.totals.spentCents), projection: cents(household.totals.projectedCents), sansCategorie: cents(household.uncategorizedCents), categories: lines(household) },
    budgetPersoMoisCourant: { totalBudget: cents(personal.totals.budgetCents), totalDepense: cents(personal.totals.spentCents), categories: lines(personal) },
    historiqueFoyer6Mois: history.months.map((x) => ({ mois: x.month, depense: cents(x.spentCents), budget: cents(x.budgetCents) })),
    depensesRecurrentes: rules.rules.map((r) => ({
      titre: r.title,
      montant: cents(r.amountCents),
      frequence: r.frequencyLabel,
      categorie: r.category?.name ?? null,
      type: r.kind === "bill" ? "facture" : "dépense",
      perso: r.isPrivate,
      prochaine: r.nextDueOn,
    })),
    principalesDepenses90Jours: topSpending,
    hypotheque: m
      ? {
          preteur: m.lender,
          taux: m.ratePct,
          typeTaux: m.rateTypeLabel,
          versement: cents(m.paymentCents),
          frequence: m.paymentFrequencyLabel,
          renouvellement: mortgage.renewal?.date ?? null,
          soldeEstime: cents(mortgage.schedule?.estimatedBalanceCents),
          interetsRestants: cents(mortgage.schedule?.totalInterestRemainingCents),
          privilegeRemboursementAnticipe: mortgage.privilege ? { restant: cents(mortgage.privilege.remainingCents), finAnnee: mortgage.privilege.yearEnd } : (mortgage.privilegeReason ?? null),
        }
      : null,
    condo: p
      ? {
          fraisCondoMensuels: cents(p.syndicate.condoFeeCents),
          partFondsPrevoyance: cents(p.syndicate.condoFeeContingencyCents),
          assureur: p.insurance.insurer,
          primeAssuranceAnnuelle: cents(p.insurance.premiumCents),
          renouvellementAssurance: p.insurance.renewalOn,
          taxeDeBienvenue: { montant: cents(p.welcomeTax.amountCents), statut: p.welcomeTax.status },
          cotisationsSpecialesImpayees: cents(property.unpaidTotalCents),
        }
      : null,
    objectifsEpargne: goals.goals.map((g) => ({ nom: g.name, type: g.kindLabel, cible: cents(g.targetCents), epargne: cents(g.savedCents), dateCible: g.targetDate })),
  };
}

export const latestInsights = defineOp({
  name: "insights.latest",
  kind: "read",
  input: z.object({}),
  run: async (ctx) => {
    const row = await latest(ctx);
    return { configured: aiConfigured(), insight: row ? toDto(row) : null };
  },
});

export const generateInsights = defineOp({
  name: "insights.generate",
  kind: "write",
  input: z.object({}),
  run: async (ctx) => {
    const prev = await latest(ctx);
    if (prev && Date.now() - Date.parse(prev.created_at) < COOLDOWN_MS) {
      return { insight: toDto(prev), reused: true };
    }
    const snapshot = await insightSnapshot(ctx);
    const out = await recommend(JSON.stringify(snapshot));
    const stored: Recommendation & { provider: string; fallbackReason: string | null } = {
      ...out.result,
      provider: out.provider,
      fallbackReason: out.fallbackReason,
    };
    const row = unwrap(
      await ctx.db
        .from("ai_insights")
        .insert({ household_id: ctx.household.id, user_id: ctx.userId, model: out.model, result: stored, usage: out.usage })
        .select("id, model, result, created_at")
        .single(),
    ) as InsightRow;
    if (!row) throw new AppError("INTERNAL", "Impossible d'enregistrer les conseils.");
    return { insight: toDto(row), reused: false };
  },
});
