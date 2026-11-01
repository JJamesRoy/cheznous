# Chez Nous

Shared home & money app for a couple who just bought a condo in Montréal: Splitwise-style expense
sharing with proportional splits, budget (by month or by biweekly pay period), shopping lists, tasks,
notes, condo management (Québec divided co-ownership: syndicate, mortgage with semi-annual
compounding and prepayment privilege, welcome tax, documents) — and a real remote **MCP server** so
the couple can use it from Claude.

Québec French UI, CAD, America/Toronto. Installable PWA.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS v4 · Radix · Motion · Vaul · Sonner · cmdk ·
NumberFlow · TanStack Query · Zod · Supabase (Postgres, Auth + OAuth 2.1 server, Realtime, Storage) ·
MCP TypeScript SDK (Streamable HTTP) · Vitest + fast-check · Playwright. Exact versions in `package.json`
and `docs/DECISIONS.md`.

## Layout

```
src/domain/    pure business rules (money, splits, balances, budgets, recurrence, mortgage) — no framework
src/server/    use cases (Zod in → typed result out), shared by the app and the MCP server
src/mcp/       MCP tools: thin adapters over src/server
src/app/       Next.js routes; /api/ops/[op] (app RPC) and /api/mcp (MCP)
supabase/      migrations: schema, RLS, RPCs, triggers, storage policies
tests/unit     domain tests (property-based)          tests/integration  real DB: RLS, use cases, MCP + OAuth
e2e/           Playwright flows and screenshots
docs/          DESIGN · ARCHITECTURE · DECISIONS · MCP · DEPLOY · screenshots
```

## Getting started

```bash
pnpm install
pnpm supabase start            # needs Docker
pnpm supabase db reset
cp .env.example .env.local     # paste the URL and publishable key printed by `supabase start`
pnpm dev                       # http://localhost:3000
pnpm seed:demo                 # optional, local only: two demo accounts (see the script header)
```

Full setup (signing keys, OAuth server, production): `docs/DEPLOY.md`.

## Scripts

| | |
|---|---|
| `pnpm dev` / `pnpm dev:local` | dev server (`:local` forces `.env.local` over the shell environment) |
| `pnpm build` / `pnpm start` | production build |
| `pnpm typecheck` · `pnpm lint` | |
| `pnpm test` | unit tests (domain) |
| `pnpm test:integration` | integration tests against the local Supabase (RLS, use cases, MCP over OAuth) |
| `pnpm e2e` | Playwright acceptance flows (needs `pnpm build` and local Supabase) |
| `pnpm seed:demo` · `pnpm seed:reset` | dev-only demo data · wipe local database |

## Status

See `PROGRESS.md` for what is verified, how, and what is not.
