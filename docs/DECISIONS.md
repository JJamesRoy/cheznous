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
