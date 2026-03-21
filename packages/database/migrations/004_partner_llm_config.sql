-- Partner LLM configuration: each partner can use the platform LLM or bring their own.
-- API key is stored AES-256-GCM encrypted; never returned in plain text via API.
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS llm_use_platform BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS llm_provider     VARCHAR(30),   -- 'azure' | 'openai' | 'openai-compatible'
  ADD COLUMN IF NOT EXISTS llm_endpoint     TEXT,          -- base URL (Azure / compatible only)
  ADD COLUMN IF NOT EXISTS llm_model        VARCHAR(100),  -- model or deployment name
  ADD COLUMN IF NOT EXISTS llm_api_key_enc  TEXT;          -- AES-256-GCM encrypted key
