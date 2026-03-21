ALTER TABLE schema_registry
  ADD COLUMN IF NOT EXISTS created_with_model VARCHAR(255);
