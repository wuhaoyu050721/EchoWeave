ALTER TABLE sync_records
  MODIFY envelope_json LONGTEXT NOT NULL;

ALTER TABLE sync_changes
  MODIFY envelope_json LONGTEXT NOT NULL;
