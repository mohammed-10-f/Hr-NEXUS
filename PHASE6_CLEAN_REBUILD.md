# HR Nexus Phase 6 — Clean Studio Rebuild

## Scope
- Replaced the Phase 6 Workflow Studio editor with a new four-step model:
  1. تعريف المعاملة: الاسم + الوصف + من يستطيع التقديم + بيانات مقدم الطلب + الموظف المعني + عناصر الطلب.
  2. المراحل والعناصر: dynamic stages and per-stage elements.
  3. الشروط والانتقالات: conditions belong to the selected stage; each condition selects an element by name, operator, value and target stage.
  4. المراجعة والاختبار: complete map, validation, save, test, publish.
- Test is strictly read/simulation only and receives an exact saved draft workflow ID.
- `حفظ واختبار` saves the complete definition before navigation; test cannot silently discard unsaved stages/elements.
- Opening a template after publication now creates a draft by cloning the active version instead of creating an empty draft.
- Draft saves are chunked to avoid oversized D1 batch operations.
- Super Admin test requester data is resolved from the current real platform account for account-level fields; Phase 5 employee fields are never fabricated.
- Phase 6 migration `0016_phase6_clean_rebuild.sql` clears Phase 6 data only. Phase 1–5 tables/data are untouched.

## Conditions
- Conditions are independent per stage.
- First matching condition wins.
- The condition UI uses the element's human-readable name.
- Previous-stage elements can be used by later-stage conditions.
- A target stage is explicitly selected.
- No self-loop is permitted.

## Persistence rule
The workflow definition is not stored in browser state only. The Studio saves it to D1 before test/preview. The test environment does not create or delete operational transactions.

## Verification performed
- TypeScript syntax/transpile check: OK for the modified Phase 6 client/server files.
- All SQL migrations were executed against a temporary SQLite database in migration order: OK.
- After migration 0016, Phase 6 tables are empty as intended.
- Full Vite/Cloudflare build was not executed locally because the environment has no installed `node_modules`, and `npm install` timed out. Therefore no unverified build-pass claim is made.
