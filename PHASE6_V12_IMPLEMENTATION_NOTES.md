# HR Nexus Phase 6 — Transaction Studio v12

Implemented on top of v11 without rebuilding the app and without R2.

## Studio
- Added a dedicated transaction edit/control screen.
- "تعديل المعاملة" opens the control screen instead of jumping directly into a stage.
- Studio reset remains A-Z for Phase 6, including drafts, workflow definitions, stages, fields, questions, transitions, transactions and sequences.
- Submitter selection is now clear checkboxes instead of a comma-based selector.
- Select/multiselect options are entered as separate rows, not comma-separated text.
- Added an explicit "الموظف المرتبط" requester element.
- Employee requester element is optional and, when present, is selected from real company employees by employee number/name.
- Added requester questions as first-class workflow questions.
- Requester questions are not assigned to a processing stage.
- Each processing stage still has its own responsibility, duration, fields, questions/decisions and routing.
- Automatic routing defaults to the next stage; final-stage manual "next" routes are prevented.
- Conditions can select fields/questions from requester data or current/prior stages. Yes/No sources use a Yes/No value selector.
- Publishing can copy the latest active or draft template workflow, avoiding WORKFLOW-006 when a template only has a draft.

## End-user transaction flow
- Creating a transaction now asks only requester data + requester questions.
- Stage 1 questions are not answered by the requester; they appear when the stage owner receives the transaction.
- Transaction detail now presents requester system information first, linked employee, requester data/questions, then the current stage.
- Linked employee is persisted to `transactions.employee_id` from the requester employee field.

## Database migration
`db/migrations/0009_phase6_requester_questions.sql`

This preserves existing workflow questions and changes `workflow_questions.stage_id` to nullable so requester questions can exist before Stage 1.

## Validation performed
- TypeScript transpile diagnostics: OK for the four modified TS/TSX files.
- Migration was syntax/behavior checked against a SQLite test schema, including preservation of an existing stage question and insertion of a requester question with `stage_id = NULL`.
- Full `npm run typecheck` / Vite build was not run because this extracted project does not contain `node_modules`.
- `wrangler.jsonc` contains no R2 binding.
