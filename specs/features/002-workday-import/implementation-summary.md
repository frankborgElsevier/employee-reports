# Implementation Summary: 002-workday-import

**Status:** Completed
**Date:** 2026-08-31
**Implementation Review:** Required

## Overview

Implemented the WorkDay Import Screen: a `src/import/` module that parses
the WorkDay "Team Market Range Analysis for Managers" `.xlsx` export and
reconciles it against the spec 001 database, and a `src/server/` Express
app that exposes this as a local web screen with a mandatory
preview-then-confirm flow. `npm start` now boots a real, working app for
the first time in this project.

**Fix round 1 (same day):** `implementation-review.md`'s first pass found a
real concurrency defect (Finding 1, blocking) — FR-5.2's single-in-flight
guarantee wasn't atomic, since the check (`hasPendingImport`) and the state
mutation (`beginPendingImport`) were separated by `await`ed work, letting
two concurrent `/api/preview` requests both pass the check before either
claimed the slot. `public/index.html`'s Import button wasn't disabled
during its own request either, so an ordinary double-click could trigger
it. `previewStore.ts` was redesigned around a single atomic
check-and-reserve call (`tryReserve`) with no `await` between check and
mutation, closing both this and the narrower analogous race on
`/api/confirm` (Finding 2). Finding 3 (no `unhandledRejection` safety net)
and the nit (Import button not disabled) were fixed too.

**Fix round 2 (same day):** the second review pass found that fix round 1
itself introduced a new gap (Finding 4, blocking) — the new `"computing"`
reservation state had no expiry, so a request that reserved the slot and
then never completed (a stalled upload, a hung parse) would block every
future import forever, which is worse than the problem being fixed and
contradicts FR-5.2's own "doesn't block imports indefinitely" text. Closed
by giving `"computing"` its own timeout (2 minutes, generous over any
realistic processing time) and, since implementing that surfaced a further
edge case myself — a reservation that times out, gets reused by a *newer*
request, and then very late finalizes/releases and would otherwise clobber
that newer reservation — by switching `tryReserve`/`finalizeReservation`/
`releaseReservation` to a ticket-based compare-and-swap so a stale caller
can never mutate a reservation that isn't still theirs. See the updated
Spec Adherence table for what changed.

## Review Baseline

- **Commit before implementation:** unavailable — this repository is not a
  git repository (`git status` fails with "not a git repository").
- **Pre-existing local changes:** not applicable, for the same reason.

## Team Execution

Solo. The reconciliation logic (Features 2, 3, 5) is a single, tightly
sequenced pipeline (upsert → reassign → write salary/ratings →
soft-inactivate, all inside one transaction) with several subtle ordering
requirements that three earlier critique rounds on this exact spec had to
fix — splitting it across parallel teammates without the full history of
*why* each rule exists risked reintroducing exactly those bugs. The web
layer (Feature 4) is more separable but small enough that solo execution
had no meaningful coordination cost to save.

**Sequential phases:** dependencies installed → conventions/standards
scouted → `src/import/` written and tested → `src/server/` written and
tested (depends on `src/import/`'s exported functions) → end-to-end manual
verification against the real reference file → living docs updated.

## Files Created

- `src/import/errors.ts` — `WorkbookStructureError`, `LimitExceededError`, `RowValidationError`
- `src/import/mapping.ts` — required headers, rating-column-to-period map, row cap
- `src/import/types.ts` — `ImportRow`, `ReconciliationCounts`
- `src/import/parseWorkbook.ts` — FR-1.1–FR-1.5: header validation, row mapping, field validation
- `src/import/reconcile.ts` — FR-2.1–FR-2.3, FR-3.1–FR-3.3, AR-5.1: the reconciliation pipeline
- `src/server/zipPreflight.ts` — AR-4.6: pre-ExcelJS ZIP central-directory inspection
- `src/server/previewStore.ts` — FR-4.3/FR-4.4/FR-5.2: pending-import token store and guard
- `src/server/app.ts` — FR-4.2–FR-4.4, AR-4.1–AR-4.3, AR-4.5: Express app and routes
- `src/server/start.ts` — FR-4.1, AR-4.4: `npm start` entry point
- `public/index.html` — the browser UI
- `test/import/helpers.ts`, `test/import/parseWorkbook.test.ts`, `test/import/reconcile.test.ts`
- `test/server/helpers.ts`, `test/server/app.test.ts`, `test/server/zipPreflight.test.ts`
- `specs/docs/domains/workday-import/index.md`, `specs/docs/standards/import-http-api.md`

## Files Modified

- `package.json` — added `express`, `multer`, `exceljs`, `open`, `yauzl` (+ `@types/*`), a `start` script
- `.gitignore` — added `data/` (runtime SQLite file and temp uploads)
- `specs/PROJECT_GUIDELINES.md`, `specs/ARCHITECTURE.md` — replaced stale "TBD"/"no source files" content with the real tooling and structure this implementation establishes
- `specs/docs/domains/data-foundation/index.md`, `specs/docs/conventions/data-access-layer.md`, `specs/docs/standards/data-schema.md`, `specs/docs/strategies/index.md`, `specs/docs/domains/index.md`, `specs/docs/standards/index.md`, `specs/docs/spec-index.md`, `specs/docs/.last-run.json` — living docs were stale (still describing `rating_year`/`start_date`, missing `deleteRatingRecord`/`runInTransaction`) from before this implementation; refreshed as part of this work, not a new deviation

**Fix round 1:**

- `src/server/previewStore.ts` — rewritten around a `Slot` state machine
  (`idle` / `computing` / `ready`) with atomic `tryReserve`/
  `finalizeReservation`/`releaseReservation`/`claimPendingImport` functions,
  replacing `hasPendingImport`/`beginPendingImport`/`getPendingImport`/
  `clearPendingImport`
- `src/server/app.ts` — `/api/preview` now reserves the slot synchronously
  before any `await` (Finding 1); `/api/confirm` now atomically claims and
  clears the slot in one call before doing any async work (Finding 2)
- `src/server/start.ts` — added a top-level `unhandledRejection` handler (Finding 3)
- `public/index.html` — the Import button is now disabled for the duration of its own request (nit)
- `test/server/app.test.ts` — updated to the new `previewStore` API, plus two new regression tests firing genuinely concurrent requests via `Promise.all` (not sequential/awaited) to prove Findings 1 and 2 are actually fixed

**Fix round 2:**

- `src/server/previewStore.ts` — the `"computing"` slot variant now carries
  a `reservedAt` timestamp, reaped by `reapIfExpired` after a 2-minute
  timeout (`setReservationTimeoutMsForTesting` overrides it for tests, same
  pattern as the existing token-TTL override). `tryReserve` now returns a
  ticket string (or `null`); `finalizeReservation`/`releaseReservation` take
  that ticket and no-op if it no longer matches the live reservation, so a
  very late call from an already-timed-out request can't clobber a
  different, newer reservation that reused the freed slot.
- `src/server/app.ts` — threads the ticket from `tryReserve()` through to
  `finalizeReservation`/`releaseReservation`; added a `408` response for the
  (expected to be rare) case where a reservation times out during its own
  computation.
- `test/server/app.test.ts` — added a regression test that reserves the
  slot directly, lets it time out (via the test override), and confirms a
  subsequent preview succeeds rather than getting `409` forever.

## Test Results

`npm run typecheck` — clean. `npm run build` — clean. `npm test` — **100/100
passing** (46 pre-existing spec 001 tests + 54 for spec 002, including the
concurrency and reservation-timeout regression tests from both fix rounds).

Also re-verified manually against the real reference file after the fix
round: two truly concurrent `curl` requests (backgrounded shell jobs, not
sequential) to `/api/preview` against a live server produced exactly one
`200` and one `409`, confirming the fix holds outside the test harness too.

Additionally verified manually, end-to-end, against the actual reference
file in `workday_docs_examples/` (not just synthetic fixtures) via a
temporary server instance:
- First import: 43 added, correct field mapping, correct bonus derivation
  (verified against a specific row), correct rating-period values, and all
  11 of Frank Borg's direct reports correctly resolved to `managerId: null`
  (external supervisor, matching the analysis from earlier in this spec's
  development).
- Re-import with one employee removed: 42 updated, 1 inactivated; that
  employee's `end_date` was set to the current date and their salary/rating
  history remained fully intact (not deleted).
- The real browser UI was loaded and screenshotted; file-picker-driven
  upload itself could not be automated (no native file-picker control
  available in this session's browser tooling), so the upload/preview/
  confirm HTTP flow was exercised directly instead, matching exactly what
  the page's own `fetch()` calls do.

## Spec Adherence

| Requirement | Status | Implementation | Test |
| --- | --- | --- | --- |
| FR-1.1 | Done | `parseWorkbook.ts` | 5 tests incl. missing/duplicate header, malformed file, zero rows |
| FR-1.2 | Done | `parseWorkbook.ts` | well-formed-file test, formula-cell-rejected test |
| FR-1.3 | Done | `parseWorkbook.ts` | blank-id test, numeric-cell-rejected test |
| FR-1.4 | Done | `parseWorkbook.ts` | duplicate-Employee-ID test |
| FR-1.5 | Done | `parseWorkbook.ts` | bonus-derivation, zero-bonus, negative-bonus, non-numeric tests |
| AR-1.1 | Done | `parseWorkbook.ts` (ExcelJS) | exercised by all Feature 1 tests + real-file manual verification |
| FR-2.1 | Done | `reconcile.ts` | add/update/reactivate tests |
| FR-2.2 | Done | `reconcile.ts` | blank/unresolvable/resolvable supervisor tests + real-file verification (Frank Borg) |
| FR-2.3 | Done | `reconcile.ts` | inactivation, no-overwrite tests + real-file reimport verification |
| FR-3.1 | Done | `parseWorkbook.ts`, `reconcile.ts` | rating-mapping test |
| FR-3.2 | Done (via spec 001) | `reconcile.ts` calls `upsertRatingRecord` | covered by spec 001's own upsert-dedup test; not independently re-tested at this layer |
| FR-3.3 | Done | `reconcile.ts` | stale-rating-removed test |
| AR-3.1 | Done | spec 001 (`schema.ts`, `queries.ts`, `mutations.ts`) | spec 001's test suite |
| FR-4.1 | Done | `start.ts` | verified by code review + manual smoke run; `open()`'s real-browser launch isn't automated |
| FR-4.2 | Done | `app.ts` | happy-path, wrong-field-name tests |
| FR-4.3 | Done | `app.ts` | happy-path, row-content-failure, malformed-workbook-400 tests |
| FR-4.4 | Done | `app.ts` | commit, unknown-token, expired-token tests |
| AR-4.1 | Done | `app.ts` (Express) | exercised by all server tests |
| AR-4.2 | Done | `app.ts`, `previewStore.ts`, `start.ts` | cleanup-after-confirm/failure tests; startup sweep verified by code review |
| AR-4.3 | Done | `app.ts` | missing/mismatched Origin tests; localhost-only binding verified by code review |
| AR-4.4 | Done | `start.ts` | verified by code review (thin entry-point script) |
| AR-4.5 | Done | `parseWorkbook.ts`, `app.ts` | 5001-row test, configurable-size 413 test |
| AR-4.6 | Done | `zipPreflight.ts` | 5 dedicated tests |
| FR-5.1 | Done | `reconcile.ts` | invalid-row-abort test, supervisor-cycle-abort test |
| FR-5.2 | Done | `previewStore.ts` (ticket-based atomic `tryReserve`/`finalizeReservation`/`releaseReservation`/`claimPendingImport`, with expiry for both the confirmable-token state and the in-progress-computation state) | 409-while-pending, expired-token tests; two genuinely-concurrent `Promise.all` regression tests (fix round 1); reservation-timeout-reaped test (fix round 2) |
| AR-5.1 | Done | `reconcile.ts` | preview-rolls-back, confirm-commits tests |
| AR-5.2 | Done | spec 001 (`connection.ts`) | spec 001's `runInTransaction` tests |
| AR-5.3 | Done | `reconcile.ts`, `previewStore.ts` | effective-year test; preview/confirm sharing `capturedAt` verified by code review |

## Deviations from Spec

None. Testability affordances were added beyond the spec's literal text,
all optional parameters/overrides defaulting to the spec's real values:
`preflightZip`'s size/count limits and `createApp`'s `maxUploadBytes` are
overridable so their boundary conditions can be tested without multi-hundred-
megabyte fixture files; `previewStore`'s token TTL and (added in fix round
2) reservation timeout are similarly overridable. None of these change
default behavior.

Fix round 1's `unhandledRejection` handler (Finding 3) and the disabled
Import button (nit) are hardening beyond the spec's literal text, in the
direction the spec's own error-handling and atomicity intent already
points — not a deviation from any stated requirement.

Fix round 2's 2-minute reservation timeout and its concrete value are not
named anywhere in the spec (FR-5.2 states the 5-minute *confirmation* token
TTL explicitly, but says nothing about a computation-in-progress timeout,
since that gap wasn't anticipated until fix round 1's own design surfaced
it). The 2-minute figure is a judgment call, not a spec-stated number —
justified inline in `previewStore.ts` by this session's own observed timing
(the real 43-row reference file processes in well under 100ms) rather than
invented arbitrarily, but it is a new constant a future spec update could
reasonably want to make explicit.

## Conventions and Standards Applied

- **Sources:** `specs/docs/conventions/data-access-layer.md` and
  `specs/docs/standards/data-schema.md`, scouted via the
  `scout-conventions-and-standards` agent before writing any code.
- **Conflicts and how they were resolved:** the scout flagged that
  `deleteRatingRecord` and `runInTransaction` weren't documented in
  `standards/data-schema.md`, and that the module-layout convention didn't
  cover a schema-less module like `src/import/`. Both were resolved by
  verifying the functions actually exist in `src/db/` (they do — added in
  this same session's earlier spec 001 update, ahead of the docs being
  refreshed) and then fixing the stale docs as part of this implementation,
  rather than treating them as real conflicts. The scout's third flagged
  question — what happens to a departed manager's remaining active reports
  — is already answered by the spec's own FR-2.2 sequencing (every present
  employee's `Direct Supervisor ID` is re-resolved from the current file on
  every import); no gap.

## Review Handoff

Run `/spec-implementation-review 002-workday-import` before closing this spec.
