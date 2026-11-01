import { z } from "zod";
import { defineOp, execute } from "../op";
import { today } from "../support";
import { addDays, monthOf } from "../../domain/dates";
import { getBalances } from "./balances";
import { monthBudget } from "./budget";
import { listTasks } from "./tasks";
import { upcomingFromRules } from "./recurring";
import { keyDatesBetween } from "./keydates";
import { listGoals } from "./goals";
import { listShoppingLists } from "./shopping";
import { formatMoney } from "../../domain/money";

/**
 * Accueil: one hero (the balance sentence) and at most five blocks, all real data:
 * this month vs budget, upcoming bills, tasks due this week, shopping highlights, goals.
 */
export const getDashboard = defineOp({
  name: "dashboard.get",
  kind: "read",
  input: z.object({ upcomingDays: z.number().int().min(7).max(60).default(21) }),
  run: async (ctx, input) => {
    const t = today(ctx);
    const month = monthOf(t);
    const [balances, budget, tasks, ruleItems, keyDates, goals, lists, expenseCount] = await Promise.all([
      execute(getBalances, ctx, { activityLimit: 3 }),
      monthBudget(ctx, month),
      execute(listTasks, ctx, { scope: "week", limit: 6 }),
      upcomingFromRules(ctx, input.upcomingDays),
      keyDatesBetween(ctx, t, addDays(t, input.upcomingDays)),
      execute(listGoals, ctx, {}),
      execute(listShoppingLists, ctx, {}),
      ctx.db.from("expenses").select("id", { count: "exact", head: true }).eq("household_id", ctx.household.id),
    ]);

    // Key dates already include bill-type rules; add recurring *expenses* (subscriptions…) from rules.
    const upcoming = [
      ...keyDates.map((k) => ({ id: k.id, kind: k.kind as string, title: k.title, date: k.date, daysUntil: k.daysUntil, amountCents: k.amountCents, amount: k.amount })),
      ...ruleItems
        .filter((r) => r.kind === "expense")
        .map((r) => ({ id: r.id, kind: "recurring_expense", title: r.title, date: r.date, daysUntil: r.daysUntil, amountCents: r.amountCents, amount: r.amount })),
    ]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(0, 8);

    const openItems = lists.lists.reduce((s, l) => s + l.openCount, 0);
    const memberCount = ctx.household.members.length;
    const hasExpenses = (expenseCount.count ?? 0) > 0;

    return {
      today: t,
      month,
      household: { name: ctx.household.name, memberCount, onboardingStep: ctx.household.onboardingStep },
      balance: { sentence: balances.sentence, me: balances.me, partner: balances.partner, recent: balances.activity, activityCount: balances.activityCount },
      month_budget: {
        label: budget.monthLabel,
        spentCents: budget.totals.spentCents,
        spent: budget.totals.spent,
        budgetCents: budget.totals.budgetCents,
        budget: budget.totals.budget,
        remainingCents: budget.totals.remainingCents,
        remaining: budget.totals.remaining,
        projectedCents: budget.totals.projectedCents,
        projected: budget.totals.projected,
        ratio: budget.totals.ratio,
        state: budget.totals.state,
        hasBudget: budget.totals.budgetCents > 0,
        watch: budget.lines
          .filter((l) => l.state === "over" || l.state === "warning")
          .sort((a, b) => b.ratio - a.ratio)
          .slice(0, 3)
          .map((l) => ({ name: l.name, state: l.state, remaining: l.remaining, remainingCents: l.remainingCents })),
      },
      upcoming,
      upcomingTotalCents: upcoming.reduce((s, u) => s + (u.amountCents ?? 0), 0),
      upcomingTotal: formatMoney(upcoming.reduce((s, u) => s + (u.amountCents ?? 0), 0)),
      tasks: { week: tasks.week, items: tasks.tasks.slice(0, 5), more: Math.max(0, tasks.tasks.length - 5) },
      shopping: {
        openItems,
        lists: lists.lists.filter((l) => l.openCount > 0).slice(0, 3),
      },
      goals: goals.goals.slice(0, 3),
      flags: { hasExpenses, hasPartner: memberCount > 1 },
    };
  },
});
