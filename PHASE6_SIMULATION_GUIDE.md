# Phase 6 — Workflow Simulation Guide

## What the new simulation does
- Does not create users.
- Does not create employees.
- Does not create a second D1.
- Creates a real transaction record explicitly marked in its JSON payload as `_simulation=true`.
- Uses the active workflow of the selected transaction type.
- Starts without an employee.
- Uses the existing Company Admin account for processing.

## Full workflow template
Super Admin → Platform → سير العمل → select an existing transaction type → **تجهيز Workflow كامل**.

The template creates a new active workflow version without deleting the previous workflow. It contains:
1. تقديم الطلب
2. مراجعة الطلب
3. الاعتماد النهائي

It also configures:
- stage duration
- Company Admin responsibility
- submitter restriction
- required request title
- review Yes/No question
- conditional approval path
- return path
- rejection
- cancellation
- final completion
- employee feedback on the review stage

## A-Z test
1. Super Admin selects the existing transaction type.
2. Super Admin clicks تجهيز Workflow كامل.
3. The new workflow version becomes active; old versions remain for history.
4. Company Admin opens المعاملات.
5. Selects the transaction type in نوع المحاكاة.
6. Clicks محاكاة سير العمل.
7. A new transaction is created with no employee.
8. Stage 1: click إرسال للمراجعة.
9. Stage 2: answer نعم to move to final approval, or لا to return to Stage 1.
10. Stage 3: click إكمال واعتماد to complete, or return/reject/cancel as configured.
11. The transaction detail page shows the immutable stage history and action/audit history.
