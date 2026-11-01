# Chez Nous — Architecture

## 1. Layers

```
src/
  domain/      Pure TypeScript. Money, splits, balances, budgets, pay periods,
               recurrence, amortization, dates (America/Toronto), text matching,
               shopping-line parser. Zero framework imports. 100% unit-tested.
  server/      Use cases. One function per operation: Zod schema in, typed
               Result out. Receives a Ctx (user-scoped Supabase client + user id
               + household id). Performs authorization, calls domain, persists.
    ops.ts     Registry of every operation: { name, kind: read|write, input, run }.
  mcp/         MCP server: tool definitions that map 1:1 onto server/ ops.
               No business logic, only argument translation and formatting.
  app/         Next.js App Router. Pages (client components with TanStack Query),
               route handlers: /api/ops/[op] (app RPC), /api/mcp (MCP),
               /.well-known/oauth-protected-resource, /oauth/consent.
  components/  UI primitives (ui/) and feature components.
  lib/         Browser/server Supabase clients, query client, offline queue, formatting hooks.
supabase/
  migrations/  SQL schema, RLS policies, RPC functions, triggers, storage policies.
tests/
  unit/        Vitest + fast-check (domain).
  integration/ Vitest against a real local Supabase (RLS, use cases, MCP over HTTP + OAuth).
e2e/           Playwright, two browser contexts.
```

The app and the MCP server call the **same** functions in `server/`. The
`/api/ops/[op]` handler and the MCP handler are both thin adapters over
`server/ops.ts`.

```
 Browser (TanStack Query) ──POST /api/ops/expenses.create──┐
                                                            ├──► server/ops ──► domain ──► Supabase (RLS)
 Claude (MCP client) ──POST /api/mcp tools/call create_expense┘
                                                                    │
 Browser ◄── Supabase Realtime (postgres_changes, RLS-filtered) ◄───┘
```

## 2. Request context and authorization

Every operation runs with a `Ctx`:

```ts
type Ctx = {
  db: SupabaseClient       // created with the *caller's* access token — RLS applies
  userId: string           // auth.uid()
  householdId: string      // resolved from household_members for this user
  source: 'app' | 'mcp'
  clientId?: string        // OAuth client for MCP calls
}
```

- **App**: the access token comes from the Supabase SSR cookie (refreshed in `src/proxy.ts`).
- **MCP**: the Bearer token is an OAuth access token issued by Supabase Auth's OAuth
  2.1 server; it is verified (signature via JWKS, issuer, expiry) and then used as
  the Authorization header of a Supabase client, so the database sees the same
  `auth.uid()` and the same RLS as in the app.
- **No service-role key in any request path.** Operations that must cross the
  membership boundary (creating a household, accepting an invitation) are
  `SECURITY DEFINER` SQL functions that validate `auth.uid()` themselves.
- Defense in depth: each use case verifies that referenced ids (category, member,
  list, project…) belong to `ctx.householdId` before writing, even though RLS would
  also reject them.

## 3. Domain model

```
profiles(id = auth.users.id, display_name, avatar_path)
households(id, name, timezone, week_start, default_split_mode, created_by)
household_members(household_id, user_id, role, income_weight_bp, joined_at)  -- income_weight_bp: the ratio (e.g. 5500 / 4500), never salaries
household_invitations(id, household_id, token_hash, expires_at, accepted_at, accepted_by)
accounts(id, household_id, name, kind='joint', target_ratio via members)
budget_categories(id, household_id, name, slug, kind fixed|variable, sort)
expenses(id, household_id, amount_cents, description, merchant, spent_on date,
         category_id, paid_by_user | paid_by_account, split_mode, is_private,
         notes, receipt_path, project_id, recurring_rule_id, created_by)
expense_splits(expense_id, user_id, share_cents)         -- Σ share_cents = amount_cents (constraint trigger)
refunds(id, household_id, expense_id, amount_cents, received_by_user | received_by_account, refunded_on)
settlements(id, household_id, from_user, to_user, amount_cents, settled_on)
contributions(id, household_id, account_id, user_id, amount_cents, contributed_on)
budgets(id, household_id, category_id, month date (1st), amount_cents)
recurring_rules(id, household_id, target 'expense'|'bill'|'task', frequency, interval,
                anchor_date, installment_dates date[], template jsonb, next_due_on)
shopping_lists, shopping_items(… quantity, est_price_cents, url, image_url, priority,
                assignee, purchased_at, purchased_by, expense_id)
tasks, task_checklist_items, task_completions
notes(… body_md, is_private, pinned, tags[], search tsvector('french'))
properties, mortgages, mortgage_prepayments, mortgage_balance_statements,
property_documents (storage_path | external_url), appliances, maintenance_records,
capital_contributions, key dates (computed view over the above),
projects, savings_goals, goal_contributions
audit_logs(table_name, row_id, action, before jsonb, after jsonb, actor, at)  -- triggers
mcp_tool_calls(user_id, client_id, tool, args_summary, status, latency_ms, at)
idempotency_keys(user_id, key, operation, request_hash, response jsonb, created_at)
push_subscriptions(user_id, endpoint, keys)
```

Every household-owned table has `household_id` (FK, `on delete cascade`) and an
index on `(household_id, <date column>)` for its main access path.

## 4. Money rules

- Integer **cents** everywhere: `bigint` in Postgres, safe integers in TypeScript
  (`Number.isSafeInteger` asserted at the boundary; ±90 trillion dollars of headroom).
  Internal multiplication uses `BigInt` so `amount × weight` never loses precision.
- Inputs from people and MCP are decimal strings (`"85"`, `"85,00"`, `"1 234,56"`, `"85.5"`)
  parsed by `parseMoney` into cents, never via floating point.
- **Splits always sum exactly to the total.** Every mode reduces to *weights*:

  | Mode | Weights |
  |---|---|
  | `equal` | 1 per participant |
  | `percentage` | basis points per participant, must total 10 000 |
  | `income` | household `income_weight_bp` per member (e.g. 5 500 / 4 500) |
  | `exact` | no weights — shares given in cents, must total the amount exactly |

- **Largest-remainder allocation** (`allocate(total, weights)`):
  1. `raw_i = total × w_i / Σw` computed with BigInt; `floor_i = ⌊raw_i⌋`, `rem_i = (total × w_i) mod Σw`.
  2. `r = total − Σ floor_i` cents remain (0 ≤ r < n).
  3. Give one cent to each of the `r` participants with the largest `rem_i`.
  4. **Ties** are broken by the canonical member order: `household_members.joined_at`
     ascending, then `user_id` ascending (lexicographic). The household creator is
     therefore first. This order is fixed and stored, so a recomputation always
     produces the same cents.
- **Balances** (`computeBalances`): for each member, `net = paid − owed`.
  - Shared expense paid by member P: `net[P] += amount`; each split `net[u] −= share`.
  - Expense paid by the **joint account**: no effect on balances (nobody fronted money).
  - **Refund** of an expense, received by member R: `net[R] −= refund`, and the refund is
    allocated over the original expense's split shares (largest remainder, same tie order):
    `net[u] += refundShare_u`. Received by the joint account: no effect.
  - **Settlement** from A to B: `net[A] += amount`, `net[B] −= amount`.
  - **Private** expenses never enter balances or shared budgets.
  - Invariant (property-tested): `Σ net = 0` always.
  - Pairwise: in a two-member household, `B owes A = net[A]` when `net[A] > 0`.
- Refunds, settlements and expenses are three tables, three use cases, three
  code paths. A refund reduces category spending; a settlement never touches budgets.

## 5. Time

- Household timezone: `America/Toronto` (Montréal). Stored per household, default set at creation.
- Expense dates are **civil dates** (`date` column, `YYYY-MM-DD`), entered in local time.
  "Today" is computed server-side with `Intl.DateTimeFormat(…, { timeZone })`, never `new Date().toISOString()`.
- Month boundaries: `[YYYY-MM-01, next month's 01)` on civil dates in the household zone.
- Pay periods: each member has an `pay_anchor_date` and a biweekly cadence. A month
  contains 2 or 3 paydays; `payPeriodsInMonth` returns them explicitly and the budget
  view flags three-payday months.

## 6. Recurrence

Frequencies: `weekly`, `biweekly`, `monthly`, `bimonthly` (every 2 months — Hydro-Québec),
`quarterly`, `semiannual`, `yearly`, `installments` (explicit dates, e.g. municipal tax).
Month-based steps clamp to the last day of month (Jan 31 → Feb 28 → Mar 31, anchored on the
original day, not drifting). `occurrencesBetween(rule, from, to)` is pure.

## 7. Mortgage

Canadian fixed-rate mortgages compound **semi-annually** (Interest Act). The
periodic rate for `n` payments a year is `(1 + r/2)^(2/n) − 1`. Variable-rate
mortgages are modeled with monthly compounding (lender-specific; documented as an
approximation). The schedule starts from the most recent **lender statement
balance** if one exists; principal is never invented — without a principal the
schedule is not shown. Prepayment privilege: `privilege_bp × original_principal`
per anniversary year; `remainingPrivilege` subtracts prepayments made since the
last anniversary.

## 8. Private vs shared

`is_private = true` on an expense or a note means:
- RLS `select/update/delete` only for `created_by = auth.uid()` (policy, not UI).
- Private expenses carry no splits and are excluded from balances and shared budgets
  (the use cases and the `shared_expenses` filter both enforce it).

## 9. Realtime

Tables in the `supabase_realtime` publication: expenses, expense_splits, settlements,
refunds, shopping_items, shopping_lists, tasks, task_checklist_items, notes, budgets.
The client subscribes once per household (`household_id=eq.<id>`) and invalidates the
matching TanStack Query keys. Realtime applies RLS to `postgres_changes`, so a partner
never receives the other's private rows.

## 10. Idempotency

Write operations accept an `idempotency_key`. The use case calls
`idempotent(ctx, key, op, input, fn)`:
1. Look up `(user_id, key)`. If found with the same `request_hash`, return the stored response.
   If found with a different hash → `IDEMPOTENCY_CONFLICT`.
2. Otherwise run `fn` and insert the row; the unique index `(user_id, key)` makes a concurrent
   duplicate fail, in which case the stored response is re-read and returned.
Atomic creates (expense + splits) are a single SQL function (`create_expense_tx`) that also
claims the idempotency key in the same transaction, so a retry can never produce a second
expense even under concurrency.

## 11. MCP

See `docs/MCP.md`. Transport: Streamable HTTP (stateless, JSON responses) at `/api/mcp`.
Authorization: OAuth 2.1 by Supabase Auth's OAuth server (DCR + PKCE), Protected Resource
Metadata at `/.well-known/oauth-protected-resource`. Each call: verify token → build Ctx →
rate-limit (Postgres window over `mcp_tool_calls`) → run op → log the call.

## 12. Offline & PWA

- Service worker (`public/sw.js`, hand-written): precaches the app shell, network-first for
  navigations with offline fallback, never caches `/api/*` responses (data is user-specific).
- Last-viewed read data: TanStack Query cache persisted to `localStorage` for the dashboard,
  lists and balances keys only.
- Offline writes: `expenses.create`, `shopping.addItem`, `shopping.toggleItem` are queued in
  IndexedDB with their idempotency key and replayed on `online`. Queued items show
  « en attente de synchronisation ».
