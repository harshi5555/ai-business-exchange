#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Single-host Fly.io setup — provisions one app + Postgres. Run ONCE.
#
# Usage:
#   bash infra/fly/setup-single.sh                  # uses .env.fly
#   bash infra/fly/setup-single.sh path/to/.env.fly  # explicit env file
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${1:-$REPO_ROOT/infra/.env.fly.single}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  $ENV_FILE not found."
  echo "    Copy infra/.env.fly.single.example → infra/.env.fly.single and fill in the values, then re-run."
  echo ""
  echo "    Minimum required fields:"
  echo "      FLY_API_TOKEN=<your token>   # flyctl auth token"
  echo "      APP_NAME=bx-app              # globally unique Fly.io app name"
  echo "      JWT_SECRET=<random string>   # openssl rand -hex 32"
  echo "      WEBHOOK_SECRET=<random>      # openssl rand -hex 32"
  echo "      ENCRYPTION_KEY=<random>      # openssl rand -hex 32"
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

# ── Config ────────────────────────────────────────────────────────────────────
ORG="${FLY_ORG:-personal}"
REGION="${FLY_REGION:-lhr}"
APP_NAME="${APP_NAME:-bx-app}"
PG_NAME="${PG_NAME:-${APP_NAME}-db}"

: "${FLY_API_TOKEN:?FLY_API_TOKEN is required in $ENV_FILE}"
: "${JWT_SECRET:?JWT_SECRET is required in $ENV_FILE}"
: "${WEBHOOK_SECRET:?WEBHOOK_SECRET is required in $ENV_FILE}"
: "${ENCRYPTION_KEY:?ENCRYPTION_KEY is required in $ENV_FILE}"
export FLY_API_TOKEN

app_exists() { flyctl status --app "$1" &>/dev/null; }

is_valid_db_url() {
  [[ "${1:-}" =~ ^postgres(ql)?://[^:@]+:.+@.+/.+ ]]
}

echo "═══════════════════════════════════════════════════════════════"
echo "  Business Exchange — Single-host Fly.io Setup"
echo "  App: $APP_NAME   Region: $REGION   Org: $ORG"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Update fly-single.toml app name ──────────────────────────────────────────
if [[ "$APP_NAME" != "bx-app" ]]; then
  echo "▶ Updating fly-single.toml app name to '$APP_NAME' ..."
  sed -i.bak "s/^app = .*/app = \"$APP_NAME\"/" "$REPO_ROOT/infra/fly/single/fly-single.toml"
  rm -f "$REPO_ROOT/infra/fly/single/fly-single.toml.bak"
  echo "  ✓ fly-single.toml updated"
fi

# ── Create the Fly app ────────────────────────────────────────────────────────
echo "▶ Creating Fly app '$APP_NAME' ..."
if app_exists "$APP_NAME"; then
  echo "  ✓ '$APP_NAME' already exists — skipping"
else
  flyctl apps create "$APP_NAME" --org "$ORG"
  echo "  ✓ Created '$APP_NAME'"
fi

# ── Provision Postgres ────────────────────────────────────────────────────────
echo ""
echo "▶ Provisioning Fly Postgres '$PG_NAME' ..."
if app_exists "$PG_NAME"; then
  echo "  ✓ '$PG_NAME' already exists — skipping"
else
  flyctl postgres create \
    --name "$PG_NAME" \
    --org "$ORG" \
    --region "$REGION" \
    --vm-size shared-cpu-1x \
    --volume-size 10 \
    --initial-cluster-size 1
  echo "  ✓ Postgres cluster '$PG_NAME' created"
fi

# ── Get DATABASE_URL ─────────────────────────────────────────────────────────
echo ""
if ! is_valid_db_url "${DATABASE_URL:-}"; then
  echo "▶ Attaching Postgres to app (provisioning DATABASE_URL) ..."
  ATTACH_OUT=$(flyctl postgres attach "$PG_NAME" \
    --app "$APP_NAME" \
    --database-name bxdb \
    --database-user bxapp 2>&1 || true)

  DATABASE_URL=$(echo "$ATTACH_OUT" | grep -oE 'postgres(ql)?://[^ ]+' | head -1 || true)

  if ! is_valid_db_url "${DATABASE_URL:-}"; then
    echo "❌  Could not auto-provision DATABASE_URL."
    echo "    Run:  flyctl postgres attach $PG_NAME --app $APP_NAME"
    echo "    Copy the DATABASE_URL into $ENV_FILE, then re-run."
    exit 1
  fi

  # Save back to .env.fly
  if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    echo "DATABASE_URL=$DATABASE_URL" >> "$ENV_FILE"
  fi
  echo "  ✓ DATABASE_URL provisioned and saved to $ENV_FILE"
else
  echo "▶ Using DATABASE_URL from $ENV_FILE"
fi

# ── Set all secrets on the single app ────────────────────────────────────────
echo ""
echo "▶ Setting secrets on '$APP_NAME' ..."
flyctl secrets set -a "$APP_NAME" \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  NODE_ENV="production"
echo "  ✓ Secrets set"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Setup complete!"
echo ""
echo "Next — deploy the application:"
echo "  bash infra/fly/deploy-single.sh"
echo ""
echo "  Public URL after deploy:"
echo "    Portal + API: https://${APP_NAME}.fly.dev"
echo "═══════════════════════════════════════════════════════════════"
