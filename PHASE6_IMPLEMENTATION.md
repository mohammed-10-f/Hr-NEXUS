# HR Nexus Phase 6 — Workflow Studio

## Scope
Phase 6 is a generic Workflow / Transaction Engine foundation. The current UI exposes only the Workflow Studio and its isolated Test Environment. Company transaction screens are intentionally not exposed in the sidebar or routes for normal users.

## Studio model
1. Template identity: name, description, who may submit.
2. System data: the designer selects requester and optional target-employee fields from the real HR Nexus data catalog. The selection stores the source mapping only; it does not duplicate employee data.
3. Request data: only fields explicitly added by the designer appear. There are no hidden automatic notes or fields.
4. Dynamic stages: each stage has its own name, responsibility, duration, fields and routes. Stage order is persisted in D1.
5. Default routing: when no special route is configured, the engine uses the next persisted stage. A conditional route may branch to a configured target stage.
6. Final completion: after the last real stage is successfully passed, the transaction becomes `مكتملة`. No synthetic "last stage" is created.

## System-data catalog
The catalog is exposed by `/api/workflows/admin/catalog` and contains mappings such as:
- employee number
- full name
- national ID / residency
- job title
- actual start date
- join date
- organization unit
- position
- direct manager
- work location
- employment and contract data
- salary components
- GOSI / residency data

Sensitive entries declare their required existing permission and remain subject to backend authorization at runtime.

## Database
`0011_phase6_system_data_catalog.sql` adds only:
- `workflow_system_fields`
- `workflow_request_settings`

Both are scoped to workflow definitions and use foreign keys with cascade to Phase 6 parents only.

## Error handling
Workflow input validation returns `WORKFLOW-001` together with a reference ID and safe validation details. The Studio converts those details into a human-readable issue and jumps to the affected stage/field when possible.

## Test Environment
The Test Environment is isolated. It reads workflow definitions but does not insert real users, employees, transactions, answers or execution history into D1.
