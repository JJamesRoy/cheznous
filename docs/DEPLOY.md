# Deploying Chez Nous

Target: **Vercel** (Next.js) + **Supabase** (Postgres, Auth with OAuth 2.1 server, Realtime, Storage).
Nothing below has been performed from this repository's build environment — these are the steps.

## 1. Supabase project

1. Create a project (region close to Montréal, e.g. `ca-central-1`).
2. **Auth → URL configuration**
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/**`
3. **Auth → Providers → Email**: enable email + password and magic links. Configure SMTP (Supabase's
   default mailer is rate-limited) — the app sends magic links in French via your templates.
4. **Auth → JWT signing keys**: rotate to an **asymmetric** key (ES256 recommended). The MCP endpoint
   verifies OAuth access tokens against `/auth/v1/.well-known/jwks.json`; HS256 tokens are rejected.
5. **Auth → OAuth Server**: enable it, set *Authorization path* to `/oauth/consent`, enable
   **dynamic client registration** (MCP clients such as Claude register themselves).
6. Apply migrations:
   ```bash
   pnpm supabase link --project-ref <ref>
   pnpm supabase db push
   ```
   This creates every table, RLS policy, RPC, trigger, the `household-files` private bucket and its
   storage policies, and the Realtime publication.
7. Do **not** run `pnpm seed:demo` against it (the script refuses non-local URLs anyway).

## 2. Vercel

1. Import the repository. Framework preset: Next.js. Install command `pnpm install`, build `pnpm build`.
2. Environment variables (see `.env.example`):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key |
   | `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` (used for invitation links and the MCP resource URL) |
   | `MCP_RATE_LIMIT_PER_MINUTE` | `60` |
   | `MCP_ALLOW_SESSION_TOKENS` | `false` |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional, for Web Push (`pnpm exec web-push generate-vapid-keys`) |

   No service-role / secret key is needed by the app at runtime. Don't add one.
3. Deploy. Check:
   - `https://<your-domain>/.well-known/oauth-protected-resource/api/mcp` returns JSON whose
     `authorization_servers` is `https://<ref>.supabase.co/auth/v1`.
   - `curl -i -X POST https://<your-domain>/api/mcp` returns `401` with a `WWW-Authenticate` header.

## 3. Connect Claude

Settings → Connectors → Add custom connector → `https://<your-domain>/api/mcp`. Approve on the Chez Nous
consent screen. See `docs/MCP.md`.

## 4. Local development

```bash
pnpm install
pnpm supabase start                 # Docker required
pnpm supabase gen signing-key --algorithm ES256 > /dev/null   # first time: creates supabase/signing_keys.json (git-ignored)
pnpm supabase db reset              # applies migrations
cp .env.example .env.local          # fill with the values printed by `supabase start`
pnpm dev                            # or `pnpm dev:local` if your shell exports other Supabase variables
pnpm seed:demo                      # optional demo household (local only)
```

`signing_keys.json`: if the `gen signing-key` command complains that the file doesn't exist, create it
with `echo "[]" > supabase/signing_keys.json` and run it again with `--append`.
