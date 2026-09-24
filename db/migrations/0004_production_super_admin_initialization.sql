-- HR Nexus production hardening: platform Super Admin initialization.
-- Idempotent: safe to apply once to an existing Phase 2 database. The column is part of the foundation schema so this migration never performs a duplicate ALTER.
-- Does not create a company and does not attach the platform user to a tenant.
PRAGMA foreign_keys = ON;

-- Initial platform credentials:
-- username: superadmin
-- temporary password: Mm123456
-- Password is stored only as a PBKDF2 hash compatible with src/server/auth/crypto.ts.
INSERT OR IGNORE INTO platform_users(
  id, username, display_name, password_hash, must_change_password, status
) VALUES (
  'platform-super-admin-initial',
  'superadmin',
  'مدير المنصة',
  'pbkdf2$100000$b04ee84e-1d95-4ea4-b288-b97062f11e48$MHUUtxXoPYz8NO+6PtrPIeOqAnZ9RdJsUk8E8An/HjU=',
  1,
  'active'
);

-- INSERT OR IGNORE protects a fresh database, but an existing row with the
-- same username must also be repaired if it was inactive or had stale state.
-- This update intentionally resets the initial temporary credential only when
-- this production initialization migration is applied.
UPDATE platform_users
SET display_name='مدير المنصة',
    password_hash='pbkdf2$100000$b04ee84e-1d95-4ea4-b288-b97062f11e48$MHUUtxXoPYz8NO+6PtrPIeOqAnZ9RdJsUk8E8An/HjU=',
    must_change_password=1,
    status='active',
    failed_login_count=0,
    locked_until=NULL,
    updated_at=CURRENT_TIMESTAMP
WHERE username='superadmin';

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_users_username
  ON platform_users(username);
