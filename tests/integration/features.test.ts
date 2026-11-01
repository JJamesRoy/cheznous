import { describe, expect, it, beforeAll } from "vitest";
import { run, expectError } from "./helpers";
import { createCouple, type Couple } from "./fixtures";
import * as expenses from "@/server/usecases/expenses";
import * as budget from "@/server/usecases/budget";
import * as shopping from "@/server/usecases/shopping";
import * as tasks from "@/server/usecases/tasks";
import * as notes from "@/server/usecases/notes";
import * as recurring from "@/server/usecases/recurring";
import * as household from "@/server/usecases/household";
import * as balances from "@/server/usecases/balances";
import { todayIn, monthOf, addMonths, addDays } from "@/domain/dates";

const today = todayIn("America/Toronto");
const month = monthOf(today);
const prevMonth = addMonths(month, -1);

describe("budget", () => {
  let c: Couple;
  beforeAll(async () => {
    c = await createCouple();
  });

  it("budget applies from its month onward and an expense updates spent/remaining", async () => {
    await run(c.a, budget.setBudget, { category: "Épicerie", amount: "600", fromMonth: prevMonth });
    const before = await run(c.b, budget.getBudget, {});
    const line = before.lines.find((l) => l.name === "Épicerie")!;
    expect(line.budgetCents).toBe(60000);
    expect(line.spentCents).toBe(0);
    await run(c.b, expenses.createExpense, { amount: "123,45", description: "IGA", category: "epicerie" });
    const after = await run(c.a, budget.getBudget, {});
    const l2 = after.lines.find((l) => l.name === "Épicerie")!;
    expect(l2.spentCents).toBe(12345);
    expect(l2.remainingCents).toBe(60000 - 12345);
    expect(after.totals.spentCents).toBe(12345);
  });

  it("private expenses never count in shared budgets; joint-account ones do; refunds reduce", async () => {
    await run(c.a, expenses.createExpense, { amount: "50", description: "Perso", category: "Épicerie", isPrivate: true });
    const { expense } = await run(c.a, expenses.createExpense, { amount: "100", description: "Costco", category: "Épicerie", payer: "commun" });
    await run(c.a, expenses.createRefund, { expenseId: expense.id, amount: "20" });
    const b = await run(c.b, budget.getBudget, {});
    expect(b.lines.find((l) => l.name === "Épicerie")!.spentCents).toBe(12345 + 10000 - 2000);
  });

  it("« Combien avons-nous dépensé en épicerie ce mois-ci ? »", async () => {
    const s = await run(c.a, budget.spendingSummary, { category: "épicerie" });
    expect(s.period.totalCents).toBe(20345);
  });

  it("« Compare octobre et novembre » — month vs previous month", async () => {
    await run(c.a, expenses.createExpense, { amount: "80", description: "Resto mois passé", category: "Resto", spentOn: `${prevMonth}-15` });
    const s = await run(c.a, budget.spendingSummary, { month, compareMonth: prevMonth });
    expect(s.comparison!.totalCents).toBe(8000);
    expect(s.period.totalCents).toBe(20345);
    expect(s.comparison!.deltaCents).toBe(20345 - 8000);
    const resto = s.comparison!.byCategory.find((x) => x.name === "Resto")!;
    expect(resto.deltaCents).toBe(-8000);
  });

  it("pay-period view explains 3-payday months", async () => {
    const sess = await run(c.a, household.getSession, {});
    const me = sess.household!.members.find((m) => m.isMe)!;
    const none = await run(c.a, budget.payPeriodBudget, {});
    expect(none.configured).toBe(false);
    await run(c.a, household.updateHouseholdSettings, { payAnchors: { [me.userId]: "2026-01-02" } });
    const jan = await run(c.a, budget.payPeriodBudget, { month: "2026-01" });
    expect(jan.configured && jan.threePaydays).toBe(true);
    // 3 paydays in January plus the period carried over from Dec. 19, clipped to Jan. 1.
    expect(jan.configured && jan.periods.map((p) => p.payday)).toEqual(["2025-12-19", "2026-01-02", "2026-01-16", "2026-01-30"]);
    expect(jan.configured && jan.periods.reduce((s, p) => s + p.days, 0)).toBe(31);
  });
});

describe("shopping lists", () => {
  let c: Couple;
  beforeAll(async () => {
    c = await createCouple();
  });

  it("one-line add parses quantity and price; partner sees it", async () => {
    const { item } = await run(c.b, shopping.addShoppingItem, { list: "epicerie", line: "2 lait 3,99" });
    expect(item).toMatchObject({ name: "lait", quantity: 2, unitPriceCents: 399, totalCents: 798 });
    const l = await run(c.a, shopping.getShoppingList, { list: "Épicerie" });
    expect(l.items.map((i) => i.name)).toContain("lait");
    expect(l.totals.estimatedRemainingCents).toBe(798);
  });

  it("« Ajoute des rideaux à 150 $ dans la liste Meubles » and « Qu'est-ce qu'on doit acheter pour le salon ? »", async () => {
    await run(c.a, shopping.addShoppingItem, { list: "Meubles", name: "Rideaux", unitPrice: "150" });
    const l = await run(c.b, shopping.getShoppingList, { list: "meubles", includePurchased: false });
    expect(l.list.name).toBe("Meubles du condo");
    expect(l.items.map((i) => i.name)).toEqual(["Rideaux"]);
  });

  it("ambiguous list names list the options", async () => {
    await run(c.a, shopping.upsertShoppingList, { name: "Produits pour le chalet" });
    const e = (await expectError(run(c.a, shopping.addShoppingItem, { list: "produits", name: "x" }), "AMBIGUOUS")) as Error;
    expect(e.message).toContain("Produits ménagers");
  });

  it("purchasing an item creates the linked, pre-filled expense; idempotent", async () => {
    const { item } = await run(c.a, shopping.addShoppingItem, { list: "Meubles du condo", name: "Lampe", unitPrice: "89,99", quantity: 2 });
    const r = await run(c.b, shopping.purchaseShoppingItem, { id: item.id, idempotencyKey: "buy-lampe-0001" });
    expect(r.item.purchased).toBe(true);
    expect(r.expense).toMatchObject({ amountCents: 17998, description: "Lampe" });
    expect(r.expense!.category?.name).toBe("Meubles et déco");
    const again = await run(c.b, shopping.purchaseShoppingItem, { id: item.id, idempotencyKey: "buy-lampe-0001" });
    expect(again.expense).toBeNull(); // already linked: nothing new
    const list = await run(c.a, expenses.listExpenses, { search: "lampe" });
    expect(list.expenses).toHaveLength(1);
    const bal = await run(c.a, balances.getBalances, {});
    expect(bal.me).toMatchObject({ kind: "owes", amountCents: 8999 });
  });

  it("toggle is idempotent and offline-replay safe", async () => {
    const { item } = await run(c.a, shopping.addShoppingItem, { list: "Épicerie", name: "Pain", idempotencyKey: "add-pain-00001" });
    const dup = await run(c.a, shopping.addShoppingItem, { list: "Épicerie", name: "Pain", idempotencyKey: "add-pain-00001" });
    expect(dup.item.id).toBe(item.id);
    expect(dup.replayed).toBe(true);
    await run(c.a, shopping.toggleShoppingItem, { id: item.id, purchased: true });
    const t2 = await run(c.a, shopping.toggleShoppingItem, { id: item.id, purchased: true });
    expect(t2.item.purchased).toBe(true);
  });
});

describe("tasks", () => {
  let c: Couple;
  beforeAll(async () => {
    c = await createCouple();
  });

  it("create & assign; partner completes; « Quelles sont nos tâches cette semaine ? »", async () => {
    const { task } = await run(c.a, tasks.createTask, { title: "Changer le filtre de la hotte", assignee: "Alex", dueOn: today, checklist: ["Acheter le filtre", "Installer"] });
    expect(task.assignee?.name).toBe("Alex");
    expect(task.checklist).toHaveLength(2);
    await run(c.a, tasks.createTask, { title: "Plus tard", dueOn: addDays(today, 40) });
    const week = await run(c.b, tasks.listTasks, { scope: "week" });
    expect(week.tasks.map((t) => t.title)).toEqual(["Changer le filtre de la hotte"]);
    const done = await run(c.b, tasks.completeTask, { id: task.id });
    expect(done.task.completed).toBe(true);
    expect(done.task.completedBy?.name).toBe("Alex");
    const g = await run(c.a, tasks.getTask, { id: task.id });
    expect(g.history).toHaveLength(1);
  });

  it("recurring task advances to its next occurrence and keeps history", async () => {
    const { task } = await run(c.a, tasks.createTask, { title: "Sortir le recyclage", dueOn: today, frequency: "weekly" });
    const r = await run(c.a, tasks.completeTask, { id: task.id });
    expect(r.task.completed).toBe(false);
    expect(r.nextDueOn).toBe(addDays(today, 7));
  });
});

describe("notes", () => {
  let c: Couple;
  beforeAll(async () => {
    c = await createCouple();
  });

  it("French full-text search with stemming; private notes stay private", async () => {
    await run(c.a, notes.createNote, { title: "Plombier", bodyMd: "Le plombier recommandé par le syndicat. Factures dans le dossier." });
    await run(c.b, notes.createNote, { title: "Idées cadeaux", bodyMd: "Facture du bijoutier", isPrivate: true });
    const r = await run(c.a, notes.searchNotes, { q: "facture" });
    expect(r.results.map((x) => x.title)).toEqual(["Plombier"]);
    const rb = await run(c.b, notes.searchNotes, { q: "facture" });
    expect(rb.results).toHaveLength(2);
  });
});

describe("recurring", () => {
  let c: Couple;
  beforeAll(async () => {
    c = await createCouple();
  });

  it("every-2-months bill (Hydro-Québec) shows in upcoming bills; municipal tax installments too", async () => {
    await run(c.a, recurring.upsertRecurring, { kind: "bill", title: "Hydro-Québec", amount: "180", category: "Électricité", frequency: "bimonthly", anchorDate: addDays(today, 3) });
    await run(c.a, recurring.upsertRecurring, { kind: "bill", title: "Taxes municipales", amount: "1200", frequency: "installments", anchorDate: addDays(today, 1), installmentDates: [addDays(today, 10), addDays(today, 100)] });
    const up = await run(c.b, recurring.upcomingBills, { days: 30 });
    expect(up.items.map((i) => i.title)).toEqual(["Hydro-Québec", "Taxes municipales"]);
    const rules = await run(c.b, recurring.listRecurring, {});
    expect(rules.rules.find((r) => r.title === "Hydro-Québec")!.frequencyLabel).toBe("Aux deux mois");
  });

  it("auto-create rules materialize once, even if both partners open the app", async () => {
    const { id } = await run(c.a, recurring.upsertRecurring, { kind: "expense", title: "Internet", amount: "75", frequency: "monthly", anchorDate: addDays(today, -40), autoCreate: true, payer: "commun" });
    // Simulate a rule last materialized long ago.
    await c.a.db.from("recurring_rules").update({ materialized_until: addDays(today, -41) }).eq("id", id);
    const [ra, rb] = await Promise.all([run(c.a, recurring.materializeRecurring, {}), run(c.b, recurring.materializeRecurring, {})]);
    const list = await run(c.a, expenses.listExpenses, { search: "internet" });
    expect(list.expenses.length).toBe(2);
    expect(ra.created + rb.created).toBe(2);
  });
});
