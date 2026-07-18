CREATE TABLE sync_user_state (
  user_id BIGINT UNSIGNED NOT NULL,
  current_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_sync_user_state_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sync_records (
  user_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation ENUM('upsert', 'delete') NOT NULL,
  envelope_json MEDIUMTEXT NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  updated_at_ms BIGINT UNSIGNED NOT NULL,
  device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id),
  KEY idx_sync_records_user_revision (user_id, revision),
  CONSTRAINT fk_sync_records_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sync_mutations (
  user_id BIGINT UNSIGNED NOT NULL,
  mutation_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  accepted TINYINT(1) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, mutation_id),
  UNIQUE KEY uq_sync_mutations_user_revision (user_id, revision),
  CONSTRAINT fk_sync_mutations_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sync_changes (
  user_id BIGINT UNSIGNED NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation ENUM('upsert', 'delete') NOT NULL,
  envelope_json MEDIUMTEXT NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  updated_at_ms BIGINT UNSIGNED NOT NULL,
  device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (user_id, revision),
  KEY idx_sync_changes_user_entity (user_id, entity_type, entity_id),
  CONSTRAINT fk_sync_changes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
