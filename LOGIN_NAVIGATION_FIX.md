# Login Navigation Fix

This patch preserves the existing HR Nexus architecture and D1 database.

Changes:
- Login now uses React Router navigation instead of `window.location.assign`, avoiding a full document reload after successful authentication.
- Mandatory password-change navigation also uses React Router instead of a full-page reload.
- AppShell only redirects to `/login` when `/api/context` explicitly returns `AUTH_REQUIRED`.
- Other context/session failures are shown as a retryable error instead of silently redirecting and clearing the application state.
- Context requests are guarded against stale async responses after navigation.

No database schema, authentication model, or application routes were replaced.


## Logout/session recovery fix
- Logout now always navigates to `/login`, even if the revoke request encounters a transient server error.
- The client clears its in-memory context before navigation, preventing the protected shell from rendering a stale session error during logout.
- Server logout revokes both the main session and any active company-access session and expires both cookies.
