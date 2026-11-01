import { beforeAll, describe, expect, it } from "vitest";
import { run } from "./helpers";
import { createCouple, type Couple } from "./fixtures";
import * as budget from "@/server/usecases/budget";
import * as expenses from "@/server/usecases/expenses";
import * as recurring from "@/server/usecases/recurring";
import * as insights from "@/server/usecases/insights";
import { addDays, monthOf, todayIn } from "@/domain/dates";

describe("personal budget (private expenses, per member)", () => {
  let c: Couple;
  const today = todayIn("America/Toronto");
  const month = monthOf(today);

  beforeAll(async () => {
    c = await createCouple(["Léa", "Sam"]);
    // One shared expense and one private expense for Léa, same category.
    await run(c.a, expenses.createExpense, { amount: "100", description: "Épicerie", category: "Épicerie", split: { mode: "equal" } });
    await run(c.a, expenses.createExpense, { amount: "40", description: "Lunch solo", category: "Resto", isPrivate: true });
    await run(c.a, budget.setBudget, { category: "Resto", amount: "150", scope: "personal" });
    await run(c.a, budget.setBudget, { category: "Épicerie", amount: "600" });
  });

  it("counts only my private expenses against my own budget", async () => {
    const mine = await run(c.a, budget.getBudget, { month, scope: "personal" });
    expect(mine.scope).toBe("personal");
    expect(mine.totals.spentCents).toBe(4000);
    expect(mine.totals.budgetCents).toBe(15000);
    expect(mine.lines.find((l) => l.name === "Resto")).toMatchObject({ budgetCents: 15000, spentCents: 4000 });
  });

  it("keeps the household budget unchanged (shared expenses only)", async () => {
    const hh = await run(c.a, budget.getBudget, { month });
    expect(hh.totals.spentCents).toBe(10000);
    expect(hh.totals.budgetCents).toBe(60000);
  });

  it("the partner sees neither my personal budget nor my private spending", async () => {
    const theirs = await run(c.b, budget.getBudget, { month, scope: "personal" });
    expect(theirs.totals.spentCents).toBe(0);
    expect(theirs.totals.budgetCents).toBe(0);
    const { data } = await c.b.db.from("personal_budgets").select("*").eq("household_id", c.householdId);
    expect(data).toEqual([]);
    // Nor can they write a personal budget row in my name.
    const forged = await c.b.db.from("personal_budgets").insert({ household_id: c.householdId, user_id: c.a.id, category_id: (await c.b.db.from("budget_categories").select("id").eq("household_id", c.householdId).limit(1)).data![0].id, month: `${month}-01`, amount_cents: 1 });
    expect(forged.error).not.toBeNull();
  });

  it("private recurring rules stay private and materialize as private expenses", async () => {
    const { id } = await run(c.a, recurring.upsertRecurring, {
      kind: "expense",
      title: "Gym",
      amount: "45",
      category: "Santé et pharmacie",
      frequency: "monthly",
      anchorDate: addDays(today, -1),
      autoCreate: true,
      isPrivate: true,
      payer: "commun", // ignored: a private rule is always paid by its author
    });
    // The partner never sees the rule.
    const theirs = await run(c.b, recurring.listRecurring, {});
    expect(theirs.rules.find((r) => r.id === id)).toBeUndefined();
    const mineOnly = await run(c.a, recurring.listRecurring, { isPrivate: true });
    expect(mineOnly.rules.map((r) => r.title)).toEqual(["Gym"]);

    // Editing without the flag keeps it private.
    await run(c.a, recurring.upsertRecurring, { id, kind: "expense", title: "Gym", amount: "45", frequency: "monthly", anchorDate: addDays(today, -1), autoCreate: true });
    await c.a.db.from("recurring_rules").update({ materialized_until: addDays(today, -2) }).eq("id", id);

    const res = await run(c.a, recurring.materializeRecurring, {});
    expect(res.created).toBe(1);
    const gym = (await run(c.a, expenses.listExpenses, { search: "gym" })).expenses;
    expect(gym).toHaveLength(1);
    expect(gym[0]).toMatchObject({ isPrivate: true, amountCents: 4500, splitMode: "none" });
    expect(gym[0].payer).toMatchObject({ userId: c.a.id });
    // Invisible to the partner, and absent from the household budget.
    expect((await run(c.b, expenses.listExpenses, { search: "gym" })).expenses).toHaveLength(0);
    expect((await run(c.a, budget.getBudget, { month })).totals.spentCents).toBe(10000);
  });

  it("the AI snapshot holds my private data, never my partner's", async () => {
    await run(c.b, expenses.createExpense, { amount: "999", description: "Cadeau secret", isPrivate: true });
    const { buildCtx } = await import("@/server/ctx");
    const ctxB = await buildCtx(c.b.db, { source: "test", claims: { sub: c.b.id, email: c.b.email } });
    const ctxA = await buildCtx(c.a.db, { source: "test", claims: { sub: c.a.id, email: c.a.email } });
    const snapA = JSON.stringify(await insights.insightSnapshot(ctxA as never));
    const snapB = JSON.stringify(await insights.insightSnapshot(ctxB as never));
    expect(snapA).toContain("Gym");
    expect(snapA).not.toContain("Cadeau secret");
    expect(snapB).toContain("Cadeau secret");
    expect(snapB).not.toContain("Gym");
    expect(snapB).not.toContain("Lunch solo");
  });

  it("stored advice is private to its author", async () => {
    await c.a.db.from("ai_insights").insert({ household_id: c.householdId, user_id: c.a.id, model: "test", result: { summary: "x", recommendations: [], caveats: [] } });
    const mine = await run(c.a, insights.latestInsights, {});
    expect(mine.insight?.advice?.summary).toBe("x");
    const theirs = await run(c.b, insights.latestInsights, {});
    expect(theirs.insight).toBeNull();
  });
});
