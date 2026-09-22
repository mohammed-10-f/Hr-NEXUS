# HR Nexus — A-Z delivery note

This package is aligned with the currently observed `hr-nexu` D1 schema.

Critical fixes included:
- Platform audit actor type now uses the live allowed values (`platform_user`, `company_user`, `system`).
- Platform/company authentication no longer depends on `companies.management_status`.
- Company access request code no longer depends on `company_access_requests.updated_at`.
- Company creation no longer writes the absent `company_users.display_name` column.
- Existing Arabic company UI compatibility is preserved by exposing `status` as the API's `management_status` alias.
- Super Admin PBKDF2 documentation/migration uses 100,000 iterations.
- Super Admin migration no longer overwrites an existing `superadmin` account when the username already exists.

Validation performed before packaging:
- All 31 TypeScript/TSX source files passed TypeScript syntax transpilation diagnostics.
- Fresh SQLite execution of all migrations succeeds.
- Critical company/admin/role/permission/audit SQL paths were executed against a fresh schema.
- A remote-like schema without migration `0002` was checked for the removed `management_status` and `company_users.display_name` dependencies.

Not verified here:
- Live Cloudflare deployment.
- Live Worker/D1 end-to-end requests.

Do not reset the existing production database or create a new D1 database.
