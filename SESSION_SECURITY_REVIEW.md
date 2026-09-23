# HR Nexus — Session Architecture & Platform Security Fix

## Root-cause fixes
- Session loading now tolerates legacy/null activity timestamps by using COALESCE(last_activity_at, created_at, CURRENT_TIMESTAMP).
- Company-access session activity uses the same defensive fallback.
- `/api/context` treats notifications as optional data; a notification query failure no longer destroys an otherwise valid authenticated session response.
- Worker API errors are returned as JSON with a stable SERVER_ERROR code and logged server-side.
- `/platform` is now a real platform route and opens the existing company-management screen instead of falling into the generic wildcard page.
- Company access navigation uses React Router instead of a full browser reload.

## Platform security controls
- `تسجيل الخروج للجميع`: revokes all platform/company sessions and all temporary company-access sessions without deleting accounts or business data.
- `تنظيف جميع البيانات`: destructive operation protected by the current Super Admin password plus the exact confirmation phrase `CLEAN_ALL_DATA`.
- Cleanup removes tenant/business operational data while preserving:
  - the `superadmin` platform account
  - the system permission catalogue
  - the current Super Admin platform session
- Cleanup removes other platform users.
- Cleanup order is FK-safe for the Phase 2 schema and does not delete the permissions catalogue.

## Verification
- Source-level syntax/bracket checks passed for modified TypeScript/TSX files.
- Cleanup SQL was executed successfully against an in-memory SQLite database using the project's Phase 2 migrations.
- The simulation confirmed companies, company users, roles, role assignments and other operational records can be removed while the intended Super Admin and permissions remain.
- The actual Cloudflare D1/Worker cannot be live-tested from this environment because Cloudflare credentials are not available here.
- `npm install` timed out in this environment, so a full `npm run build` / `npm run typecheck` is not claimed as passed.
