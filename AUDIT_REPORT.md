# HR Nexus — Full Project Audit & Root-Cause Fix Report

## Scope

Audited the uploaded HR Nexus project without changing the existing framework, route structure, Arabic RTL UI, D1/Workers/Hono architecture, or authentication model.

## Root causes found

### 1. Super Admin company-management white screen

**Root cause:** `src/client/pages/PlatformCompanies.tsx` referenced several state variables and a navigation function that were never declared:

- `security`
- `setSecurity`
- `securityBusy`
- `securityError`
- `setSecurityError`
- `currentPassword`
- `setCurrentPassword`
- `cleanConfirmation`
- `setCleanConfirmation`
- `navigate`

The browser's first failure was therefore `ReferenceError: security is not defined`. This was not caused by `src/server/middleware/security.ts`.

**Fix:** Restored the missing component state and `useNavigate()` binding, and replaced the DOM lookup for the cleanup confirmation with controlled React state.

### 2. Session expiry comparison was vulnerable to SQLite timestamp-format mismatch

Session expiry values are written as ISO timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`), while SQLite `CURRENT_TIMESTAMP` is formatted with a space separator. Direct text comparisons such as `expires_at > CURRENT_TIMESTAMP` can therefore produce incorrect results for timestamps on the same calendar day.

**Fix:** Session and company-access expiry checks now use SQLite `datetime(...)` conversion before comparison.

### 3. Security headers were not guaranteed on early/exceptional responses

The security middleware applied headers only after `await next()`, while CSRF rejection returned before that point.

**Fix:** Centralized header application and use `try/finally`, while explicitly applying the headers on CSRF-blocked responses.

### 4. Protected platform/company-management URLs relied too heavily on API denial

The server already protects platform APIs, but the client could render platform pages for users who should not have access and then depend on API failures.

**Fix:** Added a lightweight route-level guard in the existing `AppShell`. Platform management requires a platform session outside company-access mode; company access-request management requires the Company Admin role. No routes were renamed or removed.

### 5. Platform company page did not have a page-level API failure state

The company list silently converted a failed request into an empty-looking page.

**Fix:** Added an existing `ErrorState` presentation for company-list failures.

### 6. Application-level white-screen containment

The application had no top-level React error boundary.

**Fix:** Added a last-resort application error boundary. It logs the component error and presents a recovery UI. It does not replace root-cause fixes or suppress server errors.

## Authentication/session audit findings

Verified from source:

- Separate platform and company session types are preserved.
- Session tokens are random values and only SHA-256 token hashes are stored.
- Cookies are HttpOnly, Path=/, SameSite=Lax, and Secure in HTTPS requests.
- Logout revokes the current platform/company session and temporary company-access session and clears both cookies.
- Logout-all revokes all `sessions` and `company_access_sessions` without deleting users or business data.
- Company access is tied to the authenticated Super Admin identity.
- Company user session loading derives the company from the server-side user record rather than trusting a frontend company ID.
- Activity timestamps already use `COALESCE(last_activity_at, created_at, CURRENT_TIMESTAMP)` defensively.
- Notification loading in `/api/context` is isolated in a `try/catch`; notification failure returns an authenticated context with an empty notification list.
- Worker-level API errors are converted to JSON `{ "error": "SERVER_ERROR" }` and logged server-side.
- Password-change gating remains server-side through the existing middleware.
- Company login is case-insensitive for company identifier and supports username or employee ID as implemented by the existing API.

### About the observed `/api/auth/login 401`

A 401 from `/api/auth/login` is intentionally returned by the current API for invalid credentials. The uploaded source does not provide enough live information to determine whether the credentials being entered in the deployed environment are correct. Therefore this audit does **not** label the 401 itself as a verified credential bug.

The session-expiry defect above was verified in source and fixed, but it affects existing-session validation rather than the credential-verification branch of `/api/auth/login`.

## Multi-tenant audit

Verified:

- Employee list/detail queries use the authenticated session's `activeCompanyId`.
- Organization queries use the authenticated session's `activeCompanyId`.
- Company-admin access-request decisions are scoped by the authenticated company session.
- Super Admin company-access requests are server-authorized and use the URL company ID only within a `requireSuperAdmin` route.
- Company access status loading is bound to the authenticated Super Admin ID.
- Company password changes/resets are scoped by both user ID and company ID.
- Notifications are scoped by both company ID and authenticated company user ID.

No frontend-supplied company ID was found being used to establish a normal Company User's tenant context.

## Cleanup audit

The existing destructive operation remains protected by:

1. The authenticated Super Admin session.
2. The current Super Admin password.
3. Exact `CLEAN_ALL_DATA` confirmation.

The existing FK-safe deletion order is preserved. It keeps:

- the current Super Admin account;
- the permissions catalogue;
- the current platform session.

It does not intentionally disable authentication or authorization to perform the cleanup.

## Files changed

1. `src/client/pages/PlatformCompanies.tsx`
   - Restored missing React state and navigation.
   - Added controlled cleanup confirmation state.
   - Added API failure state.
   - Replaced full browser logout navigation with React Router navigation.

2. `src/client/components/AppShell.tsx`
   - Added route-level authorization guards for platform management and company access requests.
   - Reused the existing forbidden-state UI.

3. `src/client/main.tsx`
   - Added an application-level React error boundary.

4. `src/server/auth/session.ts`
   - Corrected SQLite-safe session/access expiry comparisons.

5. `src/server/middleware/security.ts`
   - Ensured security headers are applied consistently, including CSRF-blocked/error paths.

## Existing architecture preserved

No replacement was made for:

- Cloudflare Workers
- D1
- Hono
- React
- React Router
- existing routes
- existing database tables
- existing authentication/session model
- existing Arabic RTL UI
- existing sidebar/layout
- existing Super Admin/company-admin functionality

## Verification status

### VERIFIED

- Uploaded project extracted and inspected.
- All 31 TypeScript/TSX source files pass TypeScript transpilation/syntax diagnostics.
- The exact `security` undeclared-reference source was found and removed.
- The missing platform-page state variables are now declared.
- The missing `navigate` binding is now declared.
- No `window.location` / `location.reload` references remain in the frontend source.
- All current migrations execute successfully against an in-memory SQLite database.
- The production Super Admin migration creates the expected `superadmin` record with `must_change_password=1`.
- Cleanup SQL ordering was exercised against a representative FK graph; the remaining current-Super-Admin/permission preservation behavior was validated against the schema.
- Session expiry checks now normalize ISO timestamps through SQLite `datetime(...)`.
- `/api/context` notification failure isolation is present in source.
- Worker API error handling returns JSON for API exceptions.

### NOT VERIFIED

- `npm install`: the environment timed out while installing dependencies.
- `npm run typecheck`: could not be completed because the dependency/type packages were not installed.
- `npm run build`: could not be completed because the dependency installation did not finish.
- Generated production bundle inspection: not available because the production build could not be produced.
- Live Cloudflare Worker/D1 requests.
- Live Super Admin login.
- Live Company Admin login.
- Live page refresh/session persistence against the deployed Worker.
- Live cross-tenant authorization tests.
- Live logout-all and cleanup against the production D1.

No live test is represented as passed where the environment could not execute it.

## Acceptance matrix

| Test | Super Admin | Company Admin | Employee |
|---|---|---|---|
| Login | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Logout | VERIFIED by source | VERIFIED by source | VERIFIED by source |
| Session persistence | VERIFIED by source; live NOT VERIFIED | VERIFIED by source; live NOT VERIFIED | VERIFIED by source; live NOT VERIFIED |
| Page refresh | VERIFIED by source; live NOT VERIFIED | VERIFIED by source; live NOT VERIFIED | VERIFIED by source; live NOT VERIFIED |
| Direct URL | VERIFIED by route/auth structure | VERIFIED for protected routes; live NOT VERIFIED | VERIFIED for protected routes; live NOT VERIFIED |
| Platform | VERIFIED by route + server guard; live NOT VERIFIED | DENIED by route guard/API | DENIED by route guard/API |
| Company management | VERIFIED by server guard; live NOT VERIFIED | restricted to own company context | denied |
| Company isolation | VERIFIED by source audit; live NOT VERIFIED | VERIFIED by source audit; live NOT VERIFIED | VERIFIED by source audit; live NOT VERIFIED |
| Permissions | VERIFIED by source path; live NOT VERIFIED | VERIFIED by source path; live NOT VERIFIED | VERIFIED by source path; live NOT VERIFIED |
| Logout all | VERIFIED by source | scope governed by role/API | scope governed by role/API |
| Cleanup | VERIFIED by source/schema simulation | DENIED | DENIED |

The complete corrected project is the deployable replacement package accompanying this report.
