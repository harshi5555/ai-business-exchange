-- ============================================================
-- 007: Agent sessions for A2A / MCP partner onboarding
-- Tracks negotiation state between partner agents and the
-- Exchange Agent.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_sessions (
  id                     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id             UUID         REFERENCES partners(id) ON DELETE SET NULL,
  a2a_task_id            TEXT         UNIQUE,
  state                  VARCHAR(30)  NOT NULL DEFAULT 'discovery'
                           CHECK (state IN (
                             'discovery',
                             'schema_submitted',
                             'mapping_proposed',
                             'counter_offered',
                             'terms_negotiated',
                             'provisioning',
                             'active',
                             'failed',
                             'abandoned'
                           )),
  negotiation_context    JSONB        NOT NULL DEFAULT '[]',
  proposed_mapping       JSONB,
  proposed_subscriptions JSONB,
  partner_name           VARCHAR(200),
  partner_domain         VARCHAR(253),
  partner_email          VARCHAR(320),
  webhook_url            TEXT,
  sample_payload         TEXT,
  supported_formats      TEXT[]       NOT NULL DEFAULT '{}',
  error_message          TEXT,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_state      ON agent_sessions(state);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_partner_id ON agent_sessions(partner_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_created_at ON agent_sessions(created_at DESC);
