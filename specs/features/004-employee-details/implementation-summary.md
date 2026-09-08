# Implementation Summary: 004-employee-details

**Status:** Completed
**Date:** 2026-08-31
**Implementation Review:** Required

## Overview

Implemented the Employee Details screen: a read-only, sortable table at
`/employee-details.html` showing every active employee's id, name,
position, current salary (currency/base/bonus), and last three rating
periods, with checkbox filters by position and by line manager (AND
combined). Added a new `GET /api/employee-details` endpoint, a new
DOM-independent client logic module (`public/employeeDetailsLogic.js`), and
extended the shared nav across all three screens to a third link.

## Review Baseline

- **Commit before implementation:** unavailable — this repository is not a
  git repository (`git rev-parse HEAD` fails with "not a git repository").
- **Pre-existing local changes:** unknown in the git sense (no git to
  check), but the working tree was otherwise untouched: `npm test` (129
  passing) and `npm run typecheck` (clean) were run before any edit, and
  `data/employees.sqlite` was confirmed empty (0 rows) both before and
  after this work — all manual browser verification used separate,
  disposable SQLite databases under the session scratchpad, never the
  project's own `data/` directory.

## Team Execution

Solo. The spec decomposes into roughly five tasks (server endpoint, client
logic module, page wiring, two mechanical nav edits, and two test files),
which the `/spec-implement` sizing guidance places at the small/medium
boundary. The two largest streams (server endpoint vs. client
logic-and-page) touch disjoint files and could have been parallelized, but
the client logic module and its page wiring are tightly coupled to the
exact payload shape the server endpoint produces (nine columns derived from
one eight-key JSON contract, plus the shared sort/filter/validation rules
spanning both). Implementing solo, in the dependency order below, removed
any risk of the two streams drifting out of sync and cost no real time
given the session's own continuity.

**Sequential phases (all of it):**
1. Scouted conventions/standards (see below).
2. Server endpoint (`src/server/app.ts`) + its tests.
3. Client logic module (`public/employeeDetailsLogic.js`) + its tests.
4. Page wiring (`public/employee-details.html`).
5. Nav edits (`public/index.html`, `public/headcount.html`).
6. Full test suite + typecheck, iterated to green.
7. Manual browser verification (real WorkDay reference file, three
   disposable preview servers, covering every UI state including the two
   without automated coverage: FR-1.4's empty-database message and FR-2.5's
   no-rows-match message).
8. Spec adherence walkthrough (below) and living docs update.

## Files Created

- `public/employeeDetailsLogic.js` — DOM-independent module: position
  filtering (`distinctPositions`, `matchesPosition`), manager-filter
  integration via `chart-logic.js`'s `visibleIds` (`visibleRows`), sorting
  (`sortRows`), and payload-shape validation (`isValidPayload`).
- `public/employee-details.html` — the page: filter checkboxes, sortable
  table, fetch/failure/empty-state wiring, nav.
- `test/employeeDetails/employeeDetailsLogic.test.ts` — 15 unit tests for
  the logic module.
- `test/server/employeeDetails.test.ts` — 14 endpoint and served-page
  tests.
- `specs/docs/domains/employee-details/index.md` — new domain page.
- `specs/docs/standards/employee-details-http-api.md` — new HTTP API
  contract page.

## Files Modified

- `src/server/app.ts` — added `GET /api/employee-details` (imports,
  `RATING_PERIOD_TO_KEY`/`mapRatings`, the route handler).
- `public/index.html`, `public/headcount.html` — nav gained a third link
  (mechanical, one `<a>` each).
- `specs/docs/domains/index.md`, `specs/docs/standards/index.md` — new
  entries for the pages above.
- `specs/docs/conventions/browser-screens.md` — extended provenance header
  to spec 004; documented the generated-DOM-id lesson for checkbox
  `id`/`for` pairs built from arbitrary text; noted `isValidPayload` as a
  second example of the automatable-vs-manual client-rendering test split;
  updated the nav page count from two to three.
- `specs/docs/spec-index.md` — new spec 004 row.
- `specs/docs/.last-run.json` — updated for this implementation-update
  pass.
- `specs/ARCHITECTURE.md` — Overview now lists all four implemented specs;
  Repository Structure's `test/` row gained `test/employeeDetails/`; removed
  the stale Open Question flagging this screen as not-yet-built.

## Test Results

- `npm test` (before): 129 passing, 0 failing.
- `npm test` (after): **158 passing, 0 failing** (129 pre-existing + 15
  logic-module tests + 14 endpoint/page tests).
- `npm run typecheck`: clean, both before and after.
- Manual browser verification (three disposable preview servers, the real
  WorkDay reference file, 43 employees): position-filter exclusion,
  manager-filter team-hiding (Andrew Saunders' reports hidden, his own row
  retained), AND combination, ascending/descending sort on a numeric column
  (Base Salary) and a string/rating column (Most Recent Rating) with
  correct missing-value-sorts-last behaviour in both directions, the
  empty-database message, the no-rows-match message (all 14 position
  checkboxes unchecked), and all three nav links with correct
  `aria-current` on all three pages. No console errors observed at any
  point.

## Spec Adherence

| Requirement | Status | Implementation | Test |
| --- | --- | --- | --- |
| FR-1.1 | Done | `src/server/app.ts` (`getAllEmployees()` default), `employee-details.html` (`start`) | `employeeDetails.test.ts` "FR-1.1: inactive employees are excluded" |
| FR-1.2 | Done | `employee-details.html` `COLUMNS`/`renderRow` (exact 9-column order) | `employeeDetails.test.ts` field-value assertions + manual browser screenshot |
| FR-1.3 | Done | `employee-details.html` `cellText()` (`null` → `—`) | Manual browser (Peter Moorhead all-`—`; Keerthana Keerthana partial-`—`) |
| FR-1.4 | Done | `employee-details.html` `renderEmptyState()` | Manual browser against a freshly-initialised database |
| AR-1.1 | Done | `element()`/`cellText()` (`textContent`); `renderCheckbox()` (`box.id`/`label.htmlFor` direct-property-assignment, generated `position-checkbox-${index}` ids, raw text only in `value`/label text) | Code review; no XSS test harness in this project (matches convention) |
| AR-1.2 | Done | Plain HTML + vanilla ES-module JS, no build step, served from `public/` | — |
| FR-2.1 | Done | `employeeDetailsLogic.js` `distinctPositions()`; `employee-details.html` checkbox rendering | `employeeDetailsLogic.test.ts` "FR-2.1"; manual browser (14 checkboxes matching the reference file) |
| FR-2.2 | Done | `employee-details.html` reuses `chart-logic.js`'s `managerList()` unchanged | Manual browser (5 checkboxes, identical to the Headcount Dashboard's) |
| FR-2.3 | Done | `employeeDetailsLogic.js` `visibleRows()` calls `chart-logic.js`'s `visibleIds()` unchanged | `employeeDetailsLogic.test.ts` "FR-2.3"; manual browser (unchecking Andrew Saunders hid his reports, kept his own row) |
| FR-2.4 | Done | `visibleRows()` intersects `matchesPosition` with the manager-visible set | `employeeDetailsLogic.test.ts` "FR-2.4"; manual browser |
| FR-2.5 | Done | `employee-details.html` `refresh()` sets the message when `sorted.length === 0` | `employeeDetailsLogic.test.ts` "FR-2.5 precondition" (invariant); manual browser (all positions unchecked → message shown) |
| AR-2.1 | Done, one noted nuance | `employeeDetailsLogic.js` imports `visibleIds`; `employee-details.html` imports `managerList` directly | See Deviations — `buildTree` is not imported by name anywhere in the new code |
| AR-2.2 | Done | `employeeDetailsLogic.js` `matchesPosition()`, standalone, not folded into `visibleRows` or copied from `chart-logic.js` | `employeeDetailsLogic.test.ts` "FR-2.4" exercises it |
| AR-2.3 | Done | `employeeDetailsLogic.js` (filtering, sorting, validation, all data-in/data-out, no DOM) | All 15 `employeeDetailsLogic.test.ts` cases import the module directly |
| FR-3.1 | Done | `employee-details.html` `renderHeaderRow()`/`onSort()` (`<button>` in `<th>`, `aria-sort`, arrow glyph, single-active-header invariant, `name`-ascending default) | `employeeDetailsLogic.test.ts` tie-break/default-order cases; manual browser (click, aria-sort move, keyboard operability guaranteed by native `<button>` semantics) |
| FR-3.2 | Done | `employeeDetailsLogic.js` `COLUMN_VALUE`/`NUMERIC_COLUMNS`/`sortRows()` | `employeeDetailsLogic.test.ts` "FR-3.2" (×2); manual browser (Base Salary ascending order) |
| FR-3.3 | Done | `sortRows()`'s missing-first check, independent of the sign applied for direction | `employeeDetailsLogic.test.ts` "FR-3.3" (×2, numeric + string column); manual browser (Most Recent Rating sort, both `—` rows last) |
| FR-3.4 | Done | `employee-details.html` `refresh()` re-applies `sortRows` over `visibleRows()` on every filter change; the only `fetch` call in the file is the initial load | Code review (single `fetch` call) |
| AR-3.1 | Done | `employeeDetailsLogic.js` `byNameThenId()`; used as the universal tie-break in `sortRows()` and the comparator in `distinctPositions()` | `employeeDetailsLogic.test.ts` "AR-3.1" |
| FR-4.1 | Done | `src/server/app.ts` `GET /api/employee-details` handler | `employeeDetails.test.ts` (7 cases); manual `curl` against the real reference file |
| FR-4.2 | Done | `RATING_PERIOD_TO_KEY`/`mapRatings()` in `src/server/app.ts`; no new file under `src/db/` | `employeeDetails.test.ts` "FR-4.2" |
| FR-4.3 | Done | Served by the existing `express.static(PUBLIC_DIR)` | `employeeDetails.test.ts` "FR-4.3" |
| FR-4.4 | Done | `employee-details.html`'s `try`/`catch` wraps `fetch` + `isValidPayload`; `employeeDetailsLogic.js`'s `isValidPayload()` is the automatable half | `employeeDetailsLogic.test.ts` `isValidPayload` cases (automated); manual browser for the page-rendering half (matches this project's accepted convention for client-rendering states) |
| FR-4.5 | Done | Nav edits to all three pages | `employeeDetails.test.ts` "FR-4.5"; manual browser screenshots of all three pages |
| AR-4.1 | Done | No `checkOrigin`, no `cors()` on the new route | `employeeDetails.test.ts` "AR-4.1" |
| AR-4.2 | Done | Route registered inside `createApp()` alongside existing routes | Implicit — `withTestServer` picked it up with no harness change |
| AR-4.3 | Done | Catch-all → `500` + fixed message + `console.error` | `employeeDetails.test.ts` "AR-4.3" |
| AR-4.4 | Done | `res.set("Cache-Control", "no-store")` set unconditionally before the `try` | `employeeDetails.test.ts` (×2: `200` and `500` paths) |

## Deviations from Spec

- **AR-2.1** states this screen's client-side module "imports `buildTree`,
  `managerList`, and `visibleIds` from `chart-logic.js`." In the actual
  implementation, `employeeDetailsLogic.js` imports only `visibleIds`
  (all it needs — `visibleIds` already calls `buildTree` internally), and
  `employee-details.html` imports `managerList` directly for the checkbox
  list. `buildTree` is never imported by name anywhere in the new code,
  since neither of the two higher-level functions this screen actually
  needs requires a separate direct call to it. This satisfies the AR's
  underlying intent — reuse hierarchy traversal rather than duplicate it —
  exactly; the deviation is from the literal three-function import list,
  not from the architectural principle. Not recorded as an ADR since it
  changes no behavior and introduces no new abstraction; noted here for
  traceability. No spec update is proposed for this alone — if a future
  spec needs `buildTree` directly on this screen, that's a normal addition
  at that time, not evidence this decision was wrong.

No other deviations. Every other FR and AR was implemented as specified,
verified as shown in the Spec Adherence table above.

## Conventions and Standards Applied

- **Sources:** `specs/docs/conventions/data-access-layer.md`,
  `specs/docs/conventions/browser-screens.md`,
  `specs/docs/standards/headcount-http-api.md`,
  `specs/docs/standards/data-schema.md` — read directly (this session ran
  without the `scout-conventions-and-standards` subagent tool available in
  the initial planning pass, but I additionally launched it explicitly as
  the first implementation step per this skill's Step 4 instructions, and
  its findings matched my own direct reading exactly: no new information,
  no conflicts beyond the two it flagged below).
- **Conflicts and how they were resolved:**
  1. The scout flagged that `getAllEmployees()`'s server-side payload order
     (SQLite binary/lexicographic) need not match this screen's
     client-side `localeCompare`-based `id` sort — the spec already states
     this explicitly (AR-3.1), so no resolution was needed beyond
     confirming the spec's own text covers it.
  2. The scout flagged that no indexed convention page documents
     `src/server/` route-handler file organization (only `src/db/` and
     `public/` have one). Resolved by following the existing,
     un-documented-but-consistent precedent already in `src/server/app.ts`
     itself: small helper functions (`describeFailure`, `checkOrigin`) live
     as module-level functions in `app.ts` alongside the routes that use
     them, not in a separate file. `mapRatings`/`RATING_PERIOD_TO_KEY`
     follow that same precedent.

## Review Handoff

Run `/spec-implementation-review 004-employee-details` before closing this
spec.
