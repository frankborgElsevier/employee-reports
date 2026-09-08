# Implementation Review: 005-headcount-manager-context

**Status:** Approved
**Date:** 2026-08-31
**Reviewed HEAD:** unavailable (not a git repository)
**Review baseline:** unavailable (not a git repository)
**Scope confidence:** Limited - no git repository, so there is no diff-based confirmation that only the declared files changed. Scope was taken from `implementation-summary.md`'s Files Created/Modified lists and independently verified by directly reading the full current content of every listed source and test file against `spec.md`'s FR/AR text (not just trusting the summary's own adherence table).

## Reviewed Scope

- `src/db/schema.ts`, `src/db/connection.ts`, `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts`, `src/db/index.ts` — the new table/column, migration step, types, query, and mutations (AR-2.1-AR-2.3)
- `test/db/externalManagers.test.ts`, `test/db/lifecycle.test.ts` — DB-layer and migration test coverage
- `src/import/types.ts`, `src/import/parseWorkbook.ts`, `src/import/reconcile.ts` — optional-column capture and the aggregate-then-write reconciliation sequence (FR-2.1-FR-2.3, AR-2.2)
- `test/import/parseWorkbook.test.ts`, `test/import/reconcile.test.ts` — import-pipeline test coverage
- `src/server/app.ts` — the `GET /api/headcount` merge/unification (FR-2.4, AR-2.3)
- `test/server/headcount.test.ts` — route test coverage, including the fixed pre-existing five-field assertion
- `public/chart-logic.js`, `public/headcount.html` — `teamSizes`, the manager-first comparator, and rendering (FR-1.1-FR-1.2, FR-2.5-FR-2.6, FR-3.1-FR-3.2, AR-1.1-AR-1.2, AR-2.4, AR-3.1)
- `test/dashboard/chartLogic.test.ts` — client-logic test coverage
- `specs/features/005-headcount-manager-context/ADR.md` — the schema-migration decision record
- Living docs (`specs/docs/standards/headcount-http-api.md`, `standards/data-schema.md`, `domains/headcount-dashboard/index.md`, `domains/data-foundation/index.md`, `domains/workday-import/index.md`, `strategies/index.md`, `spec-index.md`) — spot-checked for accuracy against the actual implemented code, not just internal consistency

## Evidence

- Spec: `specs/features/005-headcount-manager-context/spec.md`
- Implementation summary: `specs/features/005-headcount-manager-context/implementation-summary.md`
- ADR: `specs/features/005-headcount-manager-context/ADR.md`
- Validation: `npm run typecheck` (clean) and `npm test` (188/188) re-run directly during this review, matching the summary's recorded results. No additional ad hoc scripts were needed — every requirement traced cleanly to a specific line range and a specific test, and the summary's live-verification narrative (real pre-existing database migrated in place, real reference workbook imported via the actual preview/confirm HTTP flow, rendered dashboard and Employee Details screens checked) was independently plausible against the code read, not re-run from scratch in this review.

## Requirement Coverage

| Requirement | Review evidence | Result |
| --- | --- | --- |
| FR-1.1 | `public/chart-logic.js:63-106` (`buildTree`'s `teamSizes`), `public/headcount.html:107-110` (`renderCard`); `test/dashboard/chartLogic.test.ts` 3-level-chain test | Covered |
| FR-1.2 | `public/headcount.html:107-110` (`size > 0` guard); `chartLogic.test.ts` zero-report test | Covered |
| FR-1.3 | Inherited by construction — `teamSizes` is computed only from the `employees` array `/api/headcount` returns, which was already active-only before this spec (`getAllEmployees()` default, unchanged) | Covered |
| AR-1.1 | `public/chart-logic.js:82-105` — genuine O(n) state-tagged-stack post-order traversal, verified correct by trace (children always resolved before their parent's exit frame is popped) | Covered |
| AR-1.2 | `public/headcount.html:92-113`, `121-122` (`renderChart` reuses the single `buildTree` call and threads `teamSizes` through) | Covered |
| FR-2.1 | `src/import/parseWorkbook.ts:68-76,118-123` (optional detection, generalized duplicate check, blank/whitespace handling); `src/import/types.ts:12`; 5 tests in `test/import/parseWorkbook.test.ts:165-230` | Covered |
| FR-2.2 | `src/import/reconcile.ts:57-84` (aggregation pass, most-frequent-then-`localeCompare` tie-break, one write per distinct id); `test/import/reconcile.test.ts:79-110` | Covered |
| FR-2.3 | `src/import/reconcile.ts:86-103`; `test/import/reconcile.test.ts:112-161` (no-name case, self-heal, inactive-manager-unchanged) | Covered |
| FR-2.4 | `src/server/app.ts:91-140`; `test/server/headcount.test.ts:113-196` (unification, omission, ordering, collision guard) | Covered |
| FR-2.5 | `public/headcount.html:92-113` (external branch: no position/country, fixed label, `card external` class); `managerList()` unchanged, verified by `chartLogic.test.ts:200-` | Covered |
| FR-2.6 | `public/headcount.html:169-171` (filter at the `renderTotals` call site, `totals()` itself untouched) | Covered |
| AR-2.1 | `src/db/schema.ts:1-15`, `src/db/types.ts:1-15`, `src/db/queries.ts:40-57` | Covered |
| AR-2.2 | `src/import/reconcile.ts:57-103` (aggregation before per-row write); `src/db/mutations.ts:184-214` (the two gated mutations); `ADR.md` | Covered |
| AR-2.3 | `src/db/queries.ts:208-216`, `src/db/index.ts:11,20-21`, `src/server/app.ts:91-140` (application-code filtering, no dynamic SQL `IN`) | Covered |
| AR-2.4 | Confirmed by reading `buildTree`/`isRoot`/`visibleIds`/`managerList` — none of the three pre-existing functions besides `buildTree` (which only gained the unrelated `teamSizes`/comparator additions) were touched | Covered |
| FR-3.1 | `public/chart-logic.js:38-45,77-80`; `test/dashboard/chartLogic.test.ts:135-168` — the test deliberately uses a case where plain alphabetical order would disagree, so it actually exercises the new comparator rather than passing coincidentally | Covered |
| FR-3.2 | `managerList()` untouched (uses `byNameThenId` directly, never reads `buildTree`'s ordering); Employee Details screen/route untouched (no file in `src/server/app.ts`'s `/api/employee-details` handler or `public/employeeDetailsLogic.js` was modified) | Covered |
| AR-3.1 | `public/chart-logic.js:38-45` | Covered |

## Findings

| Severity | Evidence | Finding | Required action |
| --- | --- | --- | --- |
| suggestion | `public/chart-logic.js` `teamSizes` computation; no test in `chartLogic.test.ts` combines an inactive employee with a `teamSizes` count | FR-1.3's "inactive employees excluded from the count" is correct by construction (an inactive employee is never in the array `buildTree` receives) but has no test that exercises the two features together — only argued from the pre-existing, separately-tested active-only filter. Low risk since no new code path could reintroduce an inactive employee into that array. | Optional: add one `chartLogic.test.ts` case building a payload that already excludes an inactive employee and asserting the surviving manager's `teamSizes` reflects only the active reports, purely for documentation value — not required for approval. |

## Verdict

No blocking findings. Every FR and AR traces to specific, correctly-implemented code and a test that genuinely exercises the requirement rather than passing coincidentally (notably `FR-3.1`'s comparator test, which is constructed so that plain alphabetical order would produce a different result). The one identified issue in the original spec draft — the `manager_id` foreign-key conflict caught during spec review — was resolved correctly in the implementation via the separate `external_manager_id` column and API-layer unification, exactly as the revised spec describes; `AR-2.4`'s claim that no changes were needed to `buildTree`/`isRoot`/`visibleIds`/`managerList` holds up on direct inspection. The novel schema-migration decision (`ADR-001`, a guarded additive `ALTER TABLE ADD COLUMN` rather than the pre-existing reject-and-reimport pattern) is sound, tested against both a fresh database and a hand-crafted pre-existing one, and consistent with the stated rationale of preserving multi-year salary/rating history. Living docs were spot-checked and accurately reflect the shipped behavior, including the domain page's now-corrected "11 roots" example. The one finding above is a documentation-value suggestion, not a defect, and does not block approval.

Next: `/spec-close 005-headcount-manager-context`
