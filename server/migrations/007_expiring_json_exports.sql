-- Run before deploying the server code that manages expiring JSON shares.
ALTER TABLE json_exports
  ADD COLUMN expires_at BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER created_at,
  ADD KEY idx_json_exports_expiry (expires_at);

-- Existing links get one final seven-day grace period from this migration.
UPDATE json_exports SET expires_at = UNIX_TIMESTAMP() + 604800 WHERE expires_at = 0;
