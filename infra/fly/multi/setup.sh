#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fly.io one-time setup script — provisions apps, Postgres, and secrets.
# Run this ONCE before your first deploy.
# Usage: bash infra/fly/setup.sh [path/to/.env.fly]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${1:-$REPO_ROOT/infra/.env.fly.multi}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  $ENV_FILE not found."
  echo "    Copy infra/.env.fly.multi.example → infra/.env.fly.multi and fill in the values, then re-run."
  exit 1
fi

# Load vars (skip blank lines and comments)
_TMP_ENV=$(mktemp)
grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' > "$_TMP_ENV"
set -o allexport
# shellcheck disable=SC1090
source "$_TMP_ENV"
set +o allexport
rm -f "$_TMP_ENV"

# ── Defaults ──────────────────────────────────────────────────────────────────
ORG="${FLY_ORG:-personal}"
REGION="${FLY_REGION:-lhr}"

# ── Required vars guard ───────────────────────────────────────────────────────
: "${FLY_API_TOKEN:?FLY_API_TOKEN is required in $ENV_FILE}"
: "${JWT_SECRET:?JWT_SECRET is required in $ENV_FILE}"
: "${WEBHOOK_SECRET:?WEBHOOK_SECRET is required in $ENV_FILE}"
# DATABASE_URL is provisioned automatically via flyctl postgres attach if absent

export FLY_API_TOKEN

ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"

echo "▶ Creating Fly apps..."
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

app_exists() { flyctl status --app "$1" &>/dev/null; }

for app in "${APPS[@]}"; do
  if app_exists "$app"; then
    echo "  ✓ $app already exists — skipping"
  else
    flyctl apps create "$app" --org "$ORG"
    echo "  ✓ created $app"
  fi
done

echo ""
echo "▶ Creating Fly Postgres (if not exists)..."
if app_exists "bx-postgres"; then
  echo "  ✓ bx-postgres already exists"
else
  flyctl postgres create \
    --name bx-postgres \
    --org "$ORG" \
    --region "$REGION" \
    --vm-size shared-cpu-1x \
    --volume-size 10 \
    --initial-cluster-size 1
fi

# ── Auto-provision DATABASE_URL if not set or incomplete (no user@ in URL) ────
is_valid_db_url() {
  # Must contain user@host/dbname — a bare hostname is not valid
  [[ "${1:-}" =~ ^postgres(ql)?://[^:@]+:.+@.+/.+ ]]
}

if ! is_valid_db_url "${DATABASE_URL:-}"; then
  echo ""
  echo "▶ Provisioning shared database credentials via flyctl postgres attach..."
  ATTACH_OUT=$(flyctl postgres attach bx-postgres \
    --app bx-auth-service \
    --database-name bxdb \
    --database-user bxapp 2>&1 || true)

  # flyctl prints: DATABASE_URL=postgres://user:pass@host/db
  DATABASE_URL=$(echo "$ATTACH_OUT" | grep -oE 'postgres(ql)?://[^ ]+' | head -1 || true)

  if ! is_valid_db_url "${DATABASE_URL:-}"; then
    echo ""
    echo "❌  Could not auto-provision DATABASE_URL."
    echo "    Run the following and copy the DATABASE_URL into .env.fly:"
    echo "      flyctl postgres attach bx-postgres --app bx-auth-service"
    echo "    Then re-run this script."
    exit 1
  fi

  # Persist to .env.fly for future runs
  if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
  else
    echo "DATABASE_URL=$DATABASE_URL" >> "$ENV_FILE"
  fi
  echo "  ✓ DATABASE_URL provisioned and saved to $ENV_FILE"
else
  echo ""
  echo "▶ Using DATABASE_URL from $ENV_FILE"
fi

echo ""
echo "▶ Setting secrets for backend services..."

BACKEND_APPS=(
  bx-auth-service
  bx-partner-service
  bx-subscription-service
  bx-integration-service
  bx-billing-service
  bx-agent-orchestrator
)

for app in "${BACKEND_APPS[@]}"; do
  flyctl secrets set -a "$app" \
    DATABASE_URL="$DATABASE_URL" \
    JWT_SECRET="$JWT_SECRET" \
    WEBHOOK_SECRET="${WEBHOOK_SECRET:-}" \
    NODE_ENV="production"
  echo "  ✓ $app secrets set"
done

echo ""
echo "▶ Setting partner-service encryption secret..."
flyctl secrets set -a bx-partner-service \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  WEBHOOK_SECRET="${WEBHOOK_SECRET:-}" \
  NODE_ENV="production" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY"
echo "  ✓ bx-partner-service secrets set"

echo ""
echo "▶ Setting mapping-engine secrets..."
flyctl secrets set -a bx-mapping-engine \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  NODE_ENV="production"

echo ""
echo "▶ Setting gateway secrets..."
flyctl secrets set -a bx-gateway \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  WEBHOOK_SECRET="${WEBHOOK_SECRET:-}" \
  NODE_ENV="production"

echo ""
echo "▶ Running DB migration..."
DB_NAME=$(echo "$DATABASE_URL" | grep -oE '/[^/?]+(\?|$)' | head -1 | tr -d '/?' || echo "postgres")
DB_NAME="${DB_NAME:-postgres}"
{ cat packages/database/migrations/001_schema.sql; printf '\\q\n'; } \
  | flyctl postgres connect --app bx-postgres --database "$DB_NAME" || true
echo "  ✓ Migrations done (database: $DB_NAME)"

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "✅ Setup complete!"
echo ""
echo "Next step — deploy all services:"
echo "  bash infra/fly/deploy.sh"
echo ""
echo "  URLs after deploy:"
echo "     Portal:  https://bx-partner-portal.fly.dev"
echo "     Gateway: https://bx-gateway.fly.dev"
echo "────────────────────────────────────────────────────────────────"
