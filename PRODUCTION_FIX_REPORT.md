# HR Nexus — Production Fix Report

## Changes applied to the existing project

1. Added an idempotent production migration:
   - `db/migrations/0004_production_super_admin_initialization.sql`
   - Adds `platform_users.must_change_password`.
   - Initializes/repairs exactly one `superadmin` platform account.
   - Stores only a PBKDF2 hash for the temporary password.
   - Leaves `company_id` absent/null because platform users are not company users.

2. Repaired platform authentication:
   - Platform login now reads and returns `must_change_password`.
   - Platform password change clears the flag.
   - Platform session context carries the flag, including temporary company-access context.

3. Enforced password-change gating server-side:
   - Platform routes require the password-change requirement to be cleared.
   - The existing client gate remains in place.

4. Repaired migration consistency:
   - The old Phase 1 migration was reduced to its non-conflicting tenant compatibility table so the two existing `0001_*` migrations do not create incompatible duplicate schemas on a fresh database.
   - The legacy audit compatibility migration is now index-only because the Phase 2 audit schema already contains its columns.

5. Existing company creation UI/API was preserved. No frontend redesign or new database was introduced.

## Verification performed in this environment

- All four migration stages execute successfully against a fresh SQLite-compatible test database.
- The Super Admin migration creates `superadmin` with `must_change_password = 1` and a PBKDF2 hash.
- The migration schema is internally consistent for the current Phase 2 tables.
- Static source inspection confirms company creation uses the existing `/api/platform/companies` endpoint, server-side `requireSuperAdmin`, D1 batch insertion, unique company identifiers, and audit logging.

## Verification not possible from this environment

The uploaded project does not contain Cloudflare credentials, and this execution environment could not reach/install Wrangler dependencies. Therefore the real remote Cloudflare D1 database and deployed Worker could not be executed from here.

The following must therefore remain UNVERIFIED until run against the real `hr-nexu` D1 database:
- remote migration application
- live `superadmin / Mm123456` login
- live mandatory password change
- live company creation/persistence
- live duplicate identifier rejection
- live company-access approval/direct-access flow
- live tenant-isolation request
- deployed regression test

Do not label those live tests PASS until they are executed against the configured Cloudflare Worker and D1 database.


## Compatibility corrections in this delivery

The application layer is now compatible with the currently observed `hr-nexu` D1 schema without requiring the optional `0002_company_management.sql` columns:

- Company lifecycle is read from `companies.status`; the API exposes a compatibility alias as `management_status` for the existing Arabic UI.
- Company access request updates no longer reference `company_access_requests.updated_at`, because that column is not present in the current remote schema.
- Company-user authentication and session loading no longer reference `companies.management_status`.
- Company-user creation no longer attempts to write `company_users.display_name`; the current schema does not contain that column.
- Audit actor types are aligned with the live constraint: `platform_user`, `company_user`, and `system`.
- The PBKDF2 iteration count documented by the project is 100,000, matching the Cloudflare runtime and `src/server/auth/crypto.ts`.

This delivery still requires live verification against the configured Worker/D1 binding before claiming the production test matrix has passed.
