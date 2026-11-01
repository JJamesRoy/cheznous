import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { couple, op, signIn, type Person } from "./support";

/**
 * Visual QA: every main screen at 375 / 430 / 768 / 1440 px in light and dark, plus empty,
 * loading and error states. Writes docs/screenshots/*.jpg and docs/screenshots/qa-report.json
 * (horizontal overflow, console errors, small touch targets on phones).
 * Uses the dev seed's demo household (`pnpm seed:demo`) for filled states.
 */
const OUT = "docs/screenshots";
const WIDTHS = [375, 430, 768, 1440] as const;
const THEMES = ["light", "dark"] as const;
const DEMO: Person = { name: "Démo A", email: "demo.a@chez-nous.local", password: "demo-chez-nous" };

type Finding = { screen: string; width: number; theme: string; overflowX: boolean; smallTargets: string[]; consoleErrors: string[] };
const findings: Finding[] = [];

async function page(browser: Browser, width: number, theme: "light" | "dark") {
  const mobile = width < 768;
  const ctx = await browser.newContext({
    viewport: { width, height: width >= 1024 ? 900 : width >= 768 ? 1024 : 860 },
    isMobile: mobile,
    hasTouch: width < 1024,
    colorScheme: theme,
    locale: "fr-CA",
    timezoneId: "America/Toronto",
    reducedMotion: "reduce",
  });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  return { ctx, p, errors };
}

async function settle(p: Page) {
  await p.waitForLoadState("networkidle").catch(() => undefined);
  await p.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 8000 }).catch(() => undefined);
  await p.waitForTimeout(300);
}

async function audit(p: Page, screen: string, width: number, theme: string, errors: string[]) {
  const r = await p.evaluate((w) => {
    const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const small: string[] = [];
    if (w < 768) {
      for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input, [role=checkbox], [role=switch], [role=tab], [role=radio]")) {
        const r0 = el.getBoundingClientRect();
        if (!r0.width || !r0.height || getComputedStyle(el).visibility === "hidden") continue;
        // An invisible ::before hit area (absolute, negative insets) counts toward the target size.
        const ps = getComputedStyle(el, "::before");
        const grow = (v: string) => (ps.content !== "none" && ps.position === "absolute" ? Math.max(0, -parseFloat(v) || 0) : 0);
        const b = { width: r0.width + grow(ps.left) + grow(ps.right), height: r0.height + grow(ps.top) + grow(ps.bottom) };
        if (b.height < 44 && b.width < 44) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}" ${Math.round(b.width)}×${Math.round(b.height)}`);
      }
    }
    return { overflowX, small: small.slice(0, 12) };
  }, width);
  findings.push({ screen, width, theme, overflowX: r.overflowX, smallTargets: r.small, consoleErrors: [...errors] });
}

const SCREENS = [
  "/", "/depenses", "/balances", "/budget", "/listes", "/taches", "/notes", "/condo", "/condo/hypotheque",
  "/condo/syndicat", "/condo/documents", "/condo/apport", "/objectifs", "/reglages", "/plus",
];

test.describe.configure({ mode: "serial" });
test.setTimeout(15 * 60_000);

test("main screens, filled (demo household)", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      const { ctx, p, errors } = await page(browser, width, theme);
      await signIn(p, DEMO);
      const lists = await op<{ lists: { id: string; name: string }[] }>(p, "shopping.lists");
      const screens = [...SCREENS, `/listes/${lists.lists.find((l) => l.name === "Épicerie")!.id}`];
      for (const path of screens) {
        if (path === "/plus" && width >= 1024) continue;
        errors.length = 0;
        await p.goto(path);
        await settle(p);
        const name = path === "/" ? "accueil" : path.slice(1).replace(/\//g, "-").replace(/-[0-9a-f-]{36}$/, "-epicerie");
        await p.screenshot({ path: `${OUT}/${name}-${width}-${theme}.jpg`, type: "jpeg", quality: 78 });
        await audit(p, name, width, theme, errors);
      }
      // Quick add sheet
      if (width === 375 || width === 1440) {
        await p.goto("/");
        await settle(p);
        await p.getByRole("button", { name: "Nouvelle dépense" }).first().click();
        await p.getByRole("dialog").waitFor();
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${OUT}/ajout-depense-${width}-${theme}.jpg`, type: "jpeg", quality: 78 });
      }
      await ctx.close();
    }
  }
});

test("auth, onboarding, empty, loading and error states", async ({ browser }) => {
  for (const width of [375, 1440] as const) {
    for (const theme of THEMES) {
      // Signed out
      const s = await page(browser, width, theme);
      for (const path of ["/connexion", "/inscription"]) {
        await s.p.goto(path);
        await settle(s.p);
        await s.p.screenshot({ path: `${OUT}${path}-${width}-${theme}.jpg`, type: "jpeg", quality: 78 });
        await audit(s.p, path.slice(1), width, theme, s.errors);
      }
      await s.ctx.close();

      // Empty household (fresh couple)
      const c = await couple(browser);
      await c.ctxB.close();
      const ctx = await page(browser, width, theme);
      await signIn(ctx.p, c.a);
      for (const path of ["/", "/depenses", "/budget", "/taches", "/notes", "/objectifs", "/condo/hypotheque"]) {
        await ctx.p.goto(path);
        await settle(ctx.p);
        const name = `vide-${path === "/" ? "accueil" : path.slice(1).replace(/\//g, "-")}`;
        await ctx.p.screenshot({ path: `${OUT}/${name}-${width}-${theme}.jpg`, type: "jpeg", quality: 78 });
        await audit(ctx.p, name, width, theme, ctx.errors);
      }
      // Onboarding step (fresh account mid-onboarding)
      await op(ctx.p, "household.updateSettings", { onboardingStep: "ratio" });
      await ctx.p.goto("/bienvenue");
      await settle(ctx.p);
      await ctx.p.screenshot({ path: `${OUT}/bienvenue-${width}-${theme}.jpg`, type: "jpeg", quality: 78 });

      // Loading: hold every op for a while and capture the skeletons.
      await ctx.p.route("**/api/ops/**", async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.continue().catch(() => undefined);
      });
      await ctx.p.evaluate(() => localStorage.removeItem("cn-cache-v1"));
      await ctx.p.goto("/depenses");
      await ctx.p.waitForTimeout(1200);
      await ctx.p.screenshot({ path: `${OUT}/chargement-depenses-${width}-${theme}.jpg`, type: "jpeg", quality: 78 });
      await ctx.p.unroute("**/api/ops/**");

      // Error: the list op fails.
      await ctx.p.route("**/api/ops/expenses.list", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "INTERNAL", message: "Une erreur inattendue est survenue." } }) }),
      );
      await ctx.p.goto("/depenses");
      await ctx.p.waitForTimeout(3500);
      await ctx.p.screenshot({ path: `${OUT}/erreur-depenses-${width}-${theme}.jpg`, type: "jpeg", quality: 78 });
      await ctx.ctx.close();
      await c.ctxA.close();
    }
  }
});

test.afterAll(() => {
  writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(findings, null, 2));
  const overflow = findings.filter((f) => f.overflowX);
  expect(overflow, `horizontal overflow: ${overflow.map((f) => `${f.screen}@${f.width}`).join(", ")}`).toEqual([]);
});
