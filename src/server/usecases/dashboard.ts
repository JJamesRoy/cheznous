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
import { monthRange } from "../../domain/dates";
import { selectAll } from "../support";
import type { HouseholdCtx } from "../ctx";

/**
 * The couple as three lanes (Moi · Commun · partner): what each paid this month on shared,
 * non-private expenses, each partner's share of those expenses (from the splits), and the
 * household ratio for comparison. Refunds are left out: this is "who fronted what".
 */
async function lanesFor(ctx: HouseholdCtx, month: string) {
  const { start, endExclusive } = monthRange(month);
  const rows = await selectAll<{ amount_cents: number; paid_by_user: string | null; paid_by_account: string | null; expense_splits: { user_id: string; share_cents: number }[] }>(
    (from, to) =>
      ctx.db
        .from("expenses")
        .select("amount_cents, paid_by_user, paid_by_account, expense_splits(user_id, share_cents)")
        .eq("household_id", ctx.household.id)
        .eq("is_private", false)
        .gte("spent_on", start)
        .lt("spent_on", endExclusive)
        .order("id")
        .range(from, to),
  );
  const paid = new Map<string, number>();
  const share = new Map<string, number>();
  let joint = 0;
  for (const r of rows) {
    const amt = Number(r.amount_cents);
    if (r.paid_by_user) paid.set(r.paid_by_user, (paid.get(r.paid_by_user) ?? 0) + amt);
    else joint += amt;
    for (const sp of r.expense_splits) share.set(sp.user_id, (share.get(sp.user_id) ?? 0) + Number(sp.share_cents));
  }
  const totalWeight = ctx.household.members.reduce((x, m) => x + m.incomeWeightBp, 0) || 1;
  const memberPaid = ctx.household.members.reduce((x, m) => x + (paid.get(m.userId) ?? 0), 0);
  const members = ctx.household.members.map((m) => {
    const p = paid.get(m.userId) ?? 0;
    const sh = share.get(m.userId) ?? 0;
    return {
      userId: m.userId,
      name: m.displayName,
      isMe: m.userId === ctx.userId,
      paidCents: p,
      paid: formatMoney(p),
      shareCents: sh,
      share: formatMoney(sh),
      /** Portion of the member-paid shared spending this person fronted (basis points). */
      paidBp: memberPaid ? Math.round((p * 10000) / memberPaid) : 0,
      ratioBp: Math.round((m.incomeWeightBp * 10000) / totalWeight),
    };
  });
  const me = members.find((m) => m.isMe);
  const finding =
    rows.length === 0
      ? null
      : me && memberPaid
        ? `Tu as avancé ${Math.round(me.paidBp / 100)} % des dépenses partagées payées par vous deux; votre ratio est ${members.map((m) => Math.round(m.ratioBp / 100)).join("/")}.`
        : null;
  return {
    month,
    members,
    joint: { paidCents: joint, paid: formatMoney(joint), name: ctx.household.jointAccountName },
    totalSharedCents: memberPaid + joint,
    totalShared: formatMoney(memberPaid + joint),
    ratioBp: Object.fromEntries(members.map((m) => [m.userId, m.ratioBp])),
    finding,
  };
}

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
    const [balances, budget, tasks, ruleItems, keyDates, goals, lists, expenseCount, lanes] = await Promise.all([
      execute(getBalances, ctx, { activityLimit: 3 }),
      monthBudget(ctx, month),
      execute(listTasks, ctx, { scope: "week", limit: 6 }),
      upcomingFromRules(ctx, input.upcomingDays),
      keyDatesBetween(ctx, t, addDays(t, input.upcomingDays)),
      execute(listGoals, ctx, {}),
      execute(listShoppingLists, ctx, {}),
      ctx.db.from("expenses").select("id", { count: "exact", head: true }).eq("household_id", ctx.household.id),
      lanesFor(ctx, month),
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
      lanes,
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
