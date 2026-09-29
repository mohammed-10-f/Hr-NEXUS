# HR Nexus Phase 6 — Transaction Studio v13

This version restructured the Phase 6 product UX around the agreed workflow model instead of continuing incremental UI patches.

## Studio model
- Studio home is a template library, not a list of test transactions.
- Creating a transaction starts with only name, optional description, and submitter permissions.
- Editing a published template creates a new draft workflow version before changes are saved, preserving the published workflow used by existing transactions.
- Drafts remain editable; activating a draft makes it the active version and future edits create another draft.

## Requester model
- The requester is the person who submits the transaction.
- By default the transaction belongs to the requester employee.
- A special requester field type `employee` is available as **الموظف المعني** for transactions that can concern another employee.
- At runtime that field uses the existing employee search by employee number/name.
- No requester note field is injected automatically.
- Select/multiselect options are individual rows, not comma-separated text.
- Requester questions are a single **الأسئلة والقرارات** block and are answered before the first processing stage.

## Stage model
Each stage is one unit containing:
- responsible party
- duration
- stage fields
- **الأسئلة والقرارات**
- routing rules

The default route is always the next stage. Conditional routes are represented as:
**الحقل → القيمة → الأثر**.

The effects are:
- الانتقال إلى مرحلة
- إرجاع إلى مرحلة
- مكتملة
- مرفوضة
- ملغية

The engine keeps a single end-user action: **تمرير المعاملة**. The server evaluates the matching workflow route and applies the configured effect.

## Reset
- Studio reset deletes Phase 6 transaction types and their workflow tree, transactions, sequences and cascaded children.
- The Studio reset also clears the browser-local test sessions and draft-step state.
- Companies, employees, users, roles and permissions are preserved.

## End-user transaction page
The reading order is now intentionally:
1. transaction header/status
2. requester system profile
3. requester data and answers
4. current stage
5. stage data
6. stage questions/decisions
7. single pass action
8. immutable journey/audit history

## Runtime change
If a transaction does not specify a special employee field, the server now sets `transactions.employee_id` to the requester's employee automatically. A selected `employee` requester field overrides that default after company/status validation.

## Validation
- Red errors block saving/publishing.
- Yellow warnings explain optional risks.
- Green state indicates no structural errors.
- Validation items navigate to their relevant editor section/stage.

## R2
No R2 binding was added. `wrangler.jsonc` remains free of R2 configuration.

## Verification
- TypeScript transpile diagnostics checked for modified TS/TSX files: no diagnostics.
- Full `npm run typecheck` and Vite build were not run because the extracted project does not contain `node_modules`.
