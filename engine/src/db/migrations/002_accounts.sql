ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

UPDATE users SET role = 'customer' WHERE role = 'attendee';
UPDATE users SET role = 'seller' WHERE role = 'organizer';
UPDATE users SET role = 'admin' WHERE role = 'staff';

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer';

DELETE FROM users WHERE password_hash IS NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

DROP TABLE IF EXISTS login_codes;

CREATE INDEX IF NOT EXISTS users_role ON users (role);
