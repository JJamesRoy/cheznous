import { test, expect } from "@playwright/test";
import { newContext, person } from "../support";

/** Acceptance flows 1–3: sign up, create household, invite partner, partner joins. */
test("sign up → create household → invite → partner joins through the link", async ({ browser }) => {
  const a = person("Camille");
  const b = person("Alex");

  const ctxA = await newContext(browser);
  const pageA = await ctxA.newPage();
  await pageA.goto("/inscription");
  await pageA.getByLabel("Prénom", { exact: true }).fill(a.name);
  await pageA.getByLabel("Courriel", { exact: true }).fill(a.email);
  await pageA.getByLabel("Mot de passe", { exact: true }).fill(a.password);
  await pageA.getByRole("button", { name: "Créer mon compte" }).click();
  await pageA.waitForURL(/\/bienvenue/);

  // 1. Create the household
  await pageA.getByLabel("Nom du foyer").fill("Chez nous à Verdun");
  await pageA.getByRole("button", { name: "Créer le foyer" }).click();

  // 2. Invite: create the single-use link
  await pageA.getByRole("button", { name: "Créer le lien d'invitation" }).click();
  const link = await pageA.getByLabel("Lien d'invitation").inputValue();
  expect(link).toMatch(/\/rejoindre\/[A-Za-z0-9_-]{30,}$/);

  // 3. Partner opens the link signed out, creates an account through it, joins
  const ctxB = await newContext(browser);
  const pageB = await ctxB.newPage();
  await pageB.goto(new URL(link).pathname);
  await expect(pageB.getByText("Chez nous à Verdun")).toBeVisible();
  await pageB.getByRole("link", { name: "Créer mon compte" }).click();
  await pageB.getByLabel("Prénom", { exact: true }).fill(b.name);
  await pageB.getByLabel("Courriel", { exact: true }).fill(b.email);
  await pageB.getByLabel("Mot de passe", { exact: true }).fill(b.password);
  await pageB.getByRole("button", { name: "Créer mon compte" }).click();
  await pageB.waitForURL(/\/rejoindre\//);
  await pageB.getByRole("button", { name: /Rejoindre/ }).click();
  await pageB.waitForURL((u) => u.pathname === "/");

  // The link is single-use: opening it again as a third person fails.
  const ctxC = await newContext(browser);
  const pageC = await ctxC.newPage();
  await pageC.goto(new URL(link).pathname);
  await expect(pageC.getByRole("heading", { name: "Cette invitation a déjà servi" })).toBeVisible();

  // A sees the partner joined (the invite step polls).
  await expect(pageA.getByText(new RegExp(`${b.name}.*rejoint`))).toBeVisible({ timeout: 20_000 });

  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
});
