-- ============================================================
-- Business Exchange — Full Database Schema
-- Single source of truth for a fresh PostgreSQL database.
-- Mounted as docker-entrypoint-initdb.d and runs automatically
-- on first container initialisation.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Partners ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partners (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    VARCHAR(200)  NOT NULL,
  domain                  VARCHAR(253)  NOT NULL UNIQUE,
  contact_email           VARCHAR(320)  NOT NULL UNIQUE,
  webhook_url             TEXT,
  supported_formats       TEXT[]        NOT NULL DEFAULT '{}',
  supported_message_types TEXT[]        NOT NULL DEFAULT '{}',
  status                  VARCHAR(20)   NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','suspended','rejected','archived')),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_domain ON partners(domain);

-- ─── Auth Users (portal login) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id    UUID        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  email         VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  scopes        TEXT[]      NOT NULL DEFAULT '{"partner:read","integration:send","integration:receive"}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── OAuth Clients (M2M / client_credentials) ────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_clients (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id         UUID        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  client_id          VARCHAR(100) NOT NULL UNIQUE,
  client_secret_hash TEXT        NOT NULL,
  scopes             TEXT[]      NOT NULL DEFAULT '{"integration:send","integration:receive"}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── API Keys ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id  UUID        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  key_hash    TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);

-- ─── Refresh Tokens ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token       TEXT        PRIMARY KEY,
  partner_id  UUID        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  scopes      TEXT[]      NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Subscriptions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscriber_partner_id UUID        NOT NULL REFERENCES partners(id),
  provider_partner_id   UUID        NOT NULL REFERENCES partners(id),
  status                VARCHAR(20) NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested','approved','active','paused','terminated')),
  approved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscriber_partner_id, provider_partner_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber ON subscriptions(subscriber_partner_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider   ON subscriptions(provider_partner_id, status);

-- ─── Messages ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_partner_id UUID        NOT NULL REFERENCES partners(id),
  target_partner_id UUID        NOT NULL REFERENCES partners(id),
  subscription_id   UUID        NOT NULL REFERENCES subscriptions(id),
  format            VARCHAR(20) NOT NULL
                      CHECK (format IN ('json','xml','csv','edi-x12','edifact')),
  raw_payload       TEXT        NOT NULL,
  mapped_payload    TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received','processing','delivered','failed','dead_lettered')),
  retries           INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source_partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_target ON messages(target_partner_id, created_at DESC);

-- ─── Schema Registry ─────────────────────────────────────────────────────────
-- Each row is one versioned schema for a (partner, format, message_type) combination.
-- Only one version per combination may be active at a time (enforced by partial unique index).

CREATE TABLE IF NOT EXISTS schema_registry (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id      UUID        NOT NULL REFERENCES partners(id),
  format          VARCHAR(20) NOT NULL,
  message_type    VARCHAR(100) NOT NULL DEFAULT 'custom',
  sample_payload  TEXT        NOT NULL,
  inferred_schema JSONB       NOT NULL DEFAULT '{}',
  mapping_rules   JSONB       NOT NULL DEFAULT '[]',
  version         INTEGER     NOT NULL DEFAULT 1,
  is_active       BOOLEAN     NOT NULL DEFAULT false,
  schema_direction VARCHAR(10) NOT NULL DEFAULT 'outbound'
                    CHECK (schema_direction IN ('outbound','inbound')),
  status          VARCHAR(30) NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review','auto_approved','approved','drift_suspected','deprecated')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one active schema per (partner, direction, format, message_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_registry_one_active
  ON schema_registry (partner_id, schema_direction, format, message_type)
  WHERE is_active = true;

-- Version numbers unique per (partner, direction, format, message_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_registry_version
  ON schema_registry (partner_id, schema_direction, format, message_type, version);

CREATE INDEX IF NOT EXISTS idx_schema_registry_active
  ON schema_registry (partner_id, format, message_type, is_active);

CREATE INDEX IF NOT EXISTS idx_schema_registry_direction
  ON schema_registry (partner_id, schema_direction, format, is_active);

CREATE INDEX IF NOT EXISTS idx_schema_registry_partner ON schema_registry(partner_id, status);

-- ─── Agent Events ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_events (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_type  VARCHAR(30) NOT NULL,
  entity_id   TEXT        NOT NULL,
  action      VARCHAR(100) NOT NULL,
  outcome     VARCHAR(20) NOT NULL CHECK (outcome IN ('success','failure','skipped')),
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_entity ON agent_events(entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_type   ON agent_events(agent_type, created_at DESC);

-- ─── Partner Branding ────────────────────────────────────────────────────────

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS branding_config JSONB NOT NULL DEFAULT '{}';

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- ─── Platform Settings (branding) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_settings (
  id         VARCHAR(50) PRIMARY KEY,
  branding   JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (id, branding) VALUES (
  'default',
  '{"primaryColor": "#6366f1", "accentColor": "#4f46e5", "logoUrl": ""}'
) ON CONFLICT (id) DO NOTHING;

-- ─── System Settings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value) VALUES
  ('platform_name',                 'BusinessX'),
  ('auto_approve_partners',         'false'),
  ('max_subscriptions_per_partner', '10'),
  ('demo_mode',                     'false')
ON CONFLICT (key) DO NOTHING;

-- ─── Platform Admin Seed ─────────────────────────────────────────────────────
-- Fixed anchor partner for the platform admin user.
-- The auth-service seed-admin script inserts the actual auth_users row on first startup.

INSERT INTO partners (id, name, domain, contact_email, supported_formats, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Platform Admin',
  'platform.internal',
  'platform@internal',
  '{}',
  'approved',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ─── Integration Validation (Connection Tests) ───────────────────────────────
-- Tracks partner-to-partner integration handshakes: Partner A initiates a real
-- test message to Partner B; Partner B confirms or rejects receipt.

CREATE TABLE IF NOT EXISTS connection_tests (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id      UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  initiator_partner_id UUID        NOT NULL REFERENCES partners(id),
  receiver_partner_id  UUID        NOT NULL REFERENCES partners(id),
  format               VARCHAR(20) NOT NULL,
  test_payload         TEXT        NOT NULL,
  message_id           UUID        REFERENCES messages(id) ON DELETE SET NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','delivered','confirmed','rejected','expired')),
  initiator_notes      TEXT,
  receiver_notes       TEXT,
  confirmed_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connection_tests_initiator ON connection_tests(initiator_partner_id, status);
CREATE INDEX IF NOT EXISTS idx_connection_tests_receiver  ON connection_tests(receiver_partner_id, status);
CREATE INDEX IF NOT EXISTS idx_connection_tests_sub       ON connection_tests(subscription_id);
