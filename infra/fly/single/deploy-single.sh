#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Single-host Fly.io deploy script.
# Builds one Docker image with all services and deploys to one Fly machine.
#
# Usage:
#   bash infra/fly/single/deploy-single.sh                   # uses .env.fly
#   bash infra/fly/single/deploy-single.sh path/to/.env.fly  # explicit env file
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${1:-$REPO_ROOT/infra/.env.fly.single}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  $ENV_FILE not found."
  echo "    Run setup first:  bash infra/fly/single/setup-single.sh"
  exit 1
fi

# Load .env.fly
_TMP_ENV=$(mktemp)
grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' > "$_TMP_ENV"
set -o allexport
# shellcheck disable=SC1090
source "$_TMP_ENV"
set +o allexport
rm -f "$_TMP_ENV"

: "${FLY_API_TOKEN:?FLY_API_TOKEN is required in $ENV_FILE}"
export FLY_API_TOKEN

APP_NAME="${APP_NAME:-bx-app}"
APP_URL="https://${APP_NAME}.fly.dev"

echo "═══════════════════════════════════════════════════════════════"
echo "  Business Exchange — Single-host Deploy"
echo "  App: $APP_NAME   →  $APP_URL"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Sync secrets from .env.fly ────────────────────────────────────────────────
echo "▶ Syncing secrets ..."
SECRETS_ARGS=()
[[ -n "${DATABASE_URL:-}" ]]    && SECRETS_ARGS+=("DATABASE_URL=${DATABASE_URL}")
[[ -n "${JWT_SECRET:-}" ]]      && SECRETS_ARGS+=("JWT_SECRET=${JWT_SECRET}")
[[ -n "${WEBHOOK_SECRET:-}" ]]  && SECRETS_ARGS+=("WEBHOOK_SECRET=${WEBHOOK_SECRET}")
[[ -n "${ENCRYPTION_KEY:-}" ]]  && SECRETS_ARGS+=("ENCRYPTION_KEY=${ENCRYPTION_KEY}")

if [[ ${#SECRETS_ARGS[@]} -gt 0 ]]; then
  flyctl secrets set -a "$APP_NAME" "${SECRETS_ARGS[@]}"
  echo "  ✓ Secrets synced"
else
  echo "  ⚠  No secrets to sync — ensure DATABASE_URL, JWT_SECRET etc. are in $ENV_FILE"
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Building and deploying (this takes a few minutes on first run) ..."
flyctl deploy \
  --app "$APP_NAME" \
  --config infra/fly/single/fly-single.toml \
  --build-arg "NEXT_PUBLIC_API_URL=$APP_URL" \
  --remote-only \
  --wait-timeout 300

echo ""
echo "▶ Smoke test ..."
sleep 5
if curl -fsSL --retry 5 --retry-delay 8 --max-time 30 "$APP_URL/health" > /dev/null 2>&1; then
  echo "  ✓ Gateway health check passed"
else
  echo "  ⚠  Health check did not respond yet — check logs:"
  echo "       flyctl logs -a $APP_NAME"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Deploy complete!"
echo ""
echo "  URL:  $APP_URL"
echo ""
echo "Useful commands:"
echo "  flyctl logs -a $APP_NAME"
echo "  flyctl status -a $APP_NAME"
echo "  flyctl ssh console -a $APP_NAME"
echo "═══════════════════════════════════════════════════════════════"
