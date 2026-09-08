# Implementation Summary: 003-headcount-dashboard

**Status:** Completed
**Date:** 2026-08-31
**Implementation Review:** Required

## Overview

Built the Headcount Dashboard: a read-only org chart at `/headcount.html`
showing one colour-coded card per active employee nested under their line
manager, with total headcount, a totals-by-position breakdown, and a checkbox
per line manager controlling which teams are shown. Added the read-only
`GET /api/headcount` endpoint that feeds it, and the two-link navigation shell
now carried by both screens.

No schema change, no new dependency, no build step. `package.json` is untouched.

## Review Baseline

- **Commit before implementation:** unavailable — this project is not a git
  repository (`git status` reports no repo). A reviewer cannot diff against a
  baseline commit; use the Files Created / Files Modified lists below as the
  scope boundary.
- **Pre-existing local changes:** unknown for the same reason. The working tree
  before this run contained the spec-003 folder (spec plus 8 critique files)
  written earlier in this session, and no other uncommitted work was visible.

## Team Execution

Solo. The spec decomposes into 4 tasks (logic module, endpoint, dashboard page,
import-screen nav) that all funnel into one test-and-verify step, and three of
the four touch files the others read — below the threshold where parallel work
streams pay for their coordination.

**Sequential phases:** logic module → endpoint → dashboard page → import-screen
nav → tests → live verification → docs.

## Conventions and Standards Applied

- **Sources:** read directly rather than via the `scout-conventions-and-standards`
  agent, because this session carries a standing instruction not to spawn
  subagents unless asked. Read `specs/docs/conventions/index.md`,
  `conventions/data-access-layer.md`, `specs/docs/standards/index.md`,
  `standards/data-schema.md`, `standards/import-http-api.md`,
  `specs/docs/strategies/index.md`, and `specs/PROJECT_GUIDELINES.md`.
- **Rules applied:** reuse `src/db/`'s public API rather than writing new SQL
  (no new file under `src/db/`); `node:test` via `tsx` with one test file per
  feature area and test names citing the requirement they verify; preserve the
  `standards/data-schema.md` contract unchanged; preserve the
  `standards/import-http-api.md` contract unchanged.
- **Conflicts and how they were resolved:** none. The one tension worth
  recording is not a conflict: `conventions/data-access-layer.md` prescribes a
  TypeScript module layout, but AR-1.3 forbids a build step for client code, so
  `public/chart-logic.js` is plain JavaScript. The convention explicitly scopes
  itself to SQLite-backed data modules, so it does not reach `public/`. The new
  `conventions/browser-screens.md` page records the client-side pattern rather
  than leaving it implied.

## Files Created

- `public/chart-logic.js` — AR-2.3's DOM-independent module: colour bucketing,
  iterative tree assembly, manager list, single-pass visibility, totals.
- `public/headcount.html` — the dashboard page: styles, legend, nav, and the
  DOM wiring around `chart-logic.js`.
- `test/dashboard/chartLogic.test.ts` — 17 unit tests for the logic module.
- `test/server/headcount.test.ts` — 12 endpoint and served-page tests.
- `specs/docs/domains/headcount-dashboard/index.md` — new domain page.
- `specs/docs/standards/headcount-http-api.md` — the endpoint contract.
- `specs/docs/standards/location-colour-buckets.md` — the colour mapping.
- `specs/docs/conventions/browser-screens.md` — the client-side convention.

## Files Modified

- `src/server/app.ts` — added the `GET /api/headcount` route inside
  `createApp()`; imported `getAllEmployees`. No existing route changed.
- `public/index.html` — added the nav element and nav styles; appended the
  dashboard link to the post-import success message. The upload/confirm logic
  is unchanged.
- `specs/ARCHITECTURE.md` — overview, `public/` and test-directory rows, and
  Open Questions updated now that the dashboard exists.
- `specs/docs/domains/index.md`, `specs/docs/standards/index.md`,
  `specs/docs/conventions/index.md`, `specs/docs/spec-index.md`,
  `specs/docs/.last-run.json` — index and provenance updates.

## Test Results

| Command | Result |
| --- | --- |
| `npm test` (baseline, before any change) | 100 pass, 0 fail |
| `npm test` (after) | **129 pass, 0 fail** — 29 new, no regressions |
| `npm run typecheck` | clean |
| `npm run build` | clean (`dist/` removed afterwards) |

The AR-3.4 test prints a stack trace to stderr while passing — that is the
required server-side logging of the real error, exercised deliberately.

### Live Verification

Automated tests cover the logic and the endpoint but not rendering, so the
rendering requirements were verified against a running server seeded with the
real reference export (`workday_docs_examples/`), reading the live DOM:

- 43 cards, **29 blue / 13 red / 1 green**, 11 top-level roots, 5 team
  containers, 5 checkboxes, "Total headcount: 43" — every figure the spec
  claims, confirmed against real data rather than assumed.
- The single green card is the Netherlands employee; cards carry name,
  position, and country text.
- Computed styles are exactly `#d6e4f7` / `#f7d6d6` / `#d9f0dc` on `#1a1a1a`.
- A nested card sits 38px to the right of its root with a 2px left border
  (FR-1.5).
- Filtering: one manager deselected → 43 → 37 cards and headcount, breakdown
  15 → 14 rows; all deselected → 11 cards, headcount 11, FR-2.7 message shown;
  reselected → back to 43.
- Empty database → FR-1.8 message with a working `/` link, zero cards, zero
  checkboxes, legend intact.
- Endpoint forced to `500` → FR-3.4 message, totals/filters/chart all cleared,
  legend and nav intact.

## Spec Adherence

| Requirement | Status | Implementation | Test |
| --- | --- | --- | --- |
| FR-1.1 | Done | `src/server/app.ts` (`getAllEmployees()` default) | `headcount.test.ts` "FR-1.1: inactive employees are excluded" |
| FR-1.2 | Done | `public/headcount.html:renderCard`, `chart-logic.js:byNameThenId` | `chartLogic.test.ts` "FR-1.2: siblings and roots order…"; live DOM (43 cards, name/position/country) |
| FR-1.3 | Done | `chart-logic.js:buildTree`, `headcount.html:renderChart` | `chartLogic.test.ts` "FR-1.3: nests to full depth" |
| FR-1.4 | Done | `chart-logic.js:buildTree` (unresolvable parent → root) | `chartLogic.test.ts` "FR-1.4: an employee whose manager is absent…", "FR-1.4: a root is visible in every checkbox state" |
| FR-1.5 | Done | `.team` rule in `headcount.html` | Live DOM: nested card +38px, 2px left border |
| FR-1.6 | Done | `chart-logic.js:countryBucket` | `chartLogic.test.ts` "FR-1.6: …blue/red"; live DOM 29/13/1 |
| FR-1.7 | Done | `.legend` markup and `.card.*` rules in `headcount.html` | `headcount.test.ts` "FR-1.7: the three bucket colours…"; live computed styles |
| FR-1.8 | Done | `headcount.html:renderEmptyState` | Live: empty DB shows the message and a `/` link |
| FR-2.1 | Done | `chart-logic.js:totals`, `headcount.html:renderTotals` | `chartLogic.test.ts` totals suite; live "Total headcount: 43" |
| FR-2.2 | Done | `chart-logic.js:totals` | `chartLogic.test.ts` "FR-2.2: groups by raw position string…" |
| FR-2.3 | Done | `chart-logic.js:managerList`, `headcount.html` fieldset block | `chartLogic.test.ts` 4 manager-list tests (incl. root-with-reports and all-root roster) |
| FR-2.4 | Done | `chart-logic.js:visibleIds` | `chartLogic.test.ts` "FR-2.4: deselecting a manager hides their whole subtree…"; live 43→37 |
| FR-2.5 | Done | `chart-logic.js:visibleIds` | `chartLogic.test.ts` "FR-2.5: nested deselection is subtractive" |
| FR-2.6 | Done | `headcount.html:refresh` → `renderTotals` | `chartLogic.test.ts` "FR-2.6: a position whose count falls to zero…"; live 15→14 rows |
| FR-2.7 | Done | `headcount.html:refresh` (message gated on `managers.length > 0`) | `chartLogic.test.ts` "FR-2.7: …only roots remain visible"; live message + headcount 11 |
| FR-3.1 | Done | `src/server/app.ts` `GET /api/headcount` | `headcount.test.ts` five-key projection, `endDate` absence, id order, empty array |
| FR-3.2 | Done | explicit five-field projection | `headcount.test.ts` key-set assertion |
| FR-3.3 | Done | `public/headcount.html` via `express.static` | `headcount.test.ts` "FR-3.3: /headcount.html is served as HTML" |
| FR-3.4 | Done | `headcount.html` catch block | Live: forced 500 → message, totals/filters/chart cleared |
| FR-3.5 | Done | `nav` in both pages | `headcount.test.ts` "FR-3.5: both screens carry both nav links…" |
| FR-3.6 | Done | `public/index.html` `dashboardLink` node | `headcount.test.ts` "FR-3.6: the import screen links onward…" |
| AR-1.1 | Done | flat payload + client-side `buildTree` | Verified: filtering issues no network request |
| AR-1.2 | Done | `COUNTRY_BUCKETS` + `DEFAULT_BUCKET` constants | `chartLogic.test.ts` "AR-1.2: an unmapped country falls through to green" |
| AR-1.3 | Done | plain HTML/JS in `public/`; no build step, no dependency added | `package.json` unchanged |
| AR-1.4 | Done | `element()` helper uses `textContent`; attributes set as properties | Reviewed by inspection — `grep -rn "innerHTML\|insertAdjacentHTML" public/` returns one hit, inside an explanatory comment, and no code use |
| AR-1.5 | Done | iterative `buildTree` and `renderChart` (explicit stack) | `chartLogic.test.ts` "AR-1.5: a 5000-deep chain assembles without overflowing" |
| AR-2.1 | Done | `visibleIds` single top-down pass | `chartLogic.test.ts` visibility suite |
| AR-2.2 | Done | totals computed from the visible set in-browser | `chartLogic.test.ts` "FR-2.6…"; endpoint returns no totals |
| AR-2.3 | Done | `public/chart-logic.js` (no DOM access) | Whole of `chartLogic.test.ts` runs it under `node:test` |
| AR-3.1 | Done | `getAllEmployees()` reused; no new file under `src/db/` | `src/db/` unmodified |
| AR-3.2 | Done | no `checkOrigin`, no CORS middleware | `headcount.test.ts` "AR-3.2: no Origin header is required…" (also asserts no ACAO header) |
| AR-3.3 | Done | route registered in `createApp()` | `withTestServer` picks it up unchanged |
| AR-3.4 | Done | try/catch → fixed `{ error }` + `console.error` | `headcount.test.ts` "AR-3.4: a data-layer failure returns 500…" |

## Deviations from Spec

None. No `ADR.md` was needed.

## Notes for the Reviewer

- **`public/chart-logic.js` is JavaScript, not TypeScript, and is therefore
  outside `npm run typecheck`** (`tsconfig.json` includes only `src/**/*.ts`).
  This is required by AR-1.3 — the browser loads the file directly and there is
  no build step for client code — but it does mean the module's correctness
  rests entirely on `test/dashboard/chartLogic.test.ts` rather than on types.
  Worth a close read.
- **Rendering is verified by live DOM inspection, not by an automated test.**
  FR-1.5, FR-1.8, FR-3.4, and the interactive half of FR-2.4/2.6/2.7 have no
  regression coverage — a future change could break them silently. Adding a
  browser test harness was outside this spec's scope; it is the most valuable
  follow-up.
- **The AR-3.4 test emits a stack trace to stderr on success.** Expected — the
  requirement is that the real error is logged server-side — but it makes the
  suite output noisier than before.

## Review Handoff

Run `/spec-implementation-review 003-headcount-dashboard` before closing this spec.
