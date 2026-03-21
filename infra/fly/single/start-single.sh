#!/usr/bin/env sh
# ─────────────────────────────────────────────────────────────────────────────
# Container entrypoint — runs DB migrations then starts all processes via
# supervisord. Secrets (DATABASE_URL, JWT_SECRET, etc.) are injected by Fly.io
# as environment variables at runtime.
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "▶ [start] Business Exchange — single-host boot"

# ── Wait for Postgres ─────────────────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  # Extract host and port from DATABASE_URL (postgres://user:pass@host:port/db)
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
  DB_PORT="${DB_PORT:-5432}"

  echo "▶ Waiting for Postgres at $DB_HOST:$DB_PORT ..."
  MAX=30
  COUNT=0
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; do
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -ge "$MAX" ]; then
      echo "✗ Postgres not reachable after ${MAX}s — aborting"
      exit 1
    fi
    sleep 1
  done
  echo "  ✓ Postgres is ready"

  # ── Run migrations (idempotent SQL files, sorted) ─────────────────────────
  echo "▶ Running database migrations ..."
  DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
  for sql_file in $(ls /app/packages/database/migrations/*.sql | sort); do
    echo "  → $(basename "$sql_file")"
    psql "$DATABASE_URL" -f "$sql_file" -q 2>&1 || true
  done
  echo "  ✓ Migrations complete"
else
  echo "  ⚠  DATABASE_URL not set — skipping migration"
fi

# ── Ensure nginx log dirs exist ───────────────────────────────────────────────
mkdir -p /var/log/nginx /run/nginx

# ── Start supervisord (manages all services) ─────────────────────────────────
echo "▶ Starting all services via supervisord ..."
exec /usr/bin/supervisord -c /etc/supervisord.conf
