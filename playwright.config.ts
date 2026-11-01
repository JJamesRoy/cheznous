import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a production build served locally with .env.local (see docs/DECISIONS.md D10).
 * Prerequisites: `pnpm supabase start` and `pnpm build`.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    locale: "fr-CA",
    timezoneId: "America/Toronto",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "e2e", testMatch: /flows\/.*\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "screenshots", testMatch: /screenshots\.spec\.ts/ },
  ],
  webServer: {
    command: "node scripts/local-env.mjs next start -p 3000",
    url: "http://localhost:3000/connexion",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
