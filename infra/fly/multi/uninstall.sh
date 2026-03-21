#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fly.io uninstall script — destroys all platform apps and the Postgres cluster.
# Usage: bash infra/fly/uninstall.sh [path/to/.env.fly]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${1:-$REPO_ROOT/.env.fly}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  $ENV_FILE not found."
  echo "    Copy .env.fly.example → .env.fly and fill in FLY_API_TOKEN, then re-run."
  exit 1
fi

# Load vars
_TMP_ENV=$(mktemp)
grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' > "$_TMP_ENV"
set -o allexport
# shellcheck disable=SC1090
source "$_TMP_ENV"
set +o allexport
rm -f "$_TMP_ENV"

: "${FLY_API_TOKEN:?FLY_API_TOKEN is required in $ENV_FILE}"
export FLY_API_TOKEN

APPS=(
  bx-gateway
  bx-auth-service
  bx-partner-service
  bx-subscription-service
  bx-integration-service
  bx-mapping-engine
  bx-agent-orchestrator
  bx-billing-service
  bx-partner-portal
)

app_exists() {
  flyctl apps list 2>/dev/null | awk '{print $1}' | grep -qx "$1"
}

echo ""
echo "⚠️  This will permanently destroy all business-exchange apps on Fly.io."
echo "    Apps to be deleted:"
for app in "${APPS[@]}" bx-postgres; do
  echo "      • $app"
done
echo ""
read -rp "    Type 'yes' to confirm: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "🗑️  Destroying apps..."
for app in "${APPS[@]}"; do
  if app_exists "$app"; then
    echo "  Deleting $app..."
    flyctl apps destroy "$app" --yes
    echo "  ✓ $app destroyed"
  else
    echo "  ⚪ $app not found, skipping"
  fi
done

# Destroy Postgres last (detach happens automatically when apps are gone)
if app_exists "bx-postgres"; then
  echo "  Deleting bx-postgres..."
  flyctl apps destroy "bx-postgres" --yes
  echo "  ✓ bx-postgres destroyed"
else
  echo "  ⚪ bx-postgres not found, skipping"
fi

echo ""
echo "✅  All apps destroyed."
echo "    Run ./infra/fly/setup.sh to re-provision from scratch."
