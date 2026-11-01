import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Browser, BrowserContext, Page } from "@playwright/test";

config({ path: ".env.local", quiet: true, override: true });

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) throw new Error("E2E only runs against a local Supabase");

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let n = 0;

export type Person = { name: string; email: string; password: string };
export const person = (name: string): Person => ({
  name,
  email: `${name.toLowerCase()}.${run}.${++n}@e2e.cheznous.local`,
  password: `Motdepasse-${run}-${n}`,
});

export async function newContext(browser: Browser, opts: { offline?: boolean } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    locale: "fr-CA",
    timezoneId: "America/Toronto",
  });
  if (opts.offline) await ctx.setOffline(true);
  return ctx;
}

export async function signIn(page: Page, p: Person, next = "/") {
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.locator('input[type="email"]').fill(p.email);
  await page.locator('input[type="password"]').fill(p.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 20_000 });
}

/** Password sign-in through the public Auth API (for MCP/OAuth setup in tests). */
export async function accessToken(p: Person): Promise<string> {
  const sb = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: p.email, password: p.password });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session.access_token;
}

/** Call an app op from inside the page (same-origin, the user's cookie session). */
export async function op<T = unknown>(page: Page, name: string, input: unknown = {}): Promise<T> {
  return page.evaluate(
    async ([n, i]) => {
      const r = await fetch(`/api/ops/${n}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(i) });
      const j = await r.json();
      if (!j.ok) throw new Error(`${n}: ${j.error?.code} ${j.error?.message}`);
      return j.data;
    },
    [name, input] as const,
  ) as Promise<T>;
}
