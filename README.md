# HR Nexus — Phase 2

Phase 2 implements the real authentication and multi-tenant foundation against the existing Cloudflare D1 database **hr-nexus**. The approved Phase 1 visual system is retained.

## Scope implemented

- Platform-level Super Admin identity with no company membership.
- Company tenants with unique identifiers.
- Company users bound to exactly one company.
- Employee username = ID/identifier supplied by the company; no nationality assumption.
- Secure PBKDF2 password hashing (100,000 iterations, SHA-256), matching the deployed Cloudflare Workers runtime.
- First-login password change.
- Server-side sessions using HttpOnly/Secure/SameSite cookies.
- Session revocation and expiry.
- Company tenant isolation enforced server-side.
- Super Admin company selection using a separate temporary company-access session.
- Active Company Admin => approval request and in-system notification.
- Company without active Company Admin => direct temporary access.
- Company access expiry, revocation and explicit exit.
- Audit logging for authentication and company-access events.
- Role/permission architecture ready for Phase 3.
- Cross-tenant employee reads are constrained by authenticated company context.
- Rate-limit foundation: five failed attempts cause a 15-minute account lock.
- No workflow engine, payroll, leave engine, Qiwa/GOSI/Muqeem/bank integrations in this phase.

## Database

This repository targets only:

- Database: `hr-nexus`
- Database ID: `6010e3ea-b8a7-44a6-bf79-bb45bdcba837`
- Binding: `DB`

Do not create or delete another D1 database.

## Database migrations and deployment

All production schema changes belong in `db/migrations/` as versioned SQL migrations. Wrangler records applied migrations in D1's migration history, so an already-applied migration is not executed again. Cloudflare D1 applies pending migrations transactionally and rolls back a failed migration.

The deployment pipeline in `.github/workflows/deploy.yml` runs, in order:

1. install dependencies
2. typecheck
3. build
4. apply pending remote D1 migrations
5. deploy the Worker

Required GitHub repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The API token must be stored only in GitHub Secrets and scoped to the required Cloudflare account/resources. No Cloudflare credentials are committed to the repository.

For local development:

```bash
npm run db:migrate:local
```

For production, do not run SQL manually in the Cloudflare dashboard. Add a new numbered migration under `db/migrations/` and push to `main`; the deployment workflow applies only the pending migrations before deploying the Worker.


## Local setup

```bash
npm install
npm run typecheck
npm run build
npm run db:migrate:local
```

For a real remote D1 migration, only after confirming the target is the intended `hr-nexus` database:

```bash
npm run db:migrate:remote
```

## Optional Phase 2 test data

Test data is deliberately separate from the migration and is never required for production functionality.

```bash
npm run db:seed:test
```

Remote test data:

```bash
npm run db:seed:test:remote
```

The production migration `0004_production_super_admin_initialization.sql` initializes the first platform Super Admin independently of test data.

The optional seed script uses `Mm123456` as its test password unless `HR_NEXUS_TEST_PASSWORD` is supplied.

It creates test company records and a test Super Admin:

- Test Super Admin: `superadmin`
- Company A: `A001`
- Company A Admin: `1234567890`
- Company A Employee: `1001`
- Company B: `A002`
- Company B Admin: `2234567890`
- Company B Employee: `2001`

All seeded company users have `must_change_password = 1`.

## Important test flow

1. Log in as Super Admin.
2. Open Companies.
3. Select Company A.
4. Because Company A has an active Company Admin, a request is created.
5. Log in separately as Company A Admin.
6. Open `طلبات دخول مدير المنصة` and allow the request.
7. Return to the Super Admin session; the request polling enters Company A automatically.
8. Confirm the header still identifies the actor as `Super Admin · Company Access`.
9. Use `الخروج من الشركة` to revoke the temporary access session and return to the platform.
10. Repeat with a company that has no active Company Admin to verify direct access.
11. Log in as Employee A and attempt to access an Employee B record by ID. The server must return `404`/deny because the company context is A.

## Security notes

- Password hashes never reach the browser.
- Authentication does not use localStorage.
- Company IDs supplied by the browser are not trusted for authorization.
- Company-scoped queries use the server-side authenticated company context.
- Platform company access does not alter Super Admin identity or create company membership.
- Audit logs are append-only from the application surface; there is no delete/update endpoint for users.
- IP and user-agent values are hashed before storage where available.

## Local verification commands

```bash
npm run typecheck
npm run build
```

Run the worker locally after a local D1 migration:

```bash
npx wrangler dev
```

No deployment is performed by this repository change.

## Phase 3 preparation

The schema already supports:

- multiple company roles per user,
- individual allow/deny permission overrides,
- permission scopes,
- company-specific roles,
- future workflow authorization,
- future transaction and payroll modules without changing the authentication identity model.

The workflow engine itself is intentionally not implemented in Phase 2.
