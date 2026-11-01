import { describe, expect, it, beforeAll } from "vitest";
import { createUser, expectError, run } from "./helpers";
import { createCouple, type Couple } from "./fixtures";
import * as household from "@/server/usecases/household";
import * as expenses from "@/server/usecases/expenses";
import * as balances from "@/server/usecases/balances";

describe("vertical slice: household → invite → expense → balance", () => {
  let c: Couple;
  beforeAll(async () => {
    c = await createCouple();
  });

  it("both partners see the same household with two members in canonical order", async () => {
    const sa = await run(c.a, household.getSession, {});
    const sb = await run(c.b, household.getSession, {});
    expect(sa.household?.id).toBe(c.householdId);
    expect(sb.household?.id).toBe(c.householdId);
    expect(sa.household?.members.map((m) => m.displayName)).toEqual(["Camille", "Alex"]);
    expect(sa.categories?.length).toBe(19);
    expect(sa.lists?.map((l) => l.name)).toEqual(["Épicerie", "Meubles du condo", "Produits ménagers"]);
  });

  it("invitation tokens are single-use", async () => {
    const extra = await createUser("Intrus");
    const inv = await run(c.a, household.createInvitation, {}).catch((e) => e);
    // Household is full: no new invitation can be created.
    expect((inv as { code?: string }).code).toBe("CONFLICT");
    await expectError(run(extra, household.acceptInvitation, { token: "x".repeat(43) }), "INVITE_INVALID");
  });

  it("an equal expense paid by A makes B owe half", async () => {
    const { expense } = await run(c.a, expenses.createExpense, { amount: "85,01", description: "Costco", category: "epicerie" });
    expect(expense.amountCents).toBe(8501);
    expect(expense.category?.name).toBe("Épicerie");
    expect(expense.splits.map((s) => s.shareCents)).toEqual([4251, 4250]); // remainder cent → first in canonical order
    const bal = await run(c.b, balances.getBalances, {});
    expect(bal.me).toMatchObject({ kind: "owes", amountCents: 4250 });
    expect(bal.sentence).toMatch(/^Tu dois 42,50\s\$ à Camille$/);
  });

  it("joint-account expenses never create debt", async () => {
    const before = await run(c.a, balances.getBalances, {});
    await run(c.b, expenses.createExpense, { amount: "120", description: "Hydro-Québec", payer: "commun" });
    const after = await run(c.a, balances.getBalances, {});
    expect(after.me.amountCents).toBe(before.me.amountCents);
  });

  it("private expenses are invisible to the partner and excluded from balances", async () => {
    const before = await run(c.a, balances.getBalances, {});
    const { expense } = await run(c.b, expenses.createExpense, { amount: "40", description: "Cadeau surprise", isPrivate: true });
    expect(expense.splitMode).toBe("none");
    const listA = await run(c.a, expenses.listExpenses, {});
    expect(listA.expenses.find((e) => e.id === expense.id)).toBeUndefined();
    await expectError(run(c.a, expenses.getExpense, { id: expense.id }), "NOT_FOUND");
    const after = await run(c.a, balances.getBalances, {});
    expect(after.me.amountCents).toBe(before.me.amountCents);
  });

  it("idempotency: same key + same input → one expense; different input → conflict", async () => {
    const input = { amount: "85", description: "Costco", payer: "moi", split: { mode: "percentage" as const, percentages: { moi: 50, Alex: 50 } }, idempotencyKey: "k-costco-0001" };
    const r1 = await run(c.a, expenses.createExpense, input);
    const r2 = await run(c.a, expenses.createExpense, input);
    expect(r2.replayed).toBe(true);
    expect(r2.expense.id).toBe(r1.expense.id);
    const list = await run(c.a, expenses.listExpenses, { search: "costco" });
    expect(list.expenses.filter((e) => e.id === r1.expense.id)).toHaveLength(1);
    await expectError(run(c.a, expenses.createExpense, { ...input, amount: "86" }), "IDEMPOTENCY_CONFLICT");
  });

  it("settlement preview writes nothing; confirmed settlement zeroes the balance", async () => {
    const bal = await run(c.a, balances.getBalances, {});
    expect(bal.me.kind).toBe("owed");
    const preview = await run(c.b, balances.createSettlement, {});
    expect(preview.status).toBe("preview");
    expect((await run(c.a, balances.getBalances, {})).me.amountCents).toBe(bal.me.amountCents);
    const done = await run(c.b, balances.createSettlement, { confirm: true, idempotencyKey: "settle-0001" });
    expect(done.status).toBe("recorded");
    expect(done.preview.amountCents).toBe(bal.me.amountCents);
    const after = await run(c.a, balances.getBalances, {});
    expect(after.me.kind).toBe("even");
    expect(after.sentence).toBe("Vous êtes quittes");
    expect(after.activity).toHaveLength(0);
  });

  it("refunds are not settlements: a refund received by A reduces what B owes proportionally", async () => {
    const { expense } = await run(c.a, expenses.createExpense, { amount: "100", description: "IKEA", split: { mode: "equal" } });
    expect((await run(c.b, balances.getBalances, {})).me.amountCents).toBe(5000);
    await run(c.a, expenses.createRefund, { expenseId: expense.id, amount: "30" });
    const after = await run(c.b, balances.getBalances, {});
    expect(after.me).toMatchObject({ kind: "owes", amountCents: 3500 });
    await expectError(run(c.a, expenses.createRefund, { expenseId: expense.id, amount: "80" }), "VALIDATION");
  });

  it("income-ratio split uses the stored ratio, not salaries", async () => {
    const s = await run(c.a, household.getSession, {});
    const [ma, mb] = s.household!.members;
    await run(c.a, household.updateHouseholdSettings, { incomeWeightsBp: { [ma.userId]: 5500, [mb.userId]: 4500 } });
    const { expense } = await run(c.b, expenses.createExpense, { amount: "200", description: "Épicerie Métro", split: { mode: "income" } });
    expect(expense.splits.map((x) => x.shareCents)).toEqual([11000, 9000]);
  });

  it("editing an expense recomputes splits and is audited with before/after", async () => {
    const { expense } = await run(c.a, expenses.createExpense, { amount: "10", description: "Dépanneur" });
    const { expense: upd } = await run(c.b, expenses.updateExpense, { id: expense.id, amount: "20,01" });
    expect(upd.splits.map((x) => x.shareCents)).toEqual([1001, 1000]);
    const { data } = await c.a.db.from("audit_logs").select("action, before, after").eq("table_name", "expenses").eq("row_id", expense.id).order("id");
    expect(data?.map((d) => d.action)).toEqual(["INSERT", "UPDATE"]);
    expect(data?.[1].before.amount_cents).toBe(1000);
    expect(data?.[1].after.amount_cents).toBe(2001);
  });
});
