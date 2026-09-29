# HR Nexus — Phase 6 Workflow Studio

Phase 6 is implemented as a generic workflow/transaction foundation with a platform-only **استوديو سير العمل** and an isolated **بيئة الاختبار**. Company transaction screens remain intentionally unavailable.

## Studio experience
- Template list is the landing screen.
- Creating a template is a full-page form, not a prompt/modal flow.
- Every template starts as a Draft and creates the first stage automatically.
- The transaction foundation is separated into:
  - requester data selected from the real Phase 5 employee model
  - optional subject employee, defaulting to the requester
  - designer-created request questions/data
  - dynamic stages
- System data is selected from a server-defined Phase 5 catalog. The designer never types system source keys.
- Examples include employee number, full name, job title, organization unit, position, manager, hire date, actual start date, contract data, salary components, GOSI and insurance data.
- Sensitive data is marked in the Studio and must still respect runtime permissions when actual transactions are enabled.
- Default stage-to-stage movement is implicit. Conditional routes are only added when a branch is actually needed.
- The last actual stage completes the transaction; no artificial "final stage" exists.

## Preview vs Test
- Preview is read-only visual rendering of the designed workflow.
- Test is an A→Z behavioral simulation and does not create users, employees, transactions or runtime history in D1.

## Draft and validation
- Draft save accepts incomplete stage responsibility so a new draft can be safely saved.
- Publish requires full model validation.
- Schema validation failures return an error code, reference ID and safe field-level issues.

## Database
- `0010_phase6_rebuilt_engine.sql` provides Phase 6 indexes/reference permissions.
- `0011_phase6_studio_settings.sql` adds only `workflow_settings`.
- `db/PHASE6_FINAL_SYNC.sql` is the non-destructive manual synchronization script.
- No Phase 1–5 data is dropped or recreated.
