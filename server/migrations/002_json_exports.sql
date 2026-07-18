CREATE TABLE json_exports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  backup_json LONGTEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  format_version INT UNSIGNED NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_json_exports_token_hash (token_hash),
  KEY idx_json_exports_user_created (user_id, created_at),
  CONSTRAINT fk_json_exports_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
