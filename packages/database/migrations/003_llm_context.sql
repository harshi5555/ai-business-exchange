-- Add LLM context column to messages for traceability
-- Stores the prompts sent to LLM and raw responses received for both mapping stages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS llm_context JSONB;

-- Add cdm_payload column to store the intermediate CDM representation
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS cdm_payload TEXT;

-- Add error_message column to store delivery/mapping errors
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add schema_id column to reference the applied schema mapping
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS schema_id UUID REFERENCES schema_registry(id) ON DELETE SET NULL;

-- Add output_format to track the format AFTER mapping (format column retains original input format)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS output_format VARCHAR(50);
