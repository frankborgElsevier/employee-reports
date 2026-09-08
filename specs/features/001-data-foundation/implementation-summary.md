# Implementation Summary: 001-data-foundation

**Status:** Completed
**Date:** 2026-08-31
**Implementation Review:** Required

## Overview

Implemented the SQLite schema and TypeScript data-access layer defined in
spec 001: the `employees`, `salary_history`, and `rating_history` tables,
a full read API (single-entity, collection, and history queries), a full
write API (upserts, manager reassignment with cycle prevention, and
deletion), connection lifecycle management, and the field-validation and
error-handling contracts specified across all four Features. This is the
first code in the repository — it also establishes the project's initial
tooling (`package.json`, `tsconfig.json`, test runner) since none existed.

## Review Baseline

- **Commit before implementation:** not applicable — the repository is not
  a git repository (no `.git` directory exists). No version control history
  exists to checkpoint against.
- **Pre-existing local changes:** clean — before this implementation, the
  repository contained only `specs/` (guidelines, architecture doc,
  roadmap, and the spec/critique files for 001-data-foundation). No source
  code, manifests, or test setup existed.

## Initiative Context

Not applicable — no Cyclops initiative or slice exists in this repository.

## Team Execution

Worked solo. The spec's ~26 FR/AR items collapse into one small, tightly
coupled module (schema, queries, and mutations all share the same types
and the same handful of tables), so there was no genuine independent
work stream to parallelize — splitting it would have added coordination
overhead without a real benefit.

**Parallel phases:** none.
**Sequential phases:** tooling bootstrap → types/errors/validation →
schema → connection lifecycle → queries → mutations → tests → spec
adherence verification.

## Files Created

- `package.json` - project manifest; `better-sqlite3` runtime dependency,
  `@types/better-sqlite3`/`@types/node`/`tsx`/`typescript` dev
  dependencies, `build`/`test`/`typecheck` scripts.
- `tsconfig.json` - strict TypeScript config targeting ES2022/NodeNext.
- `.gitignore` - excludes `node_modules/`, `dist/`, and local SQLite files.
- `src/db/types.ts` - `Employee`, `EmployeeInput`, `SalaryRecord`,
  `RatingRecord`, `QueryOptions` types (FR-4.1).
- `src/db/errors.ts` - `NotFoundError`, `ValidationError`, `CycleError`,
  `ConflictError`, `InitializationError` (AR-4.4).
- `src/db/validation.ts` - `isBlank`, `isValidIsoDate`,
  `currentCalendarYear` (AR-2.2, UTC), `isValidYear`,
  `isFiniteNonNegative`, `isValidCurrencyCode`, `roundToTwoDecimals`
  (AR-2.3).
- `src/db/schema.ts` - `SCHEMA_SQL`: `employees`, `salary_history`,
  `rating_history` table definitions, the `manager_id` index, and the
  `ON DELETE RESTRICT`/`ON DELETE CASCADE` foreign keys (FR-1.6).
- `src/db/connection.ts` - `initDatabase`, `closeDatabase`,
  `getConnection`: single-connection enforcement, missing-parent-directory
  check, restrictive process umask + main-file `chmod` for new files only
  (AR-4.2), `PRAGMA foreign_keys = ON` (AR-1.3).
- `src/db/queries.ts` - `getEmployeeById`, `getAllEmployees`,
  `getDescendants`, `getAncestors`, `getCurrentSalary`,
  `getSalaryHistory`, `getLastRatings`, `getRatingHistory` (FR-4.1), plus
  row-to-object mapping.
- `src/db/mutations.ts` - `upsertEmployee`, `reassignManager` (with cycle
  detection), `upsertSalaryRecord`, `upsertRatingRecord`, `deleteEmployee`
  (FR-4.3, FR-4.4), plus field validation and the `assertEmployeeExists`
  not-found guard shared by all id-taking writes.
- `src/db/index.ts` - barrel export for the module (AR-4.1).
- `test/db/helpers.ts` - `withFreshDatabase`: per-test temp-file SQLite
  setup/teardown.
- `test/db/employees.test.ts`, `test/db/hierarchy.test.ts`,
  `test/db/salary.test.ts`, `test/db/rating.test.ts`,
  `test/db/lifecycle.test.ts` - 46 tests total, one per FR/AR Verify line
  (see Spec Adherence below).

## Files Modified

- `src/db/connection.ts` - post-review fix (see below): wrapped the
  connection-opening/schema-init section of `initDatabase` in try/catch so
  any failure after the restrictive umask is set restores it before
  rethrowing, instead of leaking it for the rest of the process's
  lifetime. Factored the restore logic into a shared `restorePreviousUmask`
  used by both the new catch block and `closeDatabase`.
- `test/db/lifecycle.test.ts` - added a regression test for the above.

## Post-Review Fix (2026-08-31)

`/spec-implementation-review 001-data-foundation` returned **Changes
Requested** with one blocking finding: `initDatabase` could permanently
leak a restrictive process umask if it failed after setting the umask but
before a connection was successfully established (see
`implementation-review.md` for the full writeup, including how repeated
failed retries would compound the corruption). Fixed as described above
and re-verified: 47/47 tests pass (46 original + 1 new regression test),
typecheck and build clean. The five non-blocking suggestions/nits from
that review (see `implementation-review.md`) were left open — the user
scoped this follow-up to blocking issues only.

## Test Results

`npm test` (Node's built-in test runner via `tsx`): **47 passed, 0
failed** (46 from the original implementation + 1 new regression test for
the post-review fix). `npm run typecheck` (`tsc --noEmit`, strict mode):
clean, no errors. `npm run build`: clean, no errors (build output removed
after verification since it isn't committed — see `.gitignore`).

One test bug was caught and fixed during the original implementation run:
an initial assertion about which tables `initDatabase` creates didn't
account for SQLite's own internal `sqlite_sequence` table (created
automatically by the `AUTOINCREMENT` columns) — corrected to filter it out
rather than treat it as a defect.

## Spec Adherence

| Requirement | Status | Implementation | Test |
| --- | --- | --- | --- |
| FR-1.1 | Done | `schema.ts` (`employees` table), `mutations.ts:upsertEmployee` | `employees.test.ts: "FR-1.1: inserting..."`, `"FR-1.1: reassignManager to a non-existent..."` |
| FR-1.2 | Done | `mutations.ts:validateEmployeeInput`, `validation.ts:isBlank/isValidIsoDate` | `employees.test.ts: "FR-1.2: ..."` (4 tests) |
| FR-1.3 | Done | `schema.ts` (nullable `manager_id`), `queries.ts:getDescendants` | `hierarchy.test.ts: "FR-1.3: ..."` |
| FR-1.4 | Done | `mutations.ts:wouldCreateCycle`, `reassignManager` | `hierarchy.test.ts: "FR-1.4: ..."` (2 tests) |
| FR-1.5 | Done | `queries.ts:getDescendants/getAncestors` | `hierarchy.test.ts: "FR-1.5: ..."` (4 tests) |
| FR-1.6 | Done | `schema.ts` (`ON DELETE RESTRICT`/`CASCADE`), `mutations.ts:deleteEmployee` | `employees.test.ts: "FR-1.6, FR-4.4: ..."` (2 tests) |
| AR-1.1 | Done | `package.json` (`better-sqlite3`), all prepared statements use `?`/`@name` bound params | verified by code review — no string-concatenated SQL anywhere |
| AR-1.2 | Done | `schema.ts:SCHEMA_SQL` (`CREATE TABLE IF NOT EXISTS`), `connection.ts:initDatabase` | `lifecycle.test.ts: "FR-4.2: initDatabase creates..."` |
| AR-1.3 | Done | `connection.ts:initDatabase` (`PRAGMA foreign_keys = ON`) | `lifecycle.test.ts: "AR-1.3: ..."` |
| FR-2.1 | Done | `schema.ts` (`salary_history` + `UNIQUE` constraint) | `salary.test.ts: "FR-2.1: ..."` |
| FR-2.2 | Done | `queries.ts:getCurrentSalary` | `salary.test.ts: "FR-2.2: ..."` |
| FR-2.3 | Done | `mutations.ts:validateSalaryRecord` | `salary.test.ts: "FR-2.3: ..."` (5 tests) |
| AR-2.1 | Done | `queries.ts`/`mutations.ts` store/return `currency` verbatim, no conversion logic exists | verified by code review |
| AR-2.2 | Done | `validation.ts:currentCalendarYear` (UTC), used by `isValidYear`. Note: `queries.ts:getCurrentSalary` currently reimplements the same calculation inline rather than calling this helper (correct today, flagged as a suggestion in `implementation-review.md`, not yet fixed) | `salary.test.ts: "FR-2.2: ..."` exercises the UTC-year boundary |
| AR-2.3 | Done | `validation.ts:roundToTwoDecimals`, applied in `mutations.ts:upsertSalaryRecord` | `salary.test.ts: "AR-2.3: ..."` |
| FR-3.1 | Done | `schema.ts` (`rating_history` + `UNIQUE` constraint) | `rating.test.ts: "FR-3.1: ..."` |
| FR-3.2 | Done | `queries.ts:getLastRatings` | `rating.test.ts: "FR-3.2: ..."` (2 tests) |
| FR-3.3 | Done | `mutations.ts:validateRatingRecord` | `rating.test.ts: "FR-3.3: ..."` (3 tests) |
| FR-4.1 | Done | `queries.ts` (all 8 functions, exact signatures/defaults from the spec) | all query test files; ordering specifically in `employees.test.ts: "FR-4.1: ... lexicographically"`, `salary.test.ts`/`rating.test.ts: "FR-4.1: ..."` |
| FR-4.2 | Done | `connection.ts:initDatabase/closeDatabase` | `lifecycle.test.ts: "FR-4.2: ..."` (4 tests) |
| FR-4.3 | Done | `mutations.ts` (`upsertEmployee`, `reassignManager`, `upsertSalaryRecord`, `upsertRatingRecord`) | covered across `employees.test.ts`, `hierarchy.test.ts`, `salary.test.ts` |
| FR-4.4 | Done | `mutations.ts:deleteEmployee` | `employees.test.ts: "FR-1.6, FR-4.4"`, `"FR-4.4: deleting a non-existent..."` |
| AR-4.1 | Done | `src/db/` module structure, `index.ts` barrel export | N/A — structural, verified by directory layout |
| AR-4.2 | Done | `connection.ts:initDatabase` (umask + `chmod` for new files only) | `lifecycle.test.ts: "AR-4.2: ..."` (2 tests) for the main file; sidecar-file protection relies on the same umask mechanism and is verified by code review only — SQLite's rollback-journal sidecar is transient (created and deleted within a single transaction), making it impractical to catch mid-transaction in a synchronous test |
| AR-4.3 | Done | `connection.ts` (module-level singleton; `closeDatabase` and, as of the post-review fix, `initDatabase`'s own failure path both restore the prior umask via shared `restorePreviousUmask`) | `lifecycle.test.ts: "FR-4.2: calling initDatabase while a connection is already open throws"`; `"AR-4.3: a failed initDatabase restores the process umask instead of leaking it"` |
| AR-4.4 | Done | `errors.ts` + usage throughout `queries.ts`/`mutations.ts` | `AR-4.4` tests across `employees.test.ts`, `hierarchy.test.ts`, `salary.test.ts` (null/empty-vs-throw contract for lookups, collections, history queries, and missing-employee-id writes) |

## Deviations from Spec

None. One implementation detail not dictated by the spec (left as
"implementer's choice" per AR-4.4): error types are five small classes in
`errors.ts` (`NotFoundError`, `ValidationError`, `CycleError`,
`ConflictError`, `InitializationError`) rather than a single generic
`Error` — chosen for caller ergonomics, not required by the spec.

## Conventions and Standards Applied

- **Sources:** none — `specs/docs/conventions/index.md` and
  `specs/docs/standards/index.md` do not exist in this repository (scouted
  via the `scout-conventions-and-standards` agent before implementation).
  This is the first spec implemented, so the choices made here (module
  layout, TypeScript strictness, test runner, error-class style) set the
  de facto precedent for future specs rather than following one.
- **Conflicts and how they were resolved:** none — there was nothing to
  conflict with.

## Review Handoff

Run `/spec-implementation-review 001-data-foundation` before closing this
spec.
