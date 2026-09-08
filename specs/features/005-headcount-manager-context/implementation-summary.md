# Implementation Summary: 005-headcount-manager-context

**Status:** Completed
**Date:** 2026-08-31
**Implementation Review:** Required

## Overview

Implemented all three features from the spec: (1) a `[TeamSize: X]` badge on
every manager card on the Headcount Dashboard, counting all descendants at
any depth; (2) capture of a previously-discarded "Direct Supervisor Name"
column so a manager who has no row of their own in the imported spreadsheet
(the person who ran the report) renders as a named placeholder card with
their reports nested underneath, instead of those reports appearing as
disconnected roots; (3) manager-before-non-manager sibling ordering on the
Headcount Dashboard tree.

## Review Baseline

- **Commit before implementation:** unavailable — this project is not under
  git version control (`git status` reports "not a git repository").
- **Pre-existing local changes:** unknown in git terms for the same reason;
  the working tree had no other in-progress edits at the start of this
  implementation beyond `data/employees.sqlite` (a gitignored, pre-existing
  local runtime database with 43 employees from earlier development/testing,
  used later in this implementation to verify the schema migration against
  real pre-existing data — see Test Results).

## Team Execution

| Teammate | Role | Tasks Completed |
| -------- | ---- | --------------- |
| Data layer engineer | `src/db/*` | New `external_managers` table, `employees.external_manager_id` column, the guarded `ALTER TABLE ADD COLUMN` migration step (`connection.ts`), `Employee.externalManagerId`/`ExternalManager` types, `getAllExternalManagers`, `upsertExternalManager`, `setExternalManager`, barrel exports, `ADR.md` (ADR-001), `test/db/externalManagers.test.ts` (11 tests), a table-list assertion fix in `test/db/lifecycle.test.ts` |
| Dashboard client engineer | `public/*` | `buildTree`'s new `teamSizes` field (O(n) state-tagged-stack post-order pass), `byManagerThenNameThenId` comparator, `renderCard`'s external-manager branch and `TeamSize` line, the `totals()`-call-site `isExternal` filter, `.card.external`/`.team-size` CSS, tests in `test/dashboard/chartLogic.test.ts` |
| Import pipeline engineer | `src/import/*` | `ImportRow.supervisorName`, optional-column detection and duplicate-header handling in `parseWorkbook.ts`, the aggregate-then-write reconciliation sequence in `reconcile.ts` (name tie-break, FK-safe write order, self-healing), tests in `test/import/parseWorkbook.test.ts` and `test/import/reconcile.test.ts` |
| Server route engineer | `src/server/app.ts` | Rewrote `GET /api/headcount` to merge real employees and external-manager placeholders with the effective-`managerId` unification, ordering, and collision guard; tests in `test/server/headcount.test.ts` (including a fix to the pre-existing five-field assertion) |

**Parallel phases:**
- Phase 1 (concurrent): Data layer engineer + Dashboard client engineer — fully disjoint files (`src/db/*` vs. `public/*`), no shared dependency.
- Phase 2 (concurrent): Import pipeline engineer + Server route engineer — fully disjoint files (`src/import/*` vs. `src/server/app.ts`), both consuming Phase 1's finalized `src/db/index.ts` exports.

**Sequential phases:** Phase 2 started only after Phase 1's exact function
signatures (`getAllExternalManagers`, `upsertExternalManager`,
`setExternalManager`, `Employee.externalManagerId`) were confirmed final.

## Files Created

- `specs/features/005-headcount-manager-context/ADR.md` — ADR-001, the schema-migration decision
- `test/db/externalManagers.test.ts` — DB-layer mutation/query tests

## Files Modified

- `src/db/schema.ts` — `external_managers` table (defined before `employees`), `employees.external_manager_id` column
- `src/db/connection.ts` — `migrateExternalManagerColumn(db)`, called in `initDatabase()` after `assertCompatibleSchema`
- `src/db/types.ts` — `Employee.externalManagerId`, new `ExternalManager` interface
- `src/db/queries.ts` — `toEmployee`/`EmployeeRow` extended, `getAllExternalManagers()`
- `src/db/mutations.ts` — `upsertExternalManager`, `setExternalManager`
- `src/db/index.ts` — barrel re-exports
- `test/db/lifecycle.test.ts` — updated hard-coded table-list assertion
- `public/chart-logic.js` — `buildTree`'s `teamSizes` field, `byManagerThenNameThenId` comparator
- `public/headcount.html` — `renderCard`/`renderChart` changes, totals-filter call site, new CSS
- `test/dashboard/chartLogic.test.ts` — new tests for `teamSizes`, the comparator, and `managerList`'s unaffected ordering
- `src/import/types.ts` — `ImportRow.supervisorName`
- `src/import/parseWorkbook.ts` — optional-column detection/mapping, generalized duplicate-header check
- `src/import/reconcile.ts` — aggregate-then-write sequence replacing the old per-row manager-reassignment loop
- `test/import/parseWorkbook.test.ts` — new FR-2.1 tests
- `test/import/reconcile.test.ts` — new FR-2.2/FR-2.3 tests
- `src/server/app.ts` — `GET /api/headcount` handler rewrite
- `test/server/headcount.test.ts` — fixed five-field assertion, new FR-2.4 tests
- `specs/docs/standards/headcount-http-api.md`, `specs/docs/standards/data-schema.md`, `specs/docs/domains/headcount-dashboard/index.md`, `specs/docs/domains/data-foundation/index.md`, `specs/docs/domains/workday-import/index.md`, `specs/docs/strategies/index.md`, `specs/docs/spec-index.md`, `specs/docs/.last-run.json` — living docs (Step 9)

## Test Results

- `npm run typecheck` — clean, no errors (confirmed after every phase and at final integration).
- `npm test` — **188 tests, 188 passing, 0 failing**, across 15 suites (final run confirmed directly, not just from teammate reports).
- **Live manual verification** (this project's UI-change rule: automated tests verify correctness, not that the feature actually works on screen):
  - Started the real app (`npm start`) against the pre-existing, non-git-tracked `data/employees.sqlite` (43 employees, old schema shape). Confirmed via `PRAGMA table_info` that `external_manager_id` was added in place with the 43 rows and all other tables intact — the ALTER TABLE migration path, not just the fresh-database `CREATE TABLE` path.
  - Drove the real `/api/preview` → `/api/confirm` flow via the actual reference workbook (`workday_docs_examples/Team_Market_Range_Analysis_for_Managers–_RELX (1).xlsx`), confirming `Direct Supervisor Name` capture end-to-end.
  - Confirmed via `GET /api/headcount` and the rendered Headcount Dashboard: one external-manager entry (`Frank Borg`, `position`/`country` null, `isExternal: true`), 11 real employees unified to `managerId: "00000270149"`, a dashed `card external` card reading "Frank Borg (not in imported data)" with `[TeamSize: 43]`, his team ordered 5 managers then 6 ICs (FR-3.1), "Total headcount: 43" unaffected by his card (FR-2.6), and the "Show teams" checkbox correctly toggling his subtree.
  - Confirmed the Employee Details screen (`/api/employee-details`) is unaffected — its "Filter by manager" list still shows only the 5 real managers, no Frank Borg entry.

## Spec Adherence

| Requirement | Status | Implementation | Test |
| ----------- | ------ | --------------- | ---- |
| FR-1.1 | Done | `public/chart-logic.js:buildTree` (`teamSizes`), `public/headcount.html:renderCard` | `test/dashboard/chartLogic.test.ts` (3-level chain) + live (`Andrew Saunders [TeamSize: 6]`, `Frank Borg [TeamSize: 43]`) |
| FR-1.2 | Done | `public/headcount.html:renderCard` (size > 0 guard) | `chartLogic.test.ts` (zero-report case) + live (IC cards show no badge) |
| FR-1.3 | Done | Inherited from `getAllEmployees()`'s active-only default (unchanged) | pre-existing `test/server/headcount.test.ts` active-only coverage; correct by construction |
| AR-1.1 | Done | `public/chart-logic.js:buildTree` (state-tagged-stack post-order pass) | `chartLogic.test.ts` |
| AR-1.2 | Done | `public/headcount.html:renderCard`/`renderChart` | `chartLogic.test.ts` + live |
| FR-2.1 | Done | `src/import/parseWorkbook.ts`, `src/import/types.ts` | `test/import/parseWorkbook.test.ts` (5 tests) + live |
| FR-2.2 | Done | `src/import/reconcile.ts` (aggregation pass), `src/db/mutations.ts:upsertExternalManager` | `test/import/reconcile.test.ts` + live (exactly one row for 11 referencing rows) |
| FR-2.3 | Done | `src/import/reconcile.ts` (per-row link), `src/db/mutations.ts:setExternalManager` | `reconcile.test.ts` (self-heal, inactive-manager-unchanged) + live |
| FR-2.4 | Done | `src/server/app.ts` `GET /api/headcount` | `test/server/headcount.test.ts` (4 tests) + live `curl` |
| FR-2.5 | Done | `public/headcount.html:renderCard` (external branch), `chart-logic.js` unchanged | `chartLogic.test.ts` (`managerList` unaffected) + live |
| FR-2.6 | Done | `public/headcount.html` totals call-site filter | live (`Total headcount: 43`) |
| AR-2.1 | Done | `src/db/schema.ts`, `types.ts`, `queries.ts` | `test/db/externalManagers.test.ts` + live migration check |
| AR-2.2 | Done | `src/import/reconcile.ts` ordering, `src/db/connection.ts` ordering | `reconcile.test.ts`, `ADR.md` |
| AR-2.3 | Done | `src/db/queries.ts:getAllExternalManagers`, `index.ts`, `src/server/app.ts` | `externalManagers.test.ts`, `headcount.test.ts` |
| AR-2.4 | Done | `public/chart-logic.js` (verified no changes needed) | `chartLogic.test.ts` + live |
| FR-3.1 | Done | `public/chart-logic.js:byManagerThenNameThenId` | `chartLogic.test.ts` + live (Frank Borg's team: 5 managers then 6 ICs) |
| FR-3.2 | Done | `managerList()` untouched; Employee Details untouched | `chartLogic.test.ts` + live (checkbox list alphabetical; Employee Details unaffected) |
| AR-3.1 | Done | `public/chart-logic.js:byManagerThenNameThenId` factory | `chartLogic.test.ts` |

## Deviations from Spec

None functionally. One disclosed testing-coverage limitation: this project
has no headless-DOM test harness for `headcount.html` itself, so
`renderCard`'s exact rendered markup (CSS class names, the literal
`(not in imported data)` text) is covered by direct code review and the live
manual browser verification above, not by an automated DOM-level test — the
same limitation that already existed for every other `renderCard` behavior
before this spec (spec 003/004 have the same gap). Not recorded as an ADR
since it changes no architecture; noted here per "no silent changes."

## Conventions and Standards Applied

- **Sources:** `specs/docs/conventions/data-access-layer.md`,
  `specs/docs/conventions/browser-screens.md`,
  `specs/docs/standards/data-schema.md`,
  `specs/docs/standards/headcount-http-api.md`,
  `specs/docs/standards/import-http-api.md` — read via a single
  `scout-conventions-and-standards` pass before any code was written, and
  the resulting Rules table distributed to each teammate's assignment.
- **Conflicts and how they were resolved:** the scout flagged that this
  codebase had never added a column to an already-existing table before (no
  established pattern) and that the documented `GET /api/headcount` "exactly
  five fields" contract would be superseded. Both were resolved by the lead
  rather than re-litigated per teammate: the column-addition approach was
  decided up front (guarded `ALTER TABLE ADD COLUMN`, favoring data
  preservation over the existing reject-and-reimport precedent, since the
  latter would have destroyed multi-year salary/rating history for a purely
  additive change) and recorded in `ADR.md`; the stale HTTP-contract doc was
  treated as an expected, deliberate supersession already decided in
  `spec.md` FR-2.4, updated during the Step 9 living-docs pass rather than
  treated as a blocking conflict requiring a pause.

## Review Handoff

Run `/spec-implementation-review 005-headcount-manager-context` before closing this spec.
