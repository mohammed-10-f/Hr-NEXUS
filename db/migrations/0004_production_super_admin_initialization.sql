-- HR Nexus production hardening: platform Super Admin initialization.
-- Idempotent: safe to apply once to an existing Phase 2 database.
-- Does not create a company and does not attach the platform user to a tenant.
PRAGMA foreign_keys = ON;

ALTER TABLE platform_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
  CHECK (must_change_password IN (0,1));

-- Initial platform credentials:
-- username: superadmin
-- temporary password: Mm123456
-- Password is stored only as a PBKDF2 hash compatible with src/server/auth/crypto.ts.
INSERT INTO platform_users(
  id, username, display_name, password_hash, must_change_password, status
) VALUES (
  'platform-super-admin-initial',
  'superadmin',
  'مدير المنصة',
  'pbkdf2$100000$b04ee84e-1d95-4ea4-b288-b97062f11e48$MHUUtxXoPYz8NO+6PtrPIeOqAnZ9RdJsUk8E8An/HjU=',
  1,
  'active'
)
ON CONFLICT(username) DO UPDATE SET
  display_name=excluded.display_name,
  password_hash=excluded.password_hash,
  must_change_password=1,
  status='active',
  failed_login_count=0,
  locked_until=NULL,
  updated_at=CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_users_username
  ON platform_users(username);
