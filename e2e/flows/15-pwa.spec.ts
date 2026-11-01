import { test, expect } from "@playwright/test";

/** Flow 15: installability basics — manifest, icons, service worker registered and controlling. */
test("manifest is valid and the service worker registers", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBeTruthy();
  expect(m.lang).toBe("fr-CA");
  const sizes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? "any"}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of m.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);

  await page.goto("/connexion");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", /#/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  // The SW is only registered in production builds.
  test.skip(!!process.env.E2E_BASE_URL && !process.env.E2E_PROD, "service worker registers only in production builds");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});
