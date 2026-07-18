ALTER TABLE users
  ADD COLUMN username VARCHAR(64) NULL AFTER email;

UPDATE users
SET username = LEFT(SUBSTRING_INDEX(email, '@', 1), 32)
WHERE username IS NULL OR username = '';

ALTER TABLE users
  MODIFY COLUMN username VARCHAR(64) NOT NULL;
