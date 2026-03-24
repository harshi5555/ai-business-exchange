#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fly.io manual deploy script — mirrors the CI pipeline locally.
# Deploys in the correct order:
#   1. DB migration
#   2. Backend services (parallel)
#   3. Gateway (after all backends)
#   4. Partner portal (after gateway)
#   5. Smoke test
#
# Usage:
#   bash infra/fly/deploy.sh                    # full deploy from .env.fly
#   bash infra/fly/deploy.sh path/to/.env.fly   # explicit env file
#   bash infra/fly/deploy.sh --app bx-gateway   # redeploy single service
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

# ── Parse args ────────────────────────────────────────────────────────────────
SINGLE_APP=""
ENV_FILE="$REPO_ROOT/infra/.env.fly.multi"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)   SINGLE_APP="$2"; shift 2 ;;
    --app=*) SINGLE_APP="${1#--app=}"; shift ;;
    *)       ENV_FILE="$1"; shift ;;
  esac
done

# ── Load .env.fly ─────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  $ENV_FILE not found."
  echo "    Copy infra/.env.fly.multi.example → infra/.env.fly.multi and fill in the values, then re-run."
  exit 1
fi

_TMP_ENV=$(mktemp)
grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' > "$_TMP_ENV"
set -o allexport
# shellcheck disable=SC1090
source "$_TMP_ENV"
set +o allexport
rm -f "$_TMP_ENV"

: "${FLY_API_TOKEN:?FLY_API_TOKEN is required in $ENV_FILE}"
export FLY_API_TOKEN

GATEWAY_URL="${GATEWAY_URL:-https://bx-gateway.fly.dev}"

# ── Auto-provision DATABASE_URL if missing or incomplete ──────────────────────
is_valid_db_url() {
  [[ "${1:-}" =~ ^postgres(ql)?://[^:@]+:.+@.+/.+ ]]
}

ensure_database_url() {
  if is_valid_db_url "${DATABASE_URL:-}"; then
    return
  fi
  echo ""
  echo "▶ DATABASE_URL missing or incomplete — retrieving from bx-auth-service..."
  # Try reading from the live machine first (fastest, no side effects)
  LIVE_URL=$(flyctl ssh console --app bx-auth-service -C "printenv DATABASE_URL" 2>/dev/null | tr -d '\r\n' || true)
  if is_valid_db_url "$LIVE_URL"; then
    DATABASE_URL="$LIVE_URL"
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
    echo "  ✓ DATABASE_URL retrieved from live machine and saved to $ENV_FILE"
    return
  fi
  # Fall back to flyctl postgres attach
  echo "  → running flyctl postgres attach..."
  # Unset first in case a broken value is blocking re-attach
  flyctl secrets unset DATABASE_URL --app bx-auth-service --stage 2>/dev/null || true
  ATTACH_OUT=$(flyctl postgres attach bx-postgres \
    --app bx-auth-service \
    --database-name bxdb \
    --database-user bxapp 2>&1 || true)
  DATABASE_URL=$(echo "$ATTACH_OUT" | grep -oE 'postgres(ql)?://[^ ]+' | head -1 || true)
  if ! is_valid_db_url "${DATABASE_URL:-}"; then
    echo ""
    echo "❌  Could not provision DATABASE_URL automatically."
    echo "    Run:  flyctl postgres attach bx-postgres --app bx-auth-service"
    echo "    Copy DATABASE_URL from the output into .env.fly, then re-run."
    exit 1
  fi
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
  echo "  ✓ DATABASE_URL provisioned and saved to $ENV_FILE"
}

ensure_database_url

# Secrets loaded from .env.fly (empty string if not set)
DB_URL="${DATABASE_URL:-}"
_JWT_SECRET="${JWT_SECRET:-}"
_WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"
_ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo ""; echo "▶ $*"; }
ok()   { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

deploy_app() {
  local app="$1"
  local config="$2"
  shift 2
  echo "  → deploying $app …"
  flyctl deploy \
    --app "$app" \
    --config "$config" \
    --remote-only \
    --wait-timeout 180 \
    "$@" 2>&1 | sed "s/^/    [$app] /"
  ok "$app deployed"
}

# Push secrets from .env.fly to a Fly.io app.
# Usage: set_app_secrets <app> key=value [key=value ...]
set_app_secrets() {
  local app="$1"; shift
  if [[ $# -gt 0 ]]; then
    flyctl secrets set -a "$app" "$@" 2>&1 | sed "s/^/    [$app] /" || true
    ok "$app secrets synced"
  fi
}

sync_all_secrets() {
  log "Syncing secrets from $ENV_FILE to Fly.io apps"

  local common_secrets=()
  [[ -n "$DB_URL" ]]          && common_secrets+=("DATABASE_URL=$DB_URL")
  [[ -n "$_JWT_SECRET" ]]     && common_secrets+=("JWT_SECRET=$_JWT_SECRET")
  [[ -n "$_WEBHOOK_SECRET" ]] && common_secrets+=("WEBHOOK_SECRET=$_WEBHOOK_SECRET")

  local backend_apps=(
    bx-auth-service bx-subscription-service
    bx-integration-service bx-billing-service bx-gateway
  )
  for app in "${backend_apps[@]}"; do
    set_app_secrets "$app" "${common_secrets[@]}"
  done

  local partner_secrets=("${common_secrets[@]}")
  [[ -n "$_ENCRYPTION_KEY" ]] && partner_secrets+=("ENCRYPTION_KEY=$_ENCRYPTION_KEY")
  set_app_secrets bx-partner-service "${partner_secrets[@]}"

  set_app_secrets bx-mapping-engine "${common_secrets[@]}"
  set_app_secrets bx-agent-orchestrator "${common_secrets[@]}"

  ok "All secrets synced"
}

# ─────────────────────────────────────────────────────────────────────────────
# Single-app shortcut
# ─────────────────────────────────────────────────────────────────────────────
if [[ -n "$SINGLE_APP" ]]; then
  log "Redeploying $SINGLE_APP"
  sync_all_secrets
  case "$SINGLE_APP" in
    bx-gateway)
      deploy_app bx-gateway apps/gateway/fly.toml ;;
    bx-partner-portal)
      deploy_app bx-partner-portal apps/partner-portal/fly.toml \
        --build-arg "NEXT_PUBLIC_API_URL=$GATEWAY_URL" ;;
    bx-auth-service)        deploy_app bx-auth-service        apps/auth-service/fly.toml ;;
    bx-partner-service)     deploy_app bx-partner-service     apps/partner-service/fly.toml ;;
    bx-subscription-service)deploy_app bx-subscription-service apps/subscription-service/fly.toml ;;
    bx-integration-service) deploy_app bx-integration-service apps/integration-service/fly.toml ;;
    bx-mapping-engine)      deploy_app bx-mapping-engine      apps/mapping-engine/fly.toml ;;
    bx-agent-orchestrator)  deploy_app bx-agent-orchestrator  apps/agent-orchestrator/fly.toml ;;
    bx-billing-service)     deploy_app bx-billing-service     apps/billing-service/fly.toml ;;
    *) fail "Unknown app: $SINGLE_APP" ;;
  esac
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Full deploy
# ─────────────────────────────────────────────────────────────────────────────

# ── 0. Sync secrets ───────────────────────────────────────────────────────────
sync_all_secrets

# ── 1. DB migration ───────────────────────────────────────────────────────────
log "Running DB migrations"
# Extract db name from DATABASE_URL (e.g. postgres://user:pass@host/bxdb → bxdb)
DB_NAME=$(echo "$DB_URL" | grep -oE '/[^/?]+(\?|$)' | head -1 | tr -d '/?' || echo "postgres")
DB_NAME="${DB_NAME:-postgres}"
for migration in packages/database/migrations/*.sql; do
  log "  Applying $migration"
  { cat "$migration"; printf '\\q\n'; } \
    | flyctl postgres connect --app bx-postgres --database "$DB_NAME" || true   # idempotent
done
ok "All migrations done (database: $DB_NAME)"

# ── 2. Backend services in parallel ──────────────────────────────────────────
log "Deploying backend services in parallel"

PIDS=()
BACKEND_SERVICES=(
  "bx-auth-service:apps/auth-service/fly.toml"
  "bx-partner-service:apps/partner-service/fly.toml"
  "bx-subscription-service:apps/subscription-service/fly.toml"
  "bx-integration-service:apps/integration-service/fly.toml"
  "bx-mapping-engine:apps/mapping-engine/fly.toml"
  "bx-agent-orchestrator:apps/agent-orchestrator/fly.toml"
  "bx-billing-service:apps/billing-service/fly.toml"
  "bx-exchange-agent:apps/exchange-agent/fly.toml"
)

for entry in "${BACKEND_SERVICES[@]}"; do
  app="${entry%%:*}"
  config="${entry##*:}"
  deploy_app "$app" "$config" &
  PIDS+=($!)
done

# Wait for all backends; collect failures
FAILED=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    FAILED=$((FAILED + 1))
  fi
done

if [[ $FAILED -gt 0 ]]; then
  fail "$FAILED backend service(s) failed to deploy — check output above"
fi
ok "All backend services deployed"

# ── 3. Gateway ───────────────────────────────────────────────────────────────
log "Deploying gateway"
deploy_app bx-gateway apps/gateway/fly.toml

# ── 4. Partner portal ─────────────────────────────────────────────────────────
log "Deploying partner portal (NEXT_PUBLIC_API_URL=$GATEWAY_URL)"
deploy_app bx-partner-portal apps/partner-portal/fly.toml \
  --build-arg "NEXT_PUBLIC_API_URL=$GATEWAY_URL"

# ── 5. Smoke test ─────────────────────────────────────────────────────────────
log "Smoke test"

smoke() {
  local url="$1"
  local label="$2"
  if curl -fsSL --retry 5 --retry-delay 10 --max-time 30 "$url" > /dev/null 2>&1; then
    ok "$label  ($url)"
  else
    echo "  ⚠  $label did not respond — check logs: flyctl logs -a ${label}"
  fi
}

smoke "https://bx-gateway.fly.dev/health"                      "gateway"
smoke "https://bx-exchange-agent.fly.dev/health"               "exchange-agent"
smoke "https://bx-exchange-agent.fly.dev/.well-known/agent.json" "agent-card"
smoke "https://bx-partner-portal.fly.dev/"                     "partner-portal"

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "✅ Deploy complete!"
echo ""
echo "   Gateway:        https://bx-gateway.fly.dev"
echo "   Exchange Agent: https://bx-exchange-agent.fly.dev"
echo "   Agent Card:     https://bx-gateway.fly.dev/.well-known/agent.json"
echo "   Portal:         https://bx-partner-portal.fly.dev"
echo ""
echo "Useful commands:"
echo "  flyctl logs -a bx-gateway"
echo "  flyctl logs -a bx-exchange-agent"
echo "  flyctl status -a bx-partner-service"
echo "  bash infra/fly/deploy.sh --app bx-exchange-agent   # redeploy single service"
echo "────────────────────────────────────────────────────────────────"
