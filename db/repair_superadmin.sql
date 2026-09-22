-- One-time repair for an existing hr-nexu database.
-- Resets only the intended platform Super Admin credentials/state.
UPDATE platform_users
SET password_hash = 'pbkdf2$100000$b04ee84e-1d95-4ea4-b288-b97062f11e48$MHUUtxXoPYz8NO+6PtrPIeOqAnZ9RdJsUk8E8An/HjU=',
    must_change_password = 1,
    status = 'active',
    failed_login_count = 0,
    locked_until = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'superadmin';

SELECT id, username, status, must_change_password, failed_login_count, locked_until, password_hash
FROM platform_users
WHERE username = 'superadmin';
