# HR Nexus — Change Password / Session Loading Fix

## Problem fixed
The mandatory change-password page was nested inside `AppShell`, which first required `/api/context` to load successfully. If the context request briefly failed after login, the user could never reach the password-change form and saw `تعذر تحميل الجلسة`.

## Fix
- `/change-password` is now outside `AppShell` and can load directly after successful authentication.
- `AppShell` no longer reloads `/api/context` on every route change.
- Context loading retries transient failures up to three times before showing an error.
- A real `AUTH_REQUIRED` response still sends the user to `/login`.
- Existing D1, authentication, session, permissions, and UI architecture are preserved.
