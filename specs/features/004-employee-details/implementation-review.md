# Implementation Review: 004-employee-details

**Status:** Approved
**Date:** 2026-08-31
**Reviewed HEAD:** unavailable — this repository is not a git repository (`git rev-parse HEAD` fails)
**Review baseline:** unavailable, same reason — see implementation-summary.md's Review Baseline section, which instead records the pre-implementation test/typecheck state and confirms `data/employees.sqlite` was empty before and after
**Scope confidence:** High — no git to diff against, but every file this spec could plausibly touch was read directly and checked against the spec's declared file list in `implementation-summary.md`; no unrelated changes found

## Reviewed Scope

- `src/server/app.ts` — new `GET /api/employee-details` route, `RATING_PERIOD_TO_KEY`/`mapRatings`, imports
- `public/employeeDetailsLogic.js` — new DOM-independent logic module (full file)
- `public/employee-details.html` — new page (full file)
- `public/index.html`, `public/headcount.html` — nav diffs (three-line change each)
- `test/employeeDetails/employeeDetailsLogic.test.ts`, `test/server/employeeDetails.test.ts` — full test files
- `specs/ARCHITECTURE.md`, `specs/docs/**` — living-docs changes, checked for accuracy and link resolution
- `specs/PROJECT_GUIDELINES.md` — confirmed untouched (correct — no reason for this spec to change it)
- `data/employees.sqlite` — confirmed empty before and after (no side effects from manual verification)

## Evidence

- Spec: `specs/features/004-employee-details/spec.md`
- Implementation summary: `specs/features/004-employee-details/implementation-summary.md`
- Validation: re-ran `npm test` (158 passing, 0 failing — matches the summary's claim) and `npm run typecheck` (clean) independently rather than trusting the summary's figures at face value. Additionally hand-traced `visibleRows`/`sortRows` against three of the spec's own worked examples (the FR-2.4 AND-combination case, the FR-2.3 nested-deselection case, and the AR-3.1 tie-break case) directly against the source to confirm the logic — not only the tests — produces the specified result.

## Requirement Coverage

| Requirement | Review evidence | Result |
| --- | --- | --- |
| FR-1.1 | `src/server/app.ts:127` (`getAllEmployees()` default); `employeeDetails.test.ts:94` "FR-1.1" | Covered |
| FR-1.2 | `employee-details.html:41-51,91-108` (`COLUMNS`, `renderRow`) — order matches FR-4.1's payload key order exactly, `managerId` correctly excluded (no Manager column) | Covered |
| FR-1.3 | `employee-details.html:87-89` (`cellText`) | Covered, but see Finding (suggestion) below re: test placement |
| FR-1.4 | `employee-details.html:206-215` (`renderEmptyState`) | Covered — manually verified live against a freshly-initialised database (per implementation-summary.md) |
| AR-1.1 | `employee-details.html:53-58,65-85` (`textContent`-only text, `.id`/`.htmlFor` direct-property-assignment for checkbox identifiers, generated `position-checkbox-${index}` ids) | Covered |
| AR-1.2 | Plain HTML + ES-module JS, no build tooling referenced | Covered |
| FR-2.1 | `employeeDetailsLogic.js:22-24` (`distinctPositions`); `employeeDetailsLogic.test.ts:63-75` | Covered |
| FR-2.2 | `employee-details.html:147,187-201` (reuses `managerList()` unchanged) | Covered |
| FR-2.3 | `employeeDetailsLogic.js:41-46` (`visibleRows` → `visibleIds`); `employeeDetailsLogic.test.ts:79-90` — hand-verified against the source (see Evidence) | Covered |
| FR-2.4 | `employeeDetailsLogic.js:31-46`; `employeeDetailsLogic.test.ts:92-109` — hand-verified the nested "position selected but manager unchecked" case against the source | Covered |
| FR-2.5 | `employee-details.html:168-169`; `employeeDetailsLogic.test.ts:111-117` (invariant); manually verified live (all 14 position checkboxes unchecked → exact message shown, per implementation-summary.md) | Covered |
| AR-2.1 | `employeeDetailsLogic.js:14` (imports `visibleIds` only); `employee-details.html:35` (imports `managerList` directly) | Covered, with a disclosed nit — see Findings |
| AR-2.2 | `employeeDetailsLogic.js:26-33` (`matchesPosition`, standalone) | Covered |
| AR-2.3 | `employeeDetailsLogic.js` (whole file: filtering, sorting, validation, no DOM access) | Covered |
| FR-3.1 | `employee-details.html:110-130,154-162` (`<button>` in `<th>`, `aria-sort`, single-active-header, arrow glyph, `name`-ascending default) | Covered |
| FR-3.2 | `employeeDetailsLogic.js:48-61,74-89`; `employeeDetailsLogic.test.ts:132-148` | Covered |
| FR-3.3 | `employeeDetailsLogic.js:80-86` (missing-first check runs before the direction sign); `employeeDetailsLogic.test.ts:150-172` (numeric + string column) | Covered |
| FR-3.4 | `employee-details.html:164-169` (`refresh()` re-applies `sortRows` over `visibleRows()`; the file's only `fetch` call is the initial load at line 218) | Covered |
| AR-3.1 | `employeeDetailsLogic.js:16-19,87`; `employeeDetailsLogic.test.ts:174-183` | Covered |
| FR-4.1 | `src/server/app.ts:119-148`; `employeeDetails.test.ts:23-129` (7 cases) | Covered |
| FR-4.2 | `src/server/app.ts:43-67` (`RATING_PERIOD_TO_KEY`/`mapRatings`); `employeeDetails.test.ts:65-78` | Covered |
| FR-4.3 | Served via existing `express.static(PUBLIC_DIR)`; `employeeDetails.test.ts:171-177` | Covered |
| FR-4.4 | `employee-details.html:217-232`; `employeeDetailsLogic.js:122-135` (`isValidPayload`); `employeeDetailsLogic.test.ts:186-236` (automated half); manual browser verification (rendering half, disclosed as such) | Covered |
| FR-4.5 | `public/index.html:20-23`, `public/headcount.html:38-41`, `employee-details.html:21-25`; `employeeDetails.test.ts:186-206` | Covered |
| AR-4.1 | `src/server/app.ts:119` (no `checkOrigin`, no `cors()`); `employeeDetails.test.ts:131-137` | Covered |
| AR-4.2 | `src/server/app.ts:119` (registered inside `createApp()` alongside existing routes) | Covered |
| AR-4.3 | `src/server/app.ts:141-147`; `employeeDetails.test.ts:147-157` | Covered |
| AR-4.4 | `src/server/app.ts:120-122` (`res.set(...)` unconditional, before `try`); `employeeDetails.test.ts:139-145,159-167` (both `200` and `500` paths) | Covered |

## Findings

| Severity | Evidence | Finding | Required action |
| --- | --- | --- | --- |
| suggestion | `public/employee-details.html:87-89` (`cellText`) vs. `public/chart-logic.js:23-25` (`countryBucket`) | FR-1.3's null-→-em-dash rendering rule lives in the page-wiring file, not the DOM-independent `employeeDetailsLogic.js` module, unlike the directly comparable `countryBucket` mapping rule in `chart-logic.js`, which does live in the testable module and is unit-tested (`chartLogic.test.ts`). AR-2.3 states the project's own principle for why this split matters: "this project has no browser test harness, so this split is the only thing that gives client-side rules automated coverage." `cellText` currently has no automated test — only the manual browser verification recorded in `implementation-summary.md`. | Optional: export `cellText` (or equivalent) from `employeeDetailsLogic.js` with a small unit test, for consistency with the established pattern. Not required before closing — the rule is a one-line ternary, already manually verified, and a regression would be immediately visible in any future manual check. |
| nit | `employeeDetailsLogic.js:14`, `employee-details.html:35`, vs. spec's AR-2.1 | AR-2.1 names `buildTree`, `managerList`, and `visibleIds` as imported; the actual code imports only `visibleIds` and `managerList` — `buildTree` is never imported by name, since neither higher-level function this screen uses requires a separate direct call to it. Already disclosed transparently in `implementation-summary.md`'s Deviations section, and confirmed on independent review to be non-functional (the underlying principle — reuse hierarchy traversal, don't duplicate it — is fully satisfied). | None — already disclosed and correctly assessed as non-blocking. |
| nit | `employee-details.html:217-232` | The top-level `try`/`catch` wraps the entire `start()` call, so an unexpected exception during rendering (not just a `fetch`/`.json()` failure) would also be swallowed into the generic load-failure message. This exactly mirrors `headcount.html`'s identical, already-shipped pattern, which was flagged as a non-blocking suggestion in spec 003's own implementation review rather than fixed. Not a regression introduced by this spec. | None — consistent with an already-accepted precedent. |

## Verdict

No blocking findings. Every FR and AR traces to implemented code and either
an automated test or a specifically recorded, disclosed manual-verification
step — consistent with this project's established, accepted limitation that
client-rendering behavior (not the underlying logic) has no browser test
harness to automate. The one substantive suggestion (moving `cellText` into
the testable module) would bring FR-1.3's coverage in line with this
codebase's own existing precedent, but the rule is trivial enough, and
already manually verified, that it does not block approval. The two nits are
either already disclosed by the implementer or inherited, unchanged, from
an already-shipped and already-reviewed pattern in spec 003.

Independent validation (a fresh `npm test`/`npm run typecheck` run, and a
line-by-line trace of the three trickiest filter/sort interactions directly
against the source) confirms the implementation summary's claims rather than
merely restating them.

Next command: `/spec-close 004-employee-details`.
