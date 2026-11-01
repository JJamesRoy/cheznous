import { z } from "zod";
import { defineOp } from "../op";
import { AppError, unwrap } from "../errors";
import type { HouseholdCtx } from "../ctx";
import { moneyToCents, resolveCategory, selectAll, today, zDate, zMoney, zMonth } from "../support";
import { budgetStatus, compareMonths, effectiveBudgets, NO_CATEGORY, spendingByCategory } from "../../domain/budgets";
import { addMonths, formatDateFr, formatMonthFr, monthOf, monthRange, parseMonth, addDays } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import { isThreePaydayMonth, payPeriodsForMonth } from "../../domain/payperiods";

type Category = { id: string; name: string; kind: "fixed" | "variable"; sort: number; archived: boolean };

async function categories(ctx: HouseholdCtx): Promise<Category[]> {
  return unwrap(
    await ctx.db.from("budget_categories").select("id, name, kind, sort, archived").eq("household_id", ctx.household.id).order("sort"),
  ) as Category[];
}

/** Shared spending (private rows excluded) per category over [start, endExclusive). Refunds reduce spending. */
export async function spendingBetween(ctx: HouseholdCtx, start: string, endExclusive: string) {
  const hid = ctx.household.id;
  const [exp, ref] = await Promise.all([
    selectAll<{ category_id: string | null; amount_cents: number; is_private: boolean; spent_on: string }>((from, to) =>
      ctx.db
        .from("expenses")
        .select("category_id, amount_cents, is_private, spent_on")
        .eq("household_id", hid)
        .eq("is_private", false)
        .gte("spent_on", start)
        .lt("spent_on", endExclusive)
        .order("id")
        .range(from, to),
    ),
    selectAll<{ amount_cents: number; refunded_on: string; expenses: { category_id: string | null; is_private: boolean } | null }>((from, to) =>
      ctx.db
        .from("refunds")
        .select("amount_cents, refunded_on, expenses(category_id, is_private)")
        .eq("household_id", hid)
        .gte("refunded_on", start)
        .lt("refunded_on", endExclusive)
        .order("id")
        .range(from, to),
    ),
  ]);
  const byCategory = spendingByCategory(
    exp.map((e) => ({ categoryId: e.category_id, amountCents: Number(e.amount_cents), isPrivate: e.is_private, spentOn: e.spent_on })),
    ref
      .filter((r) => r.expenses && !r.expenses.is_private)
      .map((r) => ({ categoryId: r.expenses!.category_id, amountCents: Number(r.amount_cents), refundedOn: r.refunded_on })),
    { start, endExclusive },
  );
  return { byCategory, expenseCount: exp.length };
}

async function budgetRows(ctx: HouseholdCtx) {
  const rows = unwrap(
    await ctx.db.from("budgets").select("category_id, month, amount_cents").eq("household_id", ctx.household.id),
  ) as { category_id: string; month: string; amount_cents: number }[];
  return rows.map((r) => ({ categoryId: r.category_id, month: r.month, amountCents: Number(r.amount_cents) }));
}

const sum = (rec: Record<string, number>) => Object.values(rec).reduce((s, v) => s + v, 0);

export async function monthBudget(ctx: HouseholdCtx, month: string) {
  const t = today(ctx);
  const { start, endExclusive } = monthRange(month);
  const [cats, rows, spending, prevSpending] = await Promise.all([
    categories(ctx),
    budgetRows(ctx),
    spendingBetween(ctx, start, endExclusive),
    spendingBetween(ctx, monthRange(addMonths(month, -1)).start, start),
  ]);
  const budgets = effectiveBudgets(rows, month);

  const lines = cats
    .filter((c) => !c.archived || (spending.byCategory[c.id] ?? 0) > 0)
    .map((c) => {
      const budgetCents = budgets[c.id] ?? null;
      const spentCents = spending.byCategory[c.id] ?? 0;
      const st = budgetStatus({ budgetCents, spentCents, month, today: t });
      // Fixed costs (mortgage, condo fees…) land once a month: a linear projection would be absurd.
      const projectedCents = c.kind === "fixed" && month === monthOf(t) ? Math.max(spentCents, budgetCents ?? 0) : st.projectedCents;
      const previousCents = prevSpending.byCategory[c.id] ?? 0;
      return {
        categoryId: c.id,
        name: c.name,
        kind: c.kind,
        budgetCents,
        budget: budgetCents === null ? null : formatMoney(budgetCents),
        spentCents,
        spent: formatMoney(spentCents),
        remainingCents: budgetCents === null ? null : st.remainingCents,
        remaining: budgetCents === null ? null : formatMoney(st.remainingCents),
        ratio: st.ratio,
        state: st.state,
        projectedCents,
        projected: formatMoney(projectedCents),
        previousCents,
        deltaCents: spentCents - previousCents,
      };
    });
  const uncategorized = spending.byCategory[NO_CATEGORY] ?? 0;
  const totalBudget = lines.reduce((s, l) => s + (l.budgetCents ?? 0), 0);
  const totalSpent = sum(spending.byCategory);
  const projected = lines.reduce((s, l) => s + l.projectedCents, 0) + (uncategorized && month === monthOf(t) ? budgetStatus({ budgetCents: null, spentCents: uncategorized, month, today: t }).projectedCents : uncategorized);
  const total = budgetStatus({ budgetCents: totalBudget || null, spentCents: totalSpent, month, today: t });

  return {
    month,
    monthLabel: formatMonthFr(month),
    isCurrentMonth: month === monthOf(t),
    totals: {
      budgetCents: totalBudget,
      budget: formatMoney(totalBudget),
      spentCents: totalSpent,
      spent: formatMoney(totalSpent),
      remainingCents: totalBudget - totalSpent,
      remaining: formatMoney(totalBudget - totalSpent),
      projectedCents: projected,
      projected: formatMoney(projected),
      ratio: total.ratio,
      state: total.state,
      previousSpentCents: sum(prevSpending.byCategory),
      fixedSpentCents: lines.filter((l) => l.kind === "fixed").reduce((s, l) => s + l.spentCents, 0),
      variableSpentCents: lines.filter((l) => l.kind === "variable").reduce((s, l) => s + l.spentCents, 0) + uncategorized,
    },
    uncategorizedCents: uncategorized,
    lines,
  };
}

export const getBudget = defineOp({
  name: "budget.get",
  kind: "read",
  input: z.object({ month: zMonth.optional() }),
  run: async (ctx, input) => monthBudget(ctx, input.month ? parseMonth(input.month) : monthOf(today(ctx))),
});

export const setBudget = defineOp({
  name: "budget.set",
  kind: "write",
  input: z.object({
    category: z.string().max(100),
    /** Monthly amount. Applies from `fromMonth` onward until changed again. 0 removes the budget. */
    amount: zMoney,
    fromMonth: zMonth.optional(),
  }),
  run: async (ctx, input) => {
    const cat = await resolveCategory(ctx, input.category);
    const month = `${input.fromMonth ? parseMonth(input.fromMonth) : monthOf(today(ctx))}-01`;
    const amountCents = moneyToCents(input.amount);
    unwrap(
      await ctx.db
        .from("budgets")
        .upsert({ household_id: ctx.household.id, category_id: cat.id, month, amount_cents: amountCents }, { onConflict: "household_id,category_id,month" }),
    );
    return { categoryId: cat.id, month, amountCents, amount: formatMoney(amountCents) };
  },
});

/** Monthly totals for the history chart. */
export const budgetHistory = defineOp({
  name: "budget.history",
  kind: "read",
  input: z.object({ months: z.number().int().min(2).max(24).default(6), category: z.string().max(100).optional() }),
  run: async (ctx, input) => {
    const current = monthOf(today(ctx));
    const first = addMonths(current, -(input.months - 1));
    const cat = input.category ? await resolveCategory(ctx, input.category) : null;
    const [spending, rows] = await Promise.all([spendingRowsBetween(ctx, monthRange(first).start, monthRange(current).endExclusive), budgetRows(ctx)]);
    const months = Array.from({ length: input.months }, (_, i) => addMonths(first, i));
    return {
      category: cat,
      months: months.map((m) => {
        const r = monthRange(m);
        const byCat = spendingByCategory(spending.expenses, spending.refunds, r);
        const budgets = effectiveBudgets(rows, m);
        const spentCents = cat ? (byCat[cat.id] ?? 0) : sum(byCat);
        const budgetCents = cat ? (budgets[cat.id] ?? 0) : sum(budgets);
        return { month: m, label: formatMonthFr(m), spentCents, spent: formatMoney(spentCents), budgetCents, budget: formatMoney(budgetCents) };
      }),
    };
  },
});

async function spendingRowsBetween(ctx: HouseholdCtx, start: string, endExclusive: string) {
  const hid = ctx.household.id;
  const [exp, ref] = await Promise.all([
    selectAll<{ category_id: string | null; amount_cents: number; is_private: boolean; spent_on: string }>((from, to) =>
      ctx.db.from("expenses").select("category_id, amount_cents, is_private, spent_on").eq("household_id", hid).eq("is_private", false).gte("spent_on", start).lt("spent_on", endExclusive).order("id").range(from, to),
    ),
    selectAll<{ amount_cents: number; refunded_on: string; expenses: { category_id: string | null; is_private: boolean } | null }>((from, to) =>
      ctx.db.from("refunds").select("amount_cents, refunded_on, expenses(category_id, is_private)").eq("household_id", hid).gte("refunded_on", start).lt("refunded_on", endExclusive).order("id").range(from, to),
    ),
  ]);
  return {
    expenses: exp.map((e) => ({ categoryId: e.category_id, amountCents: Number(e.amount_cents), isPrivate: e.is_private, spentOn: e.spent_on })),
    refunds: ref.filter((r) => r.expenses && !r.expenses.is_private).map((r) => ({ categoryId: r.expenses!.category_id, amountCents: Number(r.amount_cents), refundedOn: r.refunded_on })),
  };
}

/**
 * Spending summary for a period, optionally compared with another period.
 * Periods are months ("2026-10") or explicit date ranges.
 */
export const spendingSummary = defineOp({
  name: "spending.summary",
  kind: "read",
  input: z.object({
    month: zMonth.optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    compareMonth: zMonth.optional(),
    compareFrom: zDate.optional(),
    compareTo: zDate.optional(),
    category: z.string().max(100).optional(),
  }),
  run: async (ctx, input) => {
    const range = (month?: string, from?: string, to?: string) => {
      if (month) return { ...monthRange(parseMonth(month)), label: formatMonthFr(month) };
      if (from && to) {
        if (to < from) throw new AppError("VALIDATION", "La date de fin précède la date de début.");
        return { start: from, endExclusive: addDays(to, 1), label: `${formatDateFr(from)} – ${formatDateFr(to)}` };
      }
      return null;
    };
    const main = range(input.month, input.from, input.to) ?? { ...monthRange(monthOf(today(ctx))), label: formatMonthFr(monthOf(today(ctx))) };
    const other = range(input.compareMonth, input.compareFrom, input.compareTo);
    const cats = await categories(ctx);
    const cat = input.category ? await resolveCategory(ctx, input.category) : null;
    const nameOf = (id: string) => (id === NO_CATEGORY ? "Sans catégorie" : (cats.find((c) => c.id === id)?.name ?? "Catégorie supprimée"));

    const a = await spendingBetween(ctx, main.start, main.endExclusive);
    const filterCat = (rec: Record<string, number>) => (cat ? { [cat.id]: rec[cat.id] ?? 0 } : rec);
    const aBy = filterCat(a.byCategory);
    const period = {
      label: main.label,
      start: main.start,
      endExclusive: main.endExclusive,
      totalCents: sum(aBy),
      total: formatMoney(sum(aBy)),
      byCategory: Object.entries(aBy)
        .filter(([, v]) => v > 0)
        .sort((x, y) => y[1] - x[1])
        .map(([id, v]) => ({ categoryId: id === NO_CATEGORY ? null : id, name: nameOf(id), spentCents: v, spent: formatMoney(v) })),
    };
    if (!other) return { period, comparison: null };

    const b = await spendingBetween(ctx, other.start, other.endExclusive);
    const bBy = filterCat(b.byCategory);
    // compareMonths(a, b) → delta = b − a; we present "period vs comparison".
    const deltas = compareMonths(bBy, aBy).map((d) => ({
      categoryId: d.categoryId === NO_CATEGORY ? null : d.categoryId,
      name: nameOf(d.categoryId),
      periodCents: d.bCents,
      comparisonCents: d.aCents,
      deltaCents: d.deltaCents,
      delta: formatMoney(d.deltaCents, { signDisplay: "exceptZero" }),
    }));
    const totalB = sum(bBy);
    return {
      period,
      comparison: {
        label: other.label,
        start: other.start,
        endExclusive: other.endExclusive,
        totalCents: totalB,
        total: formatMoney(totalB),
        deltaCents: period.totalCents - totalB,
        delta: formatMoney(period.totalCents - totalB, { signDisplay: "exceptZero" }),
        deltaPct: totalB ? Math.round(((period.totalCents - totalB) / totalB) * 1000) / 10 : null,
        byCategory: deltas.filter((d) => d.periodCents || d.comparisonCents),
      },
    };
  },
});

/** Pay-period view: both partners are paid biweekly; some months have three paydays. */
export const payPeriodBudget = defineOp({
  name: "budget.payPeriods",
  kind: "read",
  input: z.object({ month: zMonth.optional(), member: z.string().max(100).optional() }),
  run: async (ctx, input) => {
    const month = input.month ? parseMonth(input.month) : monthOf(today(ctx));
    const anchors = ctx.household.members.filter((m) => m.payAnchorDate);
    if (!anchors.length) {
      return { month, configured: false as const, message: "Ajoute une date de paie dans Réglages pour voir le budget par période de paie." };
    }
    const who = anchors.find((m) => m.userId === ctx.userId) ?? anchors[0];
    const periods = payPeriodsForMonth(who.payAnchorDate!, month);
    const budget = await monthBudget(ctx, month);
    const perPeriodBudget = periods.length ? Math.floor(budget.totals.budgetCents / periods.length) : 0;
    const out = [];
    for (const p of periods) {
      const s = await spendingBetween(ctx, p.start, p.endExclusive);
      const spent = sum(s.byCategory);
      out.push({
        payday: p.payday,
        start: p.start,
        endExclusive: p.endExclusive,
        label: `Paie du ${formatDateFr(p.payday)}`,
        spentCents: spent,
        spent: formatMoney(spent),
        budgetCents: perPeriodBudget,
        budget: formatMoney(perPeriodBudget),
      });
    }
    return {
      month,
      configured: true as const,
      basedOn: { userId: who.userId, name: who.displayName },
      threePaydays: isThreePaydayMonth(who.payAnchorDate!, month),
      note: isThreePaydayMonth(who.payAnchorDate!, month)
        ? "Ce mois-ci compte trois paies : le budget mensuel est réparti sur trois périodes."
        : null,
      periods: out,
    };
  },
});
