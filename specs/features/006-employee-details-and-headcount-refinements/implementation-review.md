# Implementation Review: 006-employee-details-and-headcount-refinements

**Status:** Approved
**Date:** 2026-08-31
**Reviewed HEAD:** unavailable (not a git repository — confirmed via `git status`)
**Review baseline:** unavailable (same reason; implementation-summary.md records the same limitation)
**Scope confidence:** High — the implementation summary's declared file list was independently
cross-checked against every file actually modified since `spec.md` was written (via
`find ... -newer spec.md ! -newer implementation-summary.md`); the two sets match exactly, with
no undeclared files and no scope creep.

## Reviewed Scope

- `src/import/types.ts`, `src/import/parseWorkbook.ts`, `src/import/reconcile.ts` — Feature 2's import pipeline (FR-2.1, AR-2.3)
- `src/db/schema.ts`, `src/db/connection.ts`, `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts` — Feature 2's schema, migration, and write/read path (AR-2.1, AR-2.2, FR-2.2)
- `src/server/app.ts` — Feature 2's `/api/employee-details` payload change (FR-2.3)
- `public/chart-logic.js` — Feature 1's `visibleIds` option (AR-1.1) and Feature 3's new exports (AR-3.1)
- `public/employeeDetailsLogic.js`, `public/employee-details.html` — Feature 1's `visibleRows`/isolation wiring (AR-1.1, FR-1.1, FR-1.2) and Feature 2's column/sort/validation additions (FR-2.4, FR-2.5)
- `public/headcount.html` — Feature 3's rendering and CSS (FR-3.4, AR-3.2, AR-3.4)
- `test/import/parseWorkbook.test.ts`, `test/import/reconcile.test.ts`, `test/db/salary.test.ts`, `test/server/employeeDetails.test.ts`, `test/dashboard/chartLogic.test.ts`, `test/employeeDetails/employeeDetailsLogic.test.ts` — all six touched test files, read in full
- `specs/docs/standards/employee-details-http-api.md`, `specs/docs/standards/data-schema.md`, `specs/docs/domains/employee-details/index.md`, `specs/docs/domains/headcount-dashboard/index.md`, `specs/docs/spec-index.md` — living-docs updates, checked for accuracy against the actual shipped behavior, not just presence

## Evidence

- Spec: `specs/features/006-employee-details-and-headcount-refinements/spec.md`
- Implementation summary: `specs/features/006-employee-details-and-headcount-refinements/implementation-summary.md`
- Validation:
  - `npm test` re-run during this review: 234/234 pass (matches the summary's recorded figure)
  - `npm run typecheck`: clean
  - Direct code inspection of every file in Reviewed Scope, including re-deriving several
    non-trivial test expectations by hand against the actual `classifyPositionBand`/
    `positionRegionBreakdown`/`visibleIds`/`visibleRows` logic (not just re-running the suite)
  - A targeted regression sweep: `grep -rn "visibleIds("` and `"visibleRows("` across
    `public/`, `test/`, `src/` to confirm every call site (including ones not mentioned in the
    summary) either received the new required argument or was deliberately left unchanged
    (`headcount.html`'s `visibleIds(employees, selected)` — 2 args, confirming AR-1.2's
    "Headcount Dashboard unaffected" claim by inspection, not just by assertion)
  - An isolated experiment (reverted immediately after, no product/test change retained):
    removed the `as never` casts in `employeeDetailsLogic.test.ts`'s `rootManagerIdsOf` helper
    and re-ran `npm run typecheck` to confirm whether they were load-bearing (finding below)

## Requirement Coverage

| Requirement | Review evidence | Result |
| --- | --- | --- |
| FR-1.1 | `public/chart-logic.js:visibleIds` (`requireRootSelection`), `public/employeeDetailsLogic.js:visibleRows`; `test/employeeDetails/employeeDetailsLogic.test.ts` ("with every root manager checked...", "supersedes spec 004 FR-2.3/FR-2.5...", "unchecking one of two root managers..."); hand-traced the 9-row live-browser case (Niraj Patel + 8 reports) against the algorithm | Covered |
| FR-1.2 | Unchanged non-root traversal inside `visibleIds`; `test/employeeDetails/employeeDetailsLogic.test.ts` ("non-root visibility is unaffected by isolation mode") — hand-traced the isolation-off/isolation-on contrast in the fixture and confirmed it matches the test's asserted outcome | Covered |
| AR-1.1 | `visibleIds`'s optional 3rd param defaults to `false`; `visibleRows`'s required 4th param; `employee-details.html`'s one-time `rootManagerIds` precompute inside `start()`, closed over by `refresh()` | Covered |
| AR-1.2 | `headcount.html`'s `visibleIds` call site confirmed still 2-argument by direct grep, not by trusting the summary | Covered |
| FR-2.1 | `src/import/parseWorkbook.ts` (`OPTIONAL_HEADERS`, `requireNumberCell` reuse for the reject-on-non-numeric decision); `test/import/parseWorkbook.test.ts` | Covered |
| FR-2.2 | `src/db/mutations.ts` (`validateSalaryRecord`, `upsertSalaryRecord`); `test/db/salary.test.ts` (8 cases, including the no-plausibility-ceiling case and the migration/idempotency pair) | Covered |
| FR-2.3 | `src/server/app.ts`; `test/server/employeeDetails.test.ts`'s key-*order* assertion (`Object.keys(entry)`, not just presence) confirms `compRatio` truly sits between `bonus` and `ratings` | Covered |
| FR-2.4 | `public/employee-details.html` — `COLUMNS` and `renderRow`'s `values` array both carry `compRatio` at the same position (index 6), cross-checked directly | Covered (manually verified per this project's DOM-rendering convention) |
| FR-2.5 | `public/employeeDetailsLogic.js` (`NUMERIC_COLUMNS`, `COLUMN_VALUE`, `REQUIRED_EMPLOYEE_KEYS`); `test/employeeDetails/employeeDetailsLogic.test.ts` | Covered |
| AR-2.1 | `src/db/schema.ts`, `src/db/connection.ts:migrateCompRatioColumn`; `test/db/salary.test.ts`'s hand-written-old-schema migration test | Covered |
| AR-2.2 | `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts` | Covered |
| AR-2.3 | `src/import/reconcile.ts:108` | Covered |
| FR-3.1 | `public/chart-logic.js:classifyPositionBand`; `test/dashboard/chartLogic.test.ts` (full 14-position mapping, tokenizer edge cases, priority-order cases) — re-derived the tokenizer's exact-token-equality behavior by hand for `"Software Engineer III"` and confirmed it does not spuriously match the level-2 rule | Covered |
| FR-3.2 | `public/chart-logic.js:POSITION_BAND_ORDER`, `positionRegionBreakdown`'s within-band sort; `test/dashboard/chartLogic.test.ts` | Covered |
| FR-3.3 | `positionRegionBreakdown`'s band-omission loop; `test/dashboard/chartLogic.test.ts` ("D1: an empty input...") | Covered |
| FR-3.4 | `public/headcount.html:renderTotals`; `test/dashboard/chartLogic.test.ts` | Covered |
| AR-3.1 | `public/chart-logic.js` new exports; confirmed by direct inspection that `headcount.html:241` filters `isExternal` before calling `positionRegionBreakdown`, satisfying the stated precondition | Covered |
| AR-3.2 | `renderTotals` uses `element()`/`textContent` exclusively — verified no template-string interpolation anywhere in the new rendering code | Covered |
| AR-3.3 | `distinctPositions` and the position checkbox list are untouched — confirmed by inspection, not just by the summary's claim | Covered |
| AR-3.4 | `.region-header.blue/.red/.green`, `#totals th` — confirmed these do not extend `.card.*`; live screenshot shows correctly-sized header cells | Covered |

## Findings

| Severity | Evidence | Finding | Required action |
| --- | --- | --- | --- |
| nit | `test/employeeDetails/employeeDetailsLogic.test.ts:90-91` | `rootManagerIdsOf` casts `buildTree(employees as never)` and `managerList(employees as never)`. Removing both casts and re-running `npm run typecheck` (done during this review, then reverted) still typechecks cleanly — `chart-logic.js` has no `.d.ts`, so these imports already resolve as implicit `any`, and every other call site in this same test file (and in `chartLogic.test.ts`) passes typed fixtures to them with no cast at all. The casts are dead weight, inconsistent with the file's own established style. | Optional cleanup; does not block approval |
| suggestion | `public/chart-logic.js:positionRegionBreakdown` | The function iterates `visibleEmployees` twice — once to build `rowsByBand`, once more to build `totals` — rather than accumulating `totals` from the same pass or from the already-built per-row data. Still `O(n)` overall (matches the spec's own stated complexity), so this is not a correctness or scale concern at this project's data volumes; a single-pass version would be marginally simpler. | Optional; does not block approval |
| nit | `public/headcount.html`'s new `<th>` header cells (region columns, band-header rows, the "Totals" row label) | No `scope="col"`/`scope="row"` attributes. Spec 006's AR-3.4 only required dedicated, non-`.card` styling (satisfied) and did not mandate table-header semantics, and this matches the project's own established "accessibility is scoped, not comprehensive" stance (spec 003 Constraints) — not a spec violation. Worth a future look if this project's accessibility bar ever moves beyond that stance. | Optional; does not block approval |

No blocking findings.

## Verdict

Approved. All 19 functional and architectural requirements trace to implemented, tested code, and
the trace was independently re-verified in this review — not merely accepted from the
implementation summary — including hand-re-deriving several non-trivial algorithm outcomes
(the isolation-mode traversal, the token classifier's priority order, the payload key-order
assertion) rather than trusting that the tests pass for the reasons claimed. A full regression
sweep of every `visibleIds`/`visibleRows` call site turned up no missed sites and confirmed the
Headcount Dashboard is genuinely unaffected, as AR-1.2 requires. The three findings above are a
nit, a suggestion, and a nit; none affects correctness, none is a spec violation, and none blocks
approval.

Next: `/spec-close 006-employee-details-and-headcount-refinements`.
