# Phase 6 v15 — Stability / Step 2 Fix

## Fixed runtime error
The v14 Studio editor referenced an undeclared `sq` variable while calculating validation issues. The reference was in the legacy question validation branch even though the Studio had already unified questions into fields. This caused the React ErrorBoundary to show:

> حدث خطأ غير متوقع في الواجهة. أعد المحاولة دون فقدان جلسة المستخدم.

The legacy question validation branch is now removed from the Studio validation path. Legacy questions are still converted to fields when an old workflow is opened.

## Reduced UI churn
- Creating a template no longer performs an unnecessary full Studio reload before entering the requester step.
- The newly-created template is inserted into local Studio state immediately.
- URL navigation to the new template is marked as an intentional local navigation so it does not trigger a second `openType()` network load.
- Re-opening the same type is guarded against duplicate concurrent loads.
- Refreshing the template/company lists after publish/reset no longer activates the initial full-page loading state.
- The editor footer no longer advances to the next step when saving failed.

## Scope
No R2 binding was added. Phase 1–5 data and architecture are untouched.
