# Progress — final report

Legend: ✅ done and verified (the command that verified it is given) · 🟡 implemented, not verified ·
🔧 needs external setup · ⚠️ known limitation.

All verification below ran in the build environment on 2026-11-01 against a **local Supabase stack**
(Supabase CLI 2.122.0, Docker; images pulled from Docker Hub — see `docs/DECISIONS.md` D8) and a
**production build** of the app (`next build` + `next start`). Nothing was deployed to a hosted
Supabase project or to Vercel.

## How to re-run every check

```bash
pnpm supabase start && pnpm supabase db reset && pnpm seed:demo   # local stack + demo data (dev only)
pnpm typecheck                                                    # tsc --noEmit, 0 errors
pnpm lint                                                         # eslint, 0 errors (1 warning in a script was fixed)
pnpm test                                                         # 191 unit tests (domain, property-based)
pnpm test:integration                                             # 65 integration tests against the real DB
node scripts/local-env.mjs next build                             # production build (34 routes)
E2E_PROD=1 pnpm e2e                                               # 7 acceptance specs (flows 1–20) + screenshot suite
```

Last results: typecheck ✅ · lint ✅ · unit 191/191 ✅ · integration 65/65 ✅ · build ✅ ·
E2E 7/7 ✅ · screenshots 2/2 ✅ (179 images, 0 horizontal overflow, 0 console errors).

## What works and was verified

### Domain & money (unit — `pnpm test`)
- ✅ Integer cents, decimal parsing (`"1 234,56"`, ambiguous `"1,234"` rejected), fr-CA formatting.
- ✅ Splits: equal, percentage, exact, income ratio; largest remainder with documented tie order;
  **property tests**: splits always sum to the total, balances always net to zero, settling the
  transfer list zeroes balances.
- ✅ Refunds vs settlements vs joint-account expenses (three code paths, different effects).
- ✅ Budgets (effective budget carried forward, fixed vs variable, early-month projection damping),
  pay periods (biweekly, three-payday months, periods clipped so every day of the month counts).
- ✅ Recurrence: weekly … yearly, **every 2 months** (Hydro-Québec), **N installments**, month-end
  clamping without drift.
- ✅ Canadian mortgage: **semi-annual compounding** for fixed rates (500 000 $ at 5 %, 25 years →
  2 908,02 $/month vs 2 922,95 $ with monthly compounding), schedule, prepayment privilege across
  anniversaries. Toronto month boundaries (`2026-12-01T03:30Z` is still November in Montréal).

### Database, security, use cases (integration — `pnpm test:integration`)
- ✅ **RLS household isolation on all 31 household tables**: a user from household B reads nothing,
  cannot insert, update or delete anything of household A (`tests/integration/rls.test.ts`).
- ✅ **Private rows**: a partner cannot read, update or delete the other's private expenses or notes;
  their audit rows are hidden too. Private expenses never count in balances or shared budgets.
- ✅ Splits sum to the total is a **database constraint** (deferred trigger), not only app logic.
- ✅ Invitations: single-use, expiring, SHA-256 hashed at rest, max two members.
- ✅ Idempotency: same key + same input → one row (`replayed: true`); same key + different input →
  `IDEMPOTENCY_CONFLICT`; expense creation is atomic with its key (SQL transaction).
- ✅ Audit log with before/after on every write (triggers); edits recompute splits.
- ✅ Budget, spending summary and month comparison, shopping (one-line parse, purchase → linked
  expense), tasks (checklist, recurrence, history), French full-text note search, recurring bills,
  lazy materialization of recurring expenses (concurrent opens by both partners → one expense),
  condo (property, mortgage, statements, prepayments, documents incl. Google Drive links, appliances,
  maintenance, capital contributions + CSV), goals and projects, dashboard.

### MCP server (integration + E2E)
- ✅ Remote MCP over **Streamable HTTP** with the official SDK, protocol `2025-11-25`.
- ✅ **OAuth 2.1** via Supabase Auth's OAuth server: Protected Resource Metadata, discovery, **dynamic
  client registration**, authorization code + **PKCE S256**, consent page, token exchange — the full
  flow is executed in `tests/integration/mcp.test.ts` and `e2e/flows/16-mcp.spec.ts`.
- ✅ 401 + `WWW-Authenticate` challenge for missing / forged / non-OAuth tokens.
- ✅ All **32 tools** from the brief, annotated (`readOnlyHint`, `destructiveHint`, `idempotentHint`),
  no delete tools; `create_settlement` previews without `confirm: true`.
- ✅ The eight reference questions answered through the tools (épicerie ce mois-ci, Costco 85 $ 50/50
  with idempotent retry, salon/Meubles, rideaux 150 $, qui doit combien, tâches cette semaine,
  octobre vs novembre, renouvellement de l'hypothèque).
- ✅ Per-user rate limit (Postgres window) and audit of every call (tool, argument summary without free
  text, status, latency, OAuth client id).

### App (E2E — `E2E_PROD=1 pnpm e2e`, two browser contexts)
| # | Flow | Spec |
|---|---|---|
| 1–3 | Sign up, create household, invite partner, partner signs up through the link and joins; reused link refused | `01-onboarding` ✅ |
| 4–5 | Shared expense from quick add; partner sees it without reload | `04-money` ✅ |
| 6 | Balance correct for equal (remainder cent), percentage, exact, income ratio; joint account neutral | `04-money` ✅ |
| 7 | Settlement with slide-to-confirm (keyboard) → « Vous êtes quittes » on both sides | `04-money` ✅ |
| 8–9 | Budget configured; expense updates it | `04-money` ✅ (budget set through the app's RPC from the signed-in page; display verified) |
| 10–12 | Create list; partner adds "2 coussins 24,99" live; purchase creates the linked 49,98 $ expense | `10-lists-tasks` ✅ |
| 13–14 | Create and assign task; partner completes it | `10-lists-tasks` ✅ |
| 15 | Manifest, icons, service worker registered (production build) | `15-pwa` ✅ |
| 16–18 | OAuth MCP client reads household data, creates an expense, it appears live in the partner's app | `16-mcp` ✅ |
| 19 | Offline expense queued (« en attente de synchronisation »), synced exactly once on reconnect | `04-money` ✅ |
| 20 | Duplicate MCP call with the same idempotency key creates nothing new | `16-mcp` ✅ |

### Visual QA (`e2e/screenshots.spec.ts` → `docs/screenshots/`)
- ✅ 179 screenshots: every main screen at **375, 430, 768, 1440 px** in **light and dark**, quick add,
  auth, onboarding, **empty** (fresh household), **loading** (held requests) and **error** (failed
  request) states. `docs/screenshots/qa-report.json`: 0 horizontal overflow, 0 console errors.
- ✅ Touch targets: small controls carry an invisible 44 px hit area (checkboxes, small icon buttons);
  the remaining flagged item is the dashboard task checkbox whose `<label>` row is 52 px tall.
- ✅ Layout shift on load: CLS 0 on the dashboard (measured with a PerformanceObserver).
- ✅ Art direction revision 2 (taste-skill app-screen research): greystone ground, Manrope, ink
  actions, green on data only, per-partner hues, the « trois colonnes » signature — `docs/DESIGN.md`.

## Implemented but not verified
- 🟡 **Magic-link sign-in**: implemented (`signInWithOtp` → `/auth/callback`); not exercised end to end
  (would need reading the local Mailpit inbox).
- 🟡 **Web Push**: subscribe/unsubscribe/test routes and the service-worker handler exist; headless
  Chromium reports notifications as denied, so delivery was never observed. Nothing sends reminders
  automatically yet (see limitations).
- 🟡 **Receipt and document uploads** were verified manually in a browser by the screen work (upload,
  signed URL, delete), not in the automated suite.
- 🟡 **Haptics** (`navigator.vibrate`) — feature-detected, no device to observe them.
- 🟡 **Pull to refresh, swipe actions** — exercised by hand in Playwright mobile emulation during
  development, not asserted in the suite.
- 🟡 **Claude / Claude Code / MCP Inspector as clients**: not tested (no public URL from this
  environment). The same flow they use is covered with the official SDK client. `docs/MCP.md` marks
  each client "untested".

## Needs external setup
- 🔧 **Supabase project**: create it, `supabase db push`, enable **asymmetric JWT signing keys**
  (ES256), enable the **OAuth server** with dynamic registration and authorization path
  `/oauth/consent`, set Site URL / redirect URLs, configure SMTP. → `docs/DEPLOY.md` §1.
- 🔧 **Vercel**: env vars from `.env.example` (no service-role key needed). → `docs/DEPLOY.md` §2.
- 🔧 **Web Push**: generate VAPID keys and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`.
- 🔧 **Claude connector**: add `https://<domain>/api/mcp` as a custom connector. → `docs/MCP.md`.

## Known limitations
- ⚠️ **Performance budget not met.** First-load JavaScript referenced by the dashboard's HTML is
  **364 KB gzip** (target ~180 KB). Measured with `scripts/perf-route-js.mjs` on a production build.
  It was 444 KB; supabase-js/Realtime, the create sheets and the command menu are now loaded after
  first paint. Remaining weight: React DOM ~70 KB, Next runtime ~43 KB, Radix + NumberFlow ~41 KB,
  Motion ~45 KB, app code. Next steps: replace NumberFlow on non-hero amounts, trim Radix usage on the
  dashboard, and audit barrel imports of `@/components/ui`.
- ⚠️ **MCP token audience**: Supabase's OAuth server does not bind tokens to an RFC 8707 resource;
  mitigated by requiring a `client_id` claim, explicit consent, short-lived tokens and auditing (D5).
- ⚠️ **No scheduled push reminders**: in-app reminders (dashboard, overdue banner) only; sending task
  reminders by push needs a cron with a server-side identity, which we chose not to add (no
  service-role key in the app).
- ⚠️ **Offline writes are limited by design** to adding an expense and adding/checking list items.
  Other screens show the last data seen and an honest offline banner.
- ⚠️ Recurring task completions appear in the task's history, not under « Terminées » (the task
  stays open with its next due date).
- ⚠️ Removing a receipt from an expense does not delete the stored file.
- ⚠️ One household per user in the UI (schema supports more); at most two members (D11).
- ⚠️ The deliberate departure from the brief's 48–56 px hero number (now 34/40 px) is explained in D17.

## Phase log
- Phase 0 — scaffold, pinned versions, docs. ✅
- Phase 1 — vertical slice (auth → household → invite → expense → live → balance → MCP create → live). ✅
- Phase 2 — breadth: budget, lists, tasks, notes, condo, goals, PWA/offline, all MCP tools. ✅
- Phase 3 — integration and E2E suites, art direction revision, visual QA, performance pass. ✅ (perf ⚠️)
