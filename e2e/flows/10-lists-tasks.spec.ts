import { test, expect } from "@playwright/test";
import { couple, op } from "../support";

/** Flows 10–12: create a list, partner adds an item live, purchase creates the linked expense. */
test("shopping list: create, partner adds live, purchase → linked expense", async ({ browser }) => {
  const c = await couple(browser);
  const { pageA, pageB } = c;

  // 10. Create a list
  await pageA.goto("/listes");
  await pageA.getByRole("button", { name: "Nouvelle liste" }).first().click();
  const sheet = pageA.getByRole("dialog");
  await sheet.getByLabel("Nom", { exact: true }).fill("Salon");
  await sheet.getByRole("button", { name: "Créer la liste" }).click();
  await pageA.waitForURL(/\/listes\/[0-9a-f-]{36}/);
  const listUrl = new URL(pageA.url()).pathname;

  // 11. Partner adds an item in one line; A sees it without reloading.
  await pageB.goto(listUrl);
  const input = pageB.getByRole("textbox", { name: "Ajouter un article à Salon" });
  await input.fill("2 coussins 24,99");
  await input.press("Enter");
  await expect(pageA.getByRole("button", { name: "Modifier coussins" })).toBeVisible({ timeout: 15_000 });

  // 12. A marks it purchased with the linked, pre-filled expense (2 × 24,99 = 49,98 $).
  await pageA.getByRole("button", { name: "Modifier coussins" }).click();
  await pageA.getByRole("button", { name: "Marquer acheté et ajouter la dépense" }).click();
  await expect(pageA.getByRole("dialog")).toContainText(/49,98/);
  await pageA.getByRole("button", { name: "Ajouter la dépense" }).click();
  await expect(pageA.getByRole("dialog")).toBeHidden();
  await expect
    .poll(async () => (await op<{ expenses: { amountCents: number; shoppingItemId: string | null }[] }>(pageB, "expenses.list", { search: "coussins" })).expenses)
    .toEqual([expect.objectContaining({ amountCents: 4998, shoppingItemId: expect.any(String) })]);

  await c.close();
});

/** Flows 13–14: create and assign a task; the partner completes it. */
test("tasks: create and assign, partner completes", async ({ browser }) => {
  const c = await couple(browser);
  const { pageA, pageB } = c;

  // 13. A creates a task assigned to B, due today.
  await pageA.goto("/taches");
  await pageA.getByRole("button", { name: "Nouvelle tâche" }).first().click();
  const sheet = pageA.getByRole("dialog");
  await sheet.getByLabel("Titre", { exact: true }).fill("Appeler le gestionnaire");
  await sheet.getByRole("button", { name: "Aujourd'hui" }).click();
  await sheet.getByRole("button", { name: "Qui s'en occupe" }).click();
  await pageA.getByRole("menuitemradio", { name: new RegExp(c.b.name) }).or(pageA.getByRole("option", { name: new RegExp(c.b.name) })).first().click();
  await sheet.getByRole("button", { name: "Ajouter la tâche" }).click();
  await expect(sheet).toBeHidden();

  // 14. B sees it and completes it; A sees it done.
  await pageB.goto("/taches");
  const done = pageB.getByRole("checkbox", { name: "Terminer « Appeler le gestionnaire »" });
  await expect(done).toBeVisible({ timeout: 15_000 });
  await done.click();
  await expect
    .poll(async () => (await op<{ tasks: { title: string; completedBy: { name: string } | null }[] }>(pageA, "tasks.list", { scope: "done" })).tasks)
    .toEqual([expect.objectContaining({ title: "Appeler le gestionnaire", completedBy: expect.objectContaining({ name: c.b.name }) })]);
  const assigned = (await op<{ tasks: { assignee: { name: string } | null }[] }>(pageA, "tasks.list", { scope: "all" })).tasks[0];
  expect(assigned.assignee?.name).toBe(c.b.name);

  await c.close();
});
