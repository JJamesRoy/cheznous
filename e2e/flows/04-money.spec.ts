import { test, expect, type Page } from "@playwright/test";
import { couple, op } from "../support";

const money = (s: string) => new RegExp(s.replace(",", ",").replace(/\s/g, "\\s") + "\\s?\\$");

async function quickAddExpense(page: Page, amount: string, description: string) {
  await page.getByRole("button", { name: "Nouvelle dépense" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Montant", { exact: true }).fill(amount);
  await sheet.getByLabel("Description", { exact: true }).fill(description);
  await sheet.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(sheet).toBeHidden();
}

/**
 * Flows 4–9: shared expense, live for the partner, balances for each split mode, settlement,
 * budget configured and updated by an expense.
 */
test("expenses, live sync, split modes, settlement and budget", async ({ browser }) => {
  const c = await couple(browser);
  const { pageA, pageB } = c;

  // 5. B watches Dépenses while A adds an expense from the quick-add sheet (4).
  await pageB.goto("/depenses");
  await pageA.goto("/");
  await quickAddExpense(pageA, "85,01", "Costco");
  await expect(pageB.getByText("Costco").first()).toBeVisible({ timeout: 15_000 });

  // 6. Equal split: remainder cent to the first member (A) → B owes 42,50 $.
  await pageB.goto("/balances");
  await expect(pageB.getByText(/Tu dois/).first()).toBeVisible();
  await expect(pageB.locator("body")).toContainText(/42,50\s\$/);

  const s = await op<{ household: { members: { userId: string; isMe: boolean }[] } }>(pageA, "session.get");
  const [ma, mb] = s.household.members;
  const balanceOf = async (page: Page) => (await op<{ me: { kind: string; amountCents: number } }>(page, "balances.get")).me;

  // Percentage 70/30 on 100 $ paid by A → B owes 30 $ more.
  await op(pageA, "expenses.create", { amount: "100", description: "Pourcentage", split: { mode: "percentage", percentages: { [ma.userId]: 70, [mb.userId]: 30 } } });
  expect(await balanceOf(pageB)).toMatchObject({ kind: "owes", amountCents: 4250 + 3000 });
  // Exact: B pays 60 $, A's share 10 $, B's share 50 $ → A owes B 10 $ less of the debt.
  await op(pageB, "expenses.create", { amount: "60", description: "Exact", split: { mode: "exact", exact: { [ma.userId]: "10", [mb.userId]: "50" } } });
  expect(await balanceOf(pageB)).toMatchObject({ kind: "owes", amountCents: 7250 - 1000 });
  // Income ratio 55/45 on 200 $ paid by B → A owes 110 $.
  await op(pageA, "household.updateSettings", { incomeWeightsBp: { [ma.userId]: 5500, [mb.userId]: 4500 } });
  await op(pageB, "expenses.create", { amount: "200", description: "Ratio", split: { mode: "income" } });
  expect(await balanceOf(pageB)).toMatchObject({ kind: "owed", amountCents: 11000 - 6250 });
  // Joint account: no change.
  await op(pageA, "expenses.create", { amount: "300", description: "Hydro", payer: "commun" });
  expect(await balanceOf(pageB)).toMatchObject({ kind: "owed", amountCents: 4750 });

  // 7. Settlement with slide-to-confirm (keyboard: focus the thumb, Enter) — A owes B 47,50 $.
  await pageA.goto("/balances");
  await expect(pageA.locator("body")).toContainText(/47,50\s\$/);
  const slider = pageA.getByRole("button", { name: /Glisse pour régler/ });
  await slider.focus();
  await slider.press("Enter");
  await expect(pageA.getByText("Vous êtes quittes").first()).toBeVisible({ timeout: 10_000 });
  await pageB.goto("/");
  await expect(pageB.getByText("Vous êtes quittes").first()).toBeVisible();

  // 8. Configure a budget (through the app RPC from the signed-in page) — 9. an expense updates it.
  await op(pageA, "budget.set", { category: "Épicerie", amount: "600" });
  await pageA.goto("/budget");
  await expect(pageA.getByText("Épicerie").first()).toBeVisible();
  const before = (await op<{ lines: { name: string; spentCents: number }[] }>(pageA, "budget.get")).lines.find((l) => l.name === "Épicerie")!;
  await pageB.goto("/");
  await quickAddExpense(pageB, "123,45", "IGA");
  await op(pageB, "expenses.update", {
    id: (await op<{ expenses: { id: string }[] }>(pageB, "expenses.list", { search: "IGA" })).expenses[0].id,
    category: "Épicerie",
  });
  await expect
    .poll(async () => (await op<{ lines: { name: string; spentCents: number }[] }>(pageA, "budget.get")).lines.find((l) => l.name === "Épicerie")!.spentCents)
    .toBe(before.spentCents + 12345);
  await pageA.reload();
  await expect(pageA.locator("body")).toContainText(money("123,45"));

  await c.close();
});

/** Flow 19: an expense added offline is queued, shown as pending, and synced exactly once. */
test("offline expense is queued and synced once on reconnect", async ({ browser }) => {
  const c = await couple(browser);
  const { pageA, ctxA } = c;
  await pageA.goto("/depenses");
  await expect(pageA.getByRole("heading", { name: "Dépenses" }).first()).toBeAttached();
  await ctxA.setOffline(true);
  await quickAddExpense(pageA, "12,34", "Dépanneur hors ligne");
  await expect(pageA.getByTestId("offline-banner")).toContainText(/en attente de synchronisation/);
  await ctxA.setOffline(false);
  await expect(pageA.getByTestId("offline-banner")).toBeHidden({ timeout: 20_000 });
  const list = await op<{ expenses: { description: string }[] }>(pageA, "expenses.list", { search: "hors ligne" });
  expect(list.expenses).toHaveLength(1);
  await c.close();
});
