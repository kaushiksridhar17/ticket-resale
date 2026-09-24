ALTER TABLE users ADD COLUMN IF NOT EXISTS buys BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sells BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';

UPDATE users SET buys = TRUE, sells = FALSE WHERE role = 'customer';
UPDATE users SET buys = FALSE, sells = TRUE WHERE role = 'seller';
UPDATE users SET buys = TRUE, sells = TRUE WHERE role = 'admin';

UPDATE users SET role = 'member' WHERE role IN ('customer', 'seller');

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';
