import { describe, expect, it, beforeAll } from "vitest";
import { expectError, run } from "./helpers";
import { createCouple, type Couple } from "./fixtures";
import * as goals from "@/server/usecases/goals";
import * as condo from "@/server/usecases/condo";
import * as expenses from "@/server/usecases/expenses";
import { addMonthsClamped, todayIn } from "@/domain/dates";

const today = () => todayIn("America/Toronto");

describe("goals & projects", () => {
  let c: Couple;
  let other: Couple;

  beforeAll(async () => {
    c = await createCouple(["Camille", "Alex"]);
    other = await createCouple(["Noé", "Zoé"]);
  });

  it("projects: spent = shared linked expenses − refunds; private expenses excluded", async () => {
    const { project, created } = await run(c.a, goals.upsertProject, { name: "Salle de bain", budget: "5 000" });
    expect(created).toBe(true);
    const { expense } = await run(c.a, expenses.createExpense, { amount: "1 200", description: "Céramique", project: "Salle de bain" });
    await run(c.a, expenses.createRefund, { expenseId: expense.id, amount: "200" });
    await run(c.b, expenses.createExpense, { amount: "300", description: "Surprise", project: project.id, isPrivate: true });

    const list = await run(c.a, goals.listProjects, {});
    const p = list.projects.find((x) => x.id === project.id)!;
    expect(p).toMatchObject({ budgetCents: 500_000, spentCents: 100_000, remainingCents: 400_000, expenseCount: 1, overBudget: false });

    const detail = await run(c.b, goals.getProject, { id: "salle de bain" });
    expect(detail.expenses.map((e) => e.description)).toEqual(["Céramique"]);
    expect(detail.expenses[0]).toMatchObject({ amountCents: 120_000, netCents: 100_000 });

    await expectError(run(other.a, goals.getProject, { id: project.id }), "NOT_FOUND");
    await run(c.a, goals.archiveProject, { id: project.id });
    expect((await run(c.a, goals.listProjects, {})).projects.find((x) => x.id === project.id)).toBeUndefined();
    expect((await run(c.a, goals.listProjects, { includeArchived: true })).projects.find((x) => x.id === project.id)?.status).toBe("archived");
  });

  it("savings goal: per-partner totals, progress, suggested monthly amount, idempotent contributions", async () => {
    const targetDate = addMonthsClamped(today(), 6);
    const { goal } = await run(c.a, goals.upsertGoal, { name: "Fonds d'urgence", target: "12 000", targetDate });
    const input = { goal: "fonds d'urgence", amount: "1 000", idempotencyKey: "goal-contrib-0001" };
    const r1 = await run(c.a, goals.addGoalContribution, input);
    const r2 = await run(c.a, goals.addGoalContribution, input);
    expect(r2.replayed).toBe(true);
    expect(r2.contribution.id).toBe(r1.contribution.id);
    await run(c.b, goals.addGoalContribution, { goal: goal.id, amount: "500" });

    const g = (await run(c.b, goals.getGoal, { id: goal.id })).goal;
    expect(g.savedCents).toBe(150_000);
    expect(g.remainingCents).toBe(1_050_000);
    expect(g.progress).toBeCloseTo(0.125);
    expect(g.monthsLeft).toBe(6);
    expect(g.suggestedMonthlyCents).toBe(175_000);
    expect(g.members.map((m) => [m.name, m.savedCents])).toEqual([
      ["Camille", 100_000],
      ["Alex", 50_000],
    ]);
    await expectError(run(other.a, goals.getGoal, { id: goal.id }), "NOT_FOUND");
    await expectError(run(other.a, goals.archiveGoal, { id: goal.id }), "NOT_FOUND");

    await run(c.a, goals.archiveGoal, { id: goal.id });
    expect((await run(c.a, goals.listGoals, {})).goals.find((x) => x.id === goal.id)).toBeUndefined();
  });

  it("mortgage prepayment goal defaults to this year's privilege and counts prepayments made", async () => {
    const { goal } = await run(c.a, goals.upsertGoal, { name: "Rembourser plus vite", kind: "mortgage_prepayment" });
    let g = (await run(c.a, goals.getGoal, { id: goal.id })).goal;
    expect(g.targetCents).toBeNull();
    expect(g.mortgage?.reason).toBe("Ajoute d'abord les infos de ton hypothèque.");

    await run(c.a, condo.upsertMortgage, { originalPrincipal: "300 000", rate: 4.5, startDate: "2025-03-15", amortizationYears: 25, prepaymentPrivilegePct: 10 });
    await run(c.b, condo.addPrepayment, { amount: "5 000", paidBy: "moi" });

    g = (await run(c.a, goals.listGoals, {})).goals.find((x) => x.id === goal.id)!;
    expect(g.targetSource).toBe("mortgage_privilege");
    expect(g.targetCents).toBe(3_000_000);
    expect(g.savedCents).toBe(500_000);
    expect(g.remainingCents).toBe(2_500_000);
    expect(g.targetDate).toBe("2027-03-14");
    expect(g.members.find((m) => m.name === "Alex")?.savedCents).toBe(500_000);
  });
});
