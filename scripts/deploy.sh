#!/usr/bin/env bash
# Chez Nous — full deployment: Supabase (schema, auth config) + Vercel (env + production deploy).
#
# Prerequisites (environment variables, never committed):
#   SUPABASE_ACCESS_TOKEN   personal access token (supabase.com/dashboard/account/tokens)
#   SUPABASE_DB_PASSWORD    database password chosen for the project
#   SUPABASE_PROJECT_REF    existing project ref (or leave empty and set SUPABASE_ORG_ID to create one)
#   SUPABASE_ORG_ID         only to create a new project (region ca-central-1)
#   VERCEL_TOKEN            vercel.com/account/tokens
#   VERCEL_SCOPE            optional: team slug
#   APP_URL                 optional: final public URL (default: the Vercel production URL)
#
# Usage: bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

need() { [ -n "${!1:-}" ] || { echo "Variable manquante : $1" >&2; exit 1; }; }
need SUPABASE_ACCESS_TOKEN; need SUPABASE_DB_PASSWORD; need VERCEL_TOKEN
SB="$PWD/node_modules/.bin/supabase"   # absolute: also used from a temp dir below
[ -x "$SB" ] || pnpm install --frozen-lockfile
VC="pnpm dlx vercel@65.9.0 --token $VERCEL_TOKEN ${VERCEL_SCOPE:+--scope $VERCEL_SCOPE}"

# ---------------------------------------------------------------- Supabase project
if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  need SUPABASE_ORG_ID
  echo "→ Création du projet Supabase (ca-central-1)…"
  $SB projects create chez-nous --org-id "$SUPABASE_ORG_ID" --db-password "$SUPABASE_DB_PASSWORD" --region ca-central-1 -o json > /tmp/sb-project.json
  SUPABASE_PROJECT_REF=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/sb-project.json")).id)')
  echo "  projet : $SUPABASE_PROJECT_REF (attente de disponibilité)"; sleep 90
fi
SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"

echo "→ Liaison et migrations…"
# config.toml points at a git-ignored local dev key; the CLI refuses to load the config without the file.
[ -f supabase/signing_keys.json ] || echo "[]" > supabase/signing_keys.json
$SB link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
$SB db push --linked --password "$SUPABASE_DB_PASSWORD"

PUBLISHABLE_KEY=$($SB projects api-keys --project-ref "$SUPABASE_PROJECT_REF" -o json | node -e '
  const keys = JSON.parse(require("fs").readFileSync(0));
  const k = keys.find((x) => x.type === "publishable") ?? keys.find((x) => x.name === "anon");
  console.log(k.api_key);')

# ---------------------------------------------------------------- Vercel project + URL
echo "→ Projet Vercel…"
$VC link --yes --project chez-nous >/dev/null
# Vercel assigns a suffixed domain when "chez-nous.vercel.app" is taken: ask the API for the real one.
if [ -z "${APP_URL:-}" ]; then
  TEAM_ID=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(".vercel/project.json")).orgId)}catch{}')
  DOMAIN=$(curl -fsS -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v9/projects/chez-nous/domains${TEAM_ID:+?teamId=$TEAM_ID}" | node -e '
    const d = (JSON.parse(require("fs").readFileSync(0)).domains ?? []).filter((x) => x.verified && !x.redirect);
    console.log((d.find((x) => !x.name.endsWith(".vercel.app")) ?? d[0])?.name ?? "");')
  [ -n "$DOMAIN" ] || { echo "Impossible de déterminer le domaine Vercel : définis APP_URL." >&2; exit 1; }
  APP_URL="https://$DOMAIN"
fi
echo "  URL : $APP_URL"

# ---------------------------------------------------------------- Auth config (OAuth server, redirects)
echo "→ Configuration Auth (site URL, OAuth 2.1 + inscription dynamique)…"
TMP_CFG=$(mktemp -d); cp -r supabase "$TMP_CFG/"
sed -i "s|^signing_keys_path = .*|# signing_keys_path: local dev key, never pushed|; s#^site_url = .*#site_url = \"$APP_URL\"#; s#^additional_redirect_urls = .*#additional_redirect_urls = [\"$APP_URL/**\"]#" "$TMP_CFG/supabase/config.toml"
# Production is invite-only: accounts are created by an admin, never through public sign-up.
sed -i '/^\[auth\]$/,/^\[/ s/^enable_signup = .*/enable_signup = false/' "$TMP_CFG/supabase/config.toml"
(cd "$TMP_CFG" && $SB config push --project-ref "$SUPABASE_PROJECT_REF" --yes) || {
  echo "  ⚠ config push a échoué : active à la main Auth → OAuth Server (chemin /oauth/consent, inscription dynamique) et les clés JWT asymétriques (ES256)."; }
rm -rf "$TMP_CFG"
echo "  ⚠ Vérifie dans le tableau de bord : Auth → JWT Keys → clé ES256 active (requis par /api/mcp)."

# ---------------------------------------------------------------- Vercel env + deploy
echo "→ Variables d'environnement Vercel…"
setenv() { printf '%s' "$2" | $VC env rm "$1" production --yes >/dev/null 2>&1 || true; printf '%s' "$2" | $VC env add "$1" production >/dev/null; echo "  $1"; }
setenv NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_URL"
setenv NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$PUBLISHABLE_KEY"
setenv NEXT_PUBLIC_APP_URL "$APP_URL"
setenv MCP_RATE_LIMIT_PER_MINUTE "60"
setenv MCP_ALLOW_SESSION_TOKENS "false"
[ -n "${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}" ] && setenv NEXT_PUBLIC_VAPID_PUBLIC_KEY "$NEXT_PUBLIC_VAPID_PUBLIC_KEY"
[ -n "${VAPID_PRIVATE_KEY:-}" ] && setenv VAPID_PRIVATE_KEY "$VAPID_PRIVATE_KEY"
[ -n "${VAPID_SUBJECT:-}" ] && setenv VAPID_SUBJECT "$VAPID_SUBJECT"

echo "→ Déploiement production…"
$VC deploy --prod --yes

echo "→ Vérifications…"
curl -fsS "$APP_URL/.well-known/oauth-protected-resource/api/mcp" | head -c 400; echo
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$APP_URL/api/mcp"); echo "  POST /api/mcp sans jeton → $code (attendu : 401)"
echo "✓ Terminé. Connecteur Claude : $APP_URL/api/mcp"
