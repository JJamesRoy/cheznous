# Chez Nous — MCP server

A remote MCP server so the couple can use Chez Nous from Claude (or any MCP client).
It is not a stub: every tool calls the same `src/server` use cases as the app, with the
caller's own Supabase identity, so RLS, privacy and validation are identical.

| | |
|---|---|
| Endpoint | `POST {APP_URL}/api/mcp` |
| Transport | Streamable HTTP, **stateless**, JSON responses (`enableJsonResponse`) — official TypeScript SDK `@modelcontextprotocol/sdk` 1.32.2 (`WebStandardStreamableHTTPServerTransport`) |
| Protocol version | `2025-11-25` (SDK `LATEST_PROTOCOL_VERSION`); earlier versions negotiated by the SDK |
| Authorization spec | MCP Authorization, revision 2025-11-25 (OAuth 2.1, RFC 9728, RFC 8414 / OIDC discovery, PKCE S256, dynamic client registration) |
| Authorization server | Supabase Auth OAuth 2.1 server (GoTrue v2.197 locally) — see `docs/DECISIONS.md` D5 |
| Resource metadata | `GET {APP_URL}/.well-known/oauth-protected-resource/api/mcp` (also served at `/.well-known/oauth-protected-resource`) |
| Rate limit | 60 calls / minute / user (`MCP_RATE_LIMIT_PER_MINUTE`), counted in Postgres |
| Audit | every call → `mcp_tool_calls` (tool, argument summary without free text, status, latency, OAuth client id) |

## Auth flow

```
MCP client                         Chez Nous (/api/mcp)                  Supabase Auth (/auth/v1)
    │  POST /api/mcp (no token)          │                                         │
    │ ─────────────────────────────────► │ 401 WWW-Authenticate: Bearer            │
    │ ◄───────────────────────────────── │   resource_metadata=".../.well-known/…"  │
    │  GET /.well-known/oauth-protected-resource/api/mcp                           │
    │ ◄── { resource, authorization_servers: ["{SUPABASE_URL}/auth/v1"] }          │
    │  GET {SUPABASE_URL}/auth/v1/.well-known/openid-configuration ──────────────► │
    │  POST /auth/v1/oauth/clients/register (dynamic client registration) ───────► │
    │  browser → /auth/v1/oauth/authorize?…&code_challenge=…(S256) ──────────────► │
    │                     302 → {APP_URL}/oauth/consent?authorization_id=…  ◄────── │
    │        (sign in if needed, then « Autoriser » / « Refuser »)                  │
    │  ◄── redirect_uri?code=…&state=…                                              │
    │  POST /auth/v1/oauth/token (code + code_verifier) ─────────────────────────► │
    │  ◄── access_token (ES256 JWT, sub = user, client_id = client), refresh_token  │
    │  POST /api/mcp  Authorization: Bearer …                                       │
    │ ─────────────────────────────────► verify (JWKS, iss, exp, client_id)         │
    │                                    → Supabase client with that token (RLS)    │
```

Notes:
- Supabase serves authorization-server metadata at the *path-appended* locations
  (`/auth/v1/.well-known/openid-configuration` and `/auth/v1/.well-known/oauth-authorization-server`).
  MCP clients following the 2025-11-25 discovery order try the RFC 8414 path-inserted URL first
  and fall back to these; both locations were verified locally.
- Tokens must carry a `client_id` claim, i.e. come from the OAuth flow. A plain app session token is
  refused unless `MCP_ALLOW_SESSION_TOKENS=true` (dev only).
- **Known limitation:** Supabase does not (in the pinned version) bind tokens to an RFC 8707 `resource`
  audience (`aud` is `authenticated`). Any OAuth client the user approved could therefore call this
  resource with its token. Mitigation: consent is explicit per client on our consent screen, tokens are
  short-lived (1 h), and every call is audited with the client id.
- The signing key must be asymmetric (ES256/RS256). Hosted projects: enable JWT signing keys in the
  dashboard. Locally: `supabase/signing_keys.json` (git-ignored), see `docs/DEPLOY.md`.

## Adding it to an MCP client

### Claude (custom connector)
Settings → Connectors → *Add custom connector* → URL `https://<your-domain>/api/mcp`. Claude
discovers the authorization server, registers itself, and opens the Chez Nous consent page.
**Status: untested** — this environment has no public URL reachable by Claude; the flow it relies on
(discovery → DCR → PKCE → token → tool calls) is covered end to end by `tests/integration/mcp.test.ts`
with the official SDK client.

### MCP Inspector
```bash
npx @modelcontextprotocol/inspector
```
Transport *Streamable HTTP*, URL `http://localhost:3000/api/mcp`, then *Open Auth Settings* → *Quick
OAuth Flow*. Set `MCP_ALLOWED_ORIGINS=http://localhost:6274` only if you enable the Origin allowlist.
**Status: untested** in this environment (no interactive browser session); same flow as the integration test.

### Claude Code
```bash
claude mcp add --transport http chez-nous http://localhost:3000/api/mcp
```
**Status: untested.**

## Conventions

- Call `get_household_context` first: it says who « moi » is, lists members, categories, lists, projects.
- Amounts in: decimal string in dollars (`"85"`, `"85,50"`, `"1 234,56"`) **or** `{"cents": 8550}`.
  A bare 3-digit-group like `"1,234"` is rejected as ambiguous rather than guessed.
- Amounts out: always both `…Cents` (integer) and a formatted fr-CA string (`"85,00 $"`).
- People: `"moi"`/`"me"` → the authenticated user; the partner by first name; `"commun"` → joint account.
- Categories and lists: matched case- and accent-insensitively (`"epicerie"` → *Épicerie*,
  `"meubles"` → *Meubles du condo*). Ambiguous or unknown → error listing the valid options.
- Writes accept `idempotency_key`. Same key + same arguments → the original result with
  `"replayed": true`; same key + different arguments → `IDEMPOTENCY_CONFLICT`.
- `create_settlement` requires `confirm: true`; without it the tool returns a preview and writes nothing.
- No delete tools in v1.
- Errors: `isError: true` with `{ "error": { "code", "message", "details" } }`; messages are in Québec French.

## Tools

| Tool | Kind | Example |
|---|---|---|
| `get_household_context` | read | Always first |
| `get_household_dashboard` | read | « Comment ça va ce mois-ci ? » |
| `list_expenses` | read | `{ "category": "resto", "from": "2026-11-01" }` |
| `get_expense` | read | `{ "expense_id": "…" }` |
| `create_expense` | write, idempotent | « Ajoute une dépense de 85 $ chez Costco, payée par moi, divisée 50/50 » → `{ "amount": "85", "description": "Costco", "payer": "moi", "split": { "mode": "percentage", "percentages": { "moi": 50, "Alex": 50 } }, "idempotency_key": "…" }` |
| `update_expense` | write | `{ "expense_id": "…", "category": "Épicerie" }` |
| `get_balances` | read | « Qui doit combien à qui ? » |
| `create_settlement` | write, needs `confirm` | `{ "confirm": true, "idempotency_key": "…" }` |
| `get_budget` | read | `{ "month": "2026-11" }` |
| `set_budget` | write | `{ "category": "épicerie", "amount": "400", "from_month": "2026-12" }` |
| `list_budgets` | read | `{ "months": 6 }` |
| `get_spending_summary` | read | « Combien avons-nous dépensé en épicerie ce mois-ci ? » → `{ "category": "épicerie" }`; « Compare octobre et novembre » → `{ "month": "2026-11", "compare_month": "2026-10" }` |
| `list_recurring_expenses` | read | |
| `list_upcoming_bills` | read | `{ "days": 30 }` |
| `list_shopping_lists` | read | |
| `get_shopping_list` | read | « Qu'est-ce qu'on doit acheter pour le salon ? » → `{ "list": "meubles" }` |
| `add_shopping_item` | write, idempotent | « Ajoute des rideaux à 150 $ dans la liste Meubles » → `{ "list": "Meubles", "name": "Rideaux", "unit_price": "150" }` |
| `update_shopping_item` | write | |
| `mark_item_purchased` | write, idempotent | creates the linked expense by default |
| `list_tasks` | read | « Quelles sont nos tâches cette semaine ? » → `{ "scope": "week" }` |
| `create_task` / `update_task` / `complete_task` | write | |
| `search_notes` / `get_note` / `create_note` | read / write | |
| `get_property_info` | read | |
| `list_property_documents` | read | uploaded files and Google Drive links |
| `list_maintenance_tasks` | read | |
| `get_key_dates` | read | renewal, insurance, taxes, AGM, warranties |
| `get_mortgage_summary` | read | « C'est quand le renouvellement de l'hypothèque ? » |
| `list_goals` / `get_goal_progress` | read | |

## Testing

```bash
pnpm supabase start          # local stack with the OAuth server enabled
pnpm test:integration        # includes tests/integration/mcp.test.ts
```
`mcp.test.ts` performs the real flow (DCR → authorize → consent → PKCE token exchange) against the
local Supabase Auth server, then drives `/api/mcp` with the SDK's `Client` +
`StreamableHTTPClientTransport`, covering the eight reference questions from the brief, idempotent
retries, settlement preview/confirm, 401 challenges, and the audit log.
