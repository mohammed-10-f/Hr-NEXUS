# HR Nexus — Phase 5 Employee Master Data

Implemented as a non-destructive extension of the approved baseline.

## Scope
- Real employee create/edit/list/profile APIs.
- Employee number uniqueness preserved by the existing `(company_id, employee_number)` constraint.
- National ID is non-unique and duplicate IDs are flagged.
- Employment/contract/probation data.
- Phase 4 organization/position integration; direct manager is derived from the position's manager position.
- Salary history, one active bank account, GOSI/insurance profile, leave balances, career history.
- Company-configurable employee fields and contract types.
- Company-scoped permissions and organization scope checks.
- Employee account creation uses the existing company authentication system and PBKDF2 hashing; temporary password is never stored in plaintext.
- Hourly probation maintenance marks overdue undecided probation as passed.
- No attendance implementation.

## Important verification note
The production D1 is configured in `wrangler.jsonc` with database id `6010e3ea-b8a7-44a6-bf79-bb45bdcba837`. A live `wrangler d1 execute --remote` inspection was attempted during implementation but timed out in the execution environment. Therefore the final report must distinguish project/migration verification from live remote-D1 verification.

No employee/demo records are inserted by migration 0007.
