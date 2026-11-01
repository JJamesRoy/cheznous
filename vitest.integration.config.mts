import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const env = loadEnv({ path: ".env.local", quiet: true }).parsed ?? {};

/** Integration tests run against the LOCAL Supabase stack (`pnpm supabase start`). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/integration/server-only-stub.ts") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    env,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
