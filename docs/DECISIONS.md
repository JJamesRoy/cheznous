# Decisions log

Non-obvious decisions and tradeoffs, newest at the bottom. Each entry: context → decision → why.

## D1 — Separate repository
The session started in an unrelated repository (`trouve-mon-prix`, a Twilio voice project).
Chez Nous lives in its own repository `JJamesRoy/cheznous`. Nothing from the other project is reused.

## D2 — Pinned versions (checked 2026-11-01 with `npm view`)
| Package | Version |
|---|---|
| next | 16.4.3 |
| react / react-dom | 19.3.0 |
| @supabase/supabase-js | 2.118.0 |
| @supabase/ssr | 0.12.7 |
| supabase (CLI) | 2.122.0 |
| @modelcontextprotocol/sdk | 1.32.2 (LATEST_PROTOCOL_VERSION `2025-11-25`) |
| zod | 4.6.7 |
| tailwindcss | 4.3.3 |
| motion | 14.9.0 |
| vitest | 5.0.5 · fast-check 4.10.2 |
| @playwright/test | 1.63.0 — pinned to the Chromium build pre-installed in this environment (1.64.1 is latest) |
| typescript | 5.9.3 — TypeScript 7 (native) is out, but Next 16.4's tooling was scaffolded with 5.9 |

`.npmrc` sets `save-exact=true`; every dependency in `package.json` is an exact version.

## D3 — `cacheComponents` / partial prefetching turned off
Next 16.4's scaffold enables Cache Components. Almost every screen of Chez Nous is per-user,
per-household, realtime data; there is little static shell to prerender, and Cache
Components makes every cookie read a build-time error outside `<Suspense>`. Turning it off
keeps the auth model simple (SSR cookies → user-scoped Supabase client). Screens are client
components fed by TanStack Query, which also gives us the persisted cache we need offline.

## D4 — One RPC surface for the app: `/api/ops/[op]`
Instead of dozens of server actions, the app calls a single route handler that dispatches to
the op registry in `src/server/ops.ts`. Server actions run serially per client and are awkward
to call from TanStack Query; a route handler is parallel, cacheable by key, and is literally
the same registry the MCP server uses. Each op validates input with Zod and returns
`{ ok: true, data } | { ok: false, error: { code, message, details } }`.

## D5 — MCP authorization: Supabase Auth OAuth 2.1 server
Evaluated Supabase Auth's OAuth server (GoTrue v2.197 in CLI 2.122): it provides
authorization server metadata (`/auth/v1/.well-known/oauth-authorization-server` and
`/auth/v1/.well-known/openid-configuration`), dynamic client registration, authorization code +
PKCE (S256), refresh tokens, and a consent hand-off to our own `/oauth/consent` page. Tokens
are regular Supabase user JWTs carrying a `client_id` claim — so RLS applies to MCP calls with
zero extra work. This beats hand-rolling or running `oidc-provider` alongside Supabase.
We serve Protected Resource Metadata (RFC 9728) ourselves and verify tokens with `jose`
against the project JWKS, which requires **asymmetric signing keys** (ES256). Locally we
generate a key with `supabase gen signing-key`; the file is git-ignored.
Known gap: Supabase's OAuth server does not (as of this version) bind tokens to an RFC 8707
`resource` audience; tokens carry `aud: authenticated`. We accept only tokens with a
`client_id` claim (i.e. issued through the OAuth flow) unless `MCP_ALLOW_SESSION_TOKENS=true`
(dev only), and document the audience limitation in `docs/MCP.md`.

## D6 — Audit log via triggers
`audit_logs` is written by `AFTER INSERT/UPDATE/DELETE` triggers (before/after JSON, actor =
`auth.uid()`), not by application code. It cannot be bypassed by a code path that forgets it,
and it captures MCP and app writes identically. MCP tool calls get their own table
(`mcp_tool_calls`) with tool name, argument summary (no free-text bodies), status, latency.

## D7 — MCP rate limiting in Postgres
Vercel functions are stateless, so an in-memory limiter is meaningless. The limiter counts
the caller's rows in `mcp_tool_calls` over the last 60 seconds (indexed on `(user_id, at)`):
60 calls/minute/user. No Redis dependency.

## D8 — Local Supabase images from Docker Hub
The environment's proxy blocks the CLI's default registries' blob storage (public.ecr.aws,
ghcr.io). The same images were pulled from Docker Hub and re-tagged as
`public.ecr.aws/supabase/*` so `supabase start` finds them locally. This only affects this
build environment, not the project.

## D9 — Hand-written service worker
`next-pwa`/Serwist would add a build plugin with its own versioning surface. Our caching needs
are small (app shell + static assets; data persistence is handled by TanStack's persister), so
`public/sw.js` is ~150 lines we fully control.

## D10 — `.env.local` must win over the shell
This build environment exports another project's Supabase credentials (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, …). Next.js and dotenv give the process environment precedence over `.env*`
files. So: integration tests inject `.env.local` through Vitest's `test.env`, and refuse any
non-local URL; `pnpm seed:demo` loads with `override: true` and refuses non-local URLs;
`pnpm dev:local` / `start:local` / the Playwright web server use `scripts/local-env.mjs`, which loads
`.env.local` with override before spawning. A normal developer shell is unaffected.

## D11 — Couples only: at most two members, one mortgage
The schema keeps `household_members` many-to-many (multi-household ready), but `accept_invitation`
refuses a third member (`HOUSEHOLD_FULL`) and the UI speaks of « ton/ta partenaire ». One mortgage per
household (unique index) because every screen and MCP answer talks about « l'hypothèque ».

## D12 — `documents` instead of `property_documents`
One table serves property documents, appliance manuals/invoices and note attachments
(`note_id`, `appliance_id`). Each row is either a Storage path or an external URL (Google Drive links
are first-class and detected for display). Privacy of note attachments follows the note (RLS).

## D13 — Lazy materialization of recurring expenses
No cron is needed for recurring expenses: `recurring.materialize` runs when the app opens and creates
due occurrences. A unique `(recurring_rule_id, recurring_occurrence)` index plus a deterministic
idempotency key (`recurring:<rule>:<date>`) make concurrent runs by both partners harmless (tested).
Rules never back-fill the past when created or edited.

## D14 — Fixed vs variable projection
Linear end-of-month projection is right for groceries, absurd for the mortgage (one payment on the
30th). Fixed categories project to `max(spent, budget)`; variable ones extrapolate linearly from the
days elapsed (household timezone).

## D15 — Tasks stay under « Plus »
The bottom bar keeps Accueil · Dépenses · + · Listes · Plus. Tasks due this week are on the dashboard
(block 3), which covers the daily need; promoting Tâches would push Listes, which is used in-store with
one hand. Revisit with real usage data.

## D16 — Mortgage prepayment goal target
For a `mortgage_prepayment` goal the target defaults to the current privilege year's **full**
allowance and "saved" is the prepayments made in that year, so "remaining" equals the privilege still
available (using the remaining privilege as the target would subtract prepayments twice).
