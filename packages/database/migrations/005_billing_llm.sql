-- LLM usage metering: tracks token counts per mapping call per partner per stage.
-- llm_source = 'platform' → platform pays, billed back to partner via token rates.
-- llm_source = 'external' → partner pays their own provider; billed_amount = 0.

-- Extend billing_rates with operation_type so we can store per-token rates
ALTER TABLE billing_rates
  ADD COLUMN IF NOT EXISTS operation_type VARCHAR(20) NOT NULL DEFAULT 'message'
    CHECK (operation_type IN ('message', 'llm-input-token', 'llm-output-token'));

-- Per-call LLM usage log (one row per stage per message)
CREATE TABLE IF NOT EXISTS billing_llm_usage (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id     UUID          NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  message_id     UUID          REFERENCES messages(id) ON DELETE SET NULL,
  period         VARCHAR(7)    NOT NULL,  -- YYYY-MM
  stage          SMALLINT      NOT NULL,  -- 1 = source→CDM, 2 = CDM→target
  llm_source     VARCHAR(10)   NOT NULL CHECK (llm_source IN ('platform', 'external')),
  provider       VARCHAR(30),             -- 'azure' | 'openai' | 'openai-compatible'
  model          VARCHAR(100),
  input_tokens   INTEGER       NOT NULL DEFAULT 0,
  output_tokens  INTEGER       NOT NULL DEFAULT 0,
  billed_amount  NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_llm_usage_partner_period
  ON billing_llm_usage(partner_id, period);

CREATE INDEX IF NOT EXISTS idx_billing_llm_usage_message
  ON billing_llm_usage(message_id);

-- Seed per-token rates for each plan (per 1,000 tokens; slightly above provider cost)
-- Unique index ensures idempotent re-runs don't duplicate LLM rates
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_rates_plan_optype
  ON billing_rates(plan_id, operation_type);

-- Starter plan token rates
INSERT INTO billing_rates (plan_id, operation_type, rate_per_message, included_messages)
  SELECT id, 'llm-input-token',  0.00015, 0 FROM billing_plans WHERE name = 'Starter'
  ON CONFLICT (plan_id, operation_type) DO NOTHING;
INSERT INTO billing_rates (plan_id, operation_type, rate_per_message, included_messages)
  SELECT id, 'llm-output-token', 0.00045, 0 FROM billing_plans WHERE name = 'Starter'
  ON CONFLICT (plan_id, operation_type) DO NOTHING;

-- Growth plan token rates
INSERT INTO billing_rates (plan_id, operation_type, rate_per_message, included_messages)
  SELECT id, 'llm-input-token',  0.00010, 0 FROM billing_plans WHERE name = 'Growth'
  ON CONFLICT (plan_id, operation_type) DO NOTHING;
INSERT INTO billing_rates (plan_id, operation_type, rate_per_message, included_messages)
  SELECT id, 'llm-output-token', 0.00030, 0 FROM billing_plans WHERE name = 'Growth'
  ON CONFLICT (plan_id, operation_type) DO NOTHING;

-- Enterprise plan token rates (lower; negotiated custom rates override via custom_base_fee pattern)
INSERT INTO billing_rates (plan_id, operation_type, rate_per_message, included_messages)
  SELECT id, 'llm-input-token',  0.00008, 0 FROM billing_plans WHERE name = 'Enterprise'
  ON CONFLICT (plan_id, operation_type) DO NOTHING;
INSERT INTO billing_rates (plan_id, operation_type, rate_per_message, included_messages)
  SELECT id, 'llm-output-token', 0.00020, 0 FROM billing_plans WHERE name = 'Enterprise'
  ON CONFLICT (plan_id, operation_type) DO NOTHING;
