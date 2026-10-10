# Phase 6 — Enterprise Runtime Implementation

Implemented on the existing HR Nexus Phase 1–5 baseline without resetting or replacing the project.

## Added
- Employee runtime: قائمة الطلبات → طلب جديد → اختيار المعاملة المفعلة → بيانات الطلب → إرسال.
- Real D1 transaction creation and per-company transaction numbering starting at 1.
- Published workflow activation per company by Super Admin.
- Company Admin configuration: who may submit and actual stage assignees; workflow logic remains immutable.
- Full workflow path display for employees and stage execution history.
- Requester/subject separation using the existing Phase 5 employee master.
- Ordered conditional transitions with automatic next-stage fallback.
- Return to configured previous/target stages, preserving execution history.
- Immutable answer history for repeated stage execution.
- Rejection/cancellation as terminal statuses; return remains an action/history event.
- Actual-hour stage deadlines, overdue state data and in-product workflow notifications foundation.
- Delegation with return to the original stage after delegated work completes.
- Dynamic stage responsibility resolution for direct manager, department manager, position holder, role, permission, company admin and employee owner.
- Company isolation and server-side authorization for runtime routes.
- Company workflow settings UI.

## New migrations
- `0013_phase6_runtime_company_activation.sql`
- `0014_phase6_answer_history.sql`
- `0015_phase6_delegation.sql`

## Important verification note
The container could not complete `npm install` within the available execution window, so the repository's full `npm run typecheck` / `npm run build` could not be executed against installed dependencies in this environment. SQL syntax for the three new migrations was executed successfully against SQLite, and TypeScript/JSX files were parsed by `tsc --noResolve` without syntax diagnostics.

No claim is made that remote D1 deployment or production browser testing was performed here.
