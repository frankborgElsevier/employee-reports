# Implementation Review: 003-headcount-dashboard

**Status:** Approved
**Date:** 2026-08-31
**Reviewed HEAD:** unavailable — not a git repository
**Review baseline:** unavailable — recorded as such in the implementation summary
**Scope confidence:** Limited — no VCS baseline exists, so scope is taken from
the summary's declared file lists rather than a diff. The declared lists were
checked against the filesystem and are consistent with the spec; no attribution
of unrelated code was possible or attempted.

## Reviewed Scope

- `public/chart-logic.js` — the whole of Features 1–2's logic; outside
  typechecking, so its correctness rests entirely on its tests.
- `public/headcount.html` — DOM wiring, the three non-chart states, styles
  backing FR-1.5 and FR-1.7.
- `src/server/app.ts` — the new route and its placement relative to existing
  middleware and routes.
- `public/index.html` — the nav and post-import link edits to a previously
  reviewed, working screen (regression risk).
- `test/dashboard/chartLogic.test.ts`, `test/server/headcount.test.ts` — whether
  the tests exercise behaviour or restate the implementation.
- `specs/docs/` pages and `specs/ARCHITECTURE.md` — whether the docs now state
  the implemented behaviour accurately.

## Evidence

- Spec: `specs/features/003-headcount-dashboard/spec.md`
- Implementation summary: `specs/features/003-headcount-dashboard/implementation-summary.md`
- Validation: the summary's recorded evidence (`npm test` 129 pass / 0 fail
  from a 100-pass baseline, typecheck and build clean) was taken as current —
  it was produced in this session against the reviewed files. Two targeted
  read-only checks were run to confirm specific findings: the endpoint's
  response headers (`curl -D -` against a scratch server) and call-site greps
  for `isRoot` and `buildTree`.

## Requirement Coverage

| Requirement | Review evidence | Result |
| --- | --- | --- |
| FR-1.1 | `src/server/app.ts:66` via `getAllEmployees()` default; `headcount.test.ts` "FR-1.1: inactive employees are excluded" | Covered |
| FR-1.2 | `chart-logic.js:28` `byNameThenId`, `headcount.html:78` `renderCard`; `chartLogic.test.ts` ordering test; live DOM 43 cards | Covered (see nit N3 on card/container structure) |
| FR-1.3 | `chart-logic.js:40` `buildTree`, `headcount.html:93` `renderChart`; "FR-1.3: nests to full depth" | Covered |
| FR-1.4 | `chart-logic.js:46-51` (unresolved parent → root); two tests naming FR-1.4 | Covered |
| FR-1.5 | `.team` rule `headcount.html:27`; live geometry check (+38px, 2px border) | Covered — no regression test (S2) |
| FR-1.6 | `chart-logic.js:14-25`; "FR-1.6"/"AR-1.2" tests; live 29/13/1 | Covered |
| FR-1.7 | `headcount.html:19-21,44-48`; `headcount.test.ts` "FR-1.7: the three bucket colours…" asserts the hex values and legend text | Covered |
| FR-1.8 | `headcount.html:178` `renderEmptyState`; live empty-DB check | Covered — no regression test (S2) |
| FR-2.1 | `chart-logic.js:126` `totals`; `headcount.html:119` | Covered |
| FR-2.2 | `chart-logic.js:132-134` sort; "FR-2.2: groups by raw position string…" asserts both spellings stay distinct | Covered |
| FR-2.3 | `chart-logic.js:72` `managerList`; `headcount.html:151-171`; 4 tests incl. root-with-reports and all-root roster | Covered |
| FR-2.4 | `chart-logic.js:99` `visibleIds`; test + live 43→37 | Covered — interactive path untested (S2) |
| FR-2.5 | `chart-logic.js:104-114`; "FR-2.5: nested deselection is subtractive" exercises both orderings | Covered |
| FR-2.6 | `headcount.html:138` `refresh`; "FR-2.6: a position whose count falls to zero…" | Covered |
| FR-2.7 | `headcount.html:146-149`, message gated on `managers.length > 0`; test + live | Covered |
| FR-3.1 | `src/server/app.ts:61-73`; 5 endpoint tests (key set, `endDate` absence, id order, empty array) | Covered |
| FR-3.2 | `src/server/app.ts:66-72` explicit projection; key-set assertion | Covered |
| FR-3.3 | `public/headcount.html` via existing `express.static`; "FR-3.3" test | Covered |
| FR-3.4 | `headcount.html:194-202`; live forced-500 check | Covered — over-broad catch (S1) |
| FR-3.5 | nav in both pages; "FR-3.5: both screens carry both nav links…" asserts hrefs and `aria-current` on each page | Covered |
| FR-3.6 | `index.html:94-97` DOM-node link; "FR-3.6" test | Covered |
| AR-1.1 | flat payload, client-side assembly; no fetch in `refresh` | Covered |
| AR-1.2 | `COUNTRY_BUCKETS` + `DEFAULT_BUCKET`, single definition | Covered |
| AR-1.3 | no dependency, no build step; `package.json` unchanged | Covered |
| AR-1.4 | `element()` sets `textContent`; `grep` finds no `innerHTML` in code (one comment mention) | Covered |
| AR-1.5 | explicit stacks in `buildTree` and `renderChart`; 5000-deep chain test | Covered |
| AR-2.1 | `visibleIds` single top-down pass, no ancestor walk | Covered |
| AR-2.2 | totals computed in-browser; endpoint returns no totals | Covered |
| AR-2.3 | `chart-logic.js` has no DOM reference; entire logic suite runs it under `node:test` | Covered |
| AR-3.1 | no change under `src/db/`; `getAllEmployees()` reused | Covered |
| AR-3.2 | no `checkOrigin` on the route; test asserts absent `Access-Control-Allow-Origin` | Covered |
| AR-3.3 | route inside `createApp()`; `withTestServer` unchanged | Covered |
| AR-3.4 | `src/server/app.ts:74-82` catch → fixed body + `console.error`; test asserts exact body | Covered |

All 21 FRs and 12 ARs trace to implementation and evidence. No requirement is
missing, partially implemented, or silently altered.

## Findings

| Severity | Evidence | Finding | Required action |
| --- | --- | --- | --- |
| suggestion | `public/headcount.html:188-202` | **The load-failure catch is wider than FR-3.4.** `start(body.employees)` sits inside the same `try`, so any exception thrown while building the tree, filters, or cards is reported as "Could not load employee data. Reload the page to try again." FR-3.4 scopes that message to a fetch failure (non-`200`, network, or parse error). A rendering defect would therefore present as a transient load problem, inviting a reload that cannot fix it — and the bare `catch` discards the error, so nothing reaches the console either. | Narrow the `try` to the fetch and parse, or re-throw after logging, so a render bug is distinguishable from a load failure. Not blocking: every path the spec specifies behaves correctly. |
| suggestion | `implementation-summary.md` "Notes for the Reviewer"; no test file | **Rendering has no regression coverage.** FR-1.5, FR-1.8, FR-3.4, and the interactive halves of FR-2.4/FR-2.6/FR-2.7 were verified once by live DOM inspection. That evidence is real and was checked, but it does not re-run: a later change can break these silently. The logic module and endpoint are well covered; the gap is exactly the DOM wiring AR-2.3 deliberately left thin. | Track a browser/DOM test harness as follow-up work. Correctly disclosed by the implementer rather than glossed, which is why this is not blocking. |
| nit | `public/chart-logic.js:63` | **`isRoot` is exported but never called** — no call site in `chart-logic.js`, `headcount.html`, or the tests. Root detection lives inline in `buildTree:46-51`, so this is a second, untested definition of the same rule that can drift from it. | Delete it, or use it in `buildTree` so there is one definition. |
| nit | `public/chart-logic.js:100`, `public/headcount.html:94` | **`buildTree` runs twice per filter toggle** — once inside `visibleIds`, once in `renderChart`. AR-2.1's complexity requirement still holds (both are O(n log n), not O(n·depth)), and at 43 rows this is invisible, but the payload is bounded at 5000 and the duplication is avoidable by passing the built tree in. | Optional. Consider building once in `refresh` and passing it down. |
| nit | `public/headcount.html:106-111` | **Manager card and team container are siblings, not header-and-body.** FR-1.2 says the manager's card serves "as the header of the container holding their reports"; the implementation appends the card and then a separate `.team` div beside it. Visually and behaviourally identical — the card stays when the team is hidden, which is what FR-2.4 requires — but the DOM does not match the spec's structural wording. | Either restructure so the card sits inside the team container as its header, or note in the spec that sibling ordering satisfies the intent. Nothing depends on it today. |
| nit | endpoint response headers (verified via `curl -D -`) | **`GET /api/headcount` sets `ETag` but no `Cache-Control`.** Express's default. Absent `Cache-Control`/`Last-Modified`, browsers normally revalidate, and the `ETag` makes a stale body unlikely — but the spec's "seeing new data after an import means reloading the page" (Out of Scope) rests on that reload actually re-fetching. | Optional: `Cache-Control: no-store` would make the guarantee explicit rather than dependent on browser heuristics. |

## Notable Strengths

Worth recording, since a review that lists only faults misrepresents the work:

- **Reference-data claims were verified, not asserted.** The 43/29/13/1/5/11
  figures in the spec and docs were confirmed by importing the real export and
  reading the live DOM. Several were originally written from a parse of the
  workbook, and the end-to-end check is what makes them evidence.
- **The tests assert behaviour, not implementation.** `FR-2.5`'s test exercises
  both deselection orderings; `FR-2.2`'s test pins the two near-identical
  position spellings apart; `AR-1.5`'s test builds an actual 5000-deep chain
  rather than asserting that a loop exists.
- **AR-3.4's failure path is genuinely exercised** via `closeDatabase()`, rather
  than being declared untestable or hidden behind a new injection seam.
- **The living docs record decisions, not just descriptions** — `browser-screens.md`
  captures a convention (`public/` is JavaScript because AR-1.3 forbids a build
  step) that was previously implicit and would otherwise have been rediscovered.

## Verdict

**Approved.** Every FR and AR traces to implementation and to verification
evidence; the test suite went from 100 to 129 passing with no regressions;
typecheck and build are clean; no deviation from the spec was found, and none
was claimed. The findings above are one meaningful robustness improvement (S1),
one disclosed coverage gap with a clear follow-up (S2), and four nits — none of
which invalidates the implementation or leaves a requirement unmet.

Two scope caveats a later reader should keep: this project is not a git
repository, so the review rests on the summary's declared file lists rather than
a diff; and `public/chart-logic.js` is outside `npm run typecheck` by design, so
its guarantees come from `test/dashboard/chartLogic.test.ts` alone.

Next: `/spec-close 003-headcount-dashboard`.
