-- ─── Billing Plans ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_plans (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  base_fee    NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Billing Rates (per plan, per format/direction) ──────────────────────────

CREATE TABLE IF NOT EXISTS billing_rates (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID        NOT NULL REFERENCES billing_plans(id) ON DELETE CASCADE,
  format            VARCHAR(20),
  direction         VARCHAR(10) CHECK (direction IN ('inbound','outbound')),
  rate_per_message  NUMERIC(10,6) NOT NULL DEFAULT 0.001,
  included_messages INTEGER     NOT NULL DEFAULT 0
);

-- ─── Partner Billing Assignment ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_billing (
  partner_id      UUID        PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,
  plan_id         UUID        REFERENCES billing_plans(id) ON DELETE SET NULL,
  custom_base_fee NUMERIC(10,2),
  billing_email   VARCHAR(320),
  billing_cycle   VARCHAR(20) NOT NULL DEFAULT 'monthly',
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','trial','cancelled')),
  trial_ends_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Usage Tracking ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_usage (
  partner_id    UUID        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  period        VARCHAR(7)  NOT NULL, -- YYYY-MM
  format        VARCHAR(20) NOT NULL,
  direction     VARCHAR(10) NOT NULL,
  message_count INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (partner_id, period, format, direction)
);

-- ─── Invoices ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_invoices (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id  UUID        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  period      VARCHAR(7)  NOT NULL,
  base_fee    NUMERIC(10,2) NOT NULL DEFAULT 0,
  usage_fee   NUMERIC(10,2) NOT NULL DEFAULT 0,
  total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  status      VARCHAR(20) NOT NULL DEFAULT 'issued'
                CHECK (status IN ('issued','paid','void')),
  line_items  JSONB       NOT NULL DEFAULT '[]',
  issued_at   TIMESTAMPTZ,
  due_at      TIMESTAMPTZ,
  paid_at     TIMESTAMPTZ,
  UNIQUE (partner_id, period)
);

-- ─── Seed default plans ───────────────────────────────────────────────────────

INSERT INTO billing_plans (id, name, description, base_fee) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Starter',    'Up to 1,000 messages/month', 0),
  ('11111111-0000-0000-0000-000000000002', 'Growth',     'Up to 10,000 messages/month', 49),
  ('11111111-0000-0000-0000-000000000003', 'Enterprise', 'Unlimited messages, custom rates', 299)
ON CONFLICT (id) DO NOTHING;

INSERT INTO billing_rates (id, plan_id, format, direction, rate_per_message, included_messages) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', NULL, NULL, 0.005, 1000),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', NULL, NULL, 0.002, 10000),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003', NULL, NULL, 0.001, 0)
ON CONFLICT (id) DO NOTHING;
