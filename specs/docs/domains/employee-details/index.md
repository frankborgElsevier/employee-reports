# Employee Details

The app's third screen: a read-only, sortable table of active imported
employees' compensation/rating detail and manually entered contractors'
available identity detail, served at
`/employee-details.html` by the same Express server that hosts the
[WorkDay Import](../workday-import/index.md) and
[Headcount Dashboard](../headcount-dashboard/index.md) screens, reading the
[Data Foundation](../data-foundation/index.md) database.

Implemented by [spec 004-employee-details](../../../features/004-employee-details/spec.md),
extended by [spec 006-employee-details-and-headcount-refinements](../../../features/006-employee-details-and-headcount-refinements/spec.md)
with a Comp Ratio column and manager-filter isolation (see below).
Spec [007-contractor-management](../../../features/007-contractor-management/spec.md)
adds contractor rows and their Worker type column.
Spec [008-headcount-team-and-performance-filters](../../../features/008-headcount-team-and-performance-filters/spec.md)
adds performance-outcome and rating-recency filters.

## What It Shows

- **One row per active worker**: `id`, `name`, `workerType`, `position`,
  current-salary `currency`/`baseSalary`/`bonus`/`compRatio`, and the three fixed rating
  periods (`"Most Recent"`, `"Prior Rating"`, `"Two Year Prior Rating"`),
  each in its own column, in that left-to-right order. `compRatio` (spec
  006) is the WorkDay export's `Base Pay Compa Ratio` column, stored and
  shown as the raw decimal (e.g. `1.141603`), independently nullable from
  the other three salary fields. A contractor shows `Contractor` as their
  worker type and has no WorkDay-sourced compensation or ratings, so every
  one of those cells renders as `—`.
- **A missing salary or rating renders as an em dash (`—`)**, independently
  per cell — a row can be missing salary, some ratings, both, or neither.
- **A checkbox per distinct `position`** and **a checkbox per line manager**
  (anyone with at least one active direct report), both all-selected on
  load, combining as AND.
- **Performance filters** (spec 008): an all-selected checklist of
  Outstanding Performance, Very Strong Performance, Successful Performance,
  and Performance Requires Improvement; and an all-selected rating-recency
  checklist of Most Recent, Prior Rating, and Two Year Prior Rating. A row
  must match a selected category in at least one selected period; every
  populated selected period must match. Missing historic periods are allowed
  for recent joiners, while an all-null selected history does not match. An
  empty recency selection disables only this performance constraint; an empty
  category selection matches no rows. Raw rating text remains unchanged in
  the table and API: browser filter logic maps the four WorkDay values plus
  legacy `Exceeds`/`Exceeds Expectations` and `Meets`/`Meets Expectations`
  aliases to categories; unknown values do not match.
- **Sortable columns** — clicking a header sorts ascending, clicking again
  reverses, clicking a different header switches columns. A missing value
  always sorts last, in either direction.

Everything is derived. No requirement on this screen writes to the database.

## The Manager Filter Reuses `chart-logic.js`, With One Screen-Specific Difference

Unlike the position filter (a plain set-membership check, local to this
screen), the manager filter calls `buildTree`/`managerList`/`visibleIds` from
[`public/chart-logic.js`](../headcount-dashboard/index.md): the same
default-all-checked, uncheck-to-hide-the-subtree-but-not-the-manager's-
own-row behaviour the Headcount Dashboard established. Both screens still
share the exact same hierarchy-traversal code — no duplication — but this
screen (only) passes `visibleIds` a `requireRootSelection` option (spec 006)
that the Headcount Dashboard never sets.

**With every root manager checked** (the default, and the state reached by
re-checking all of them), the Headcount Dashboard's root-is-always-visible
invariant still holds here exactly as before: an unchecked *non-root*
manager can never, by itself, hide the last row.

**As soon as at least one root manager is unchecked**, this screen switches
to isolation mode: only the checked root manager(s) and their descendants
stay visible. Every other root — another root manager (own row and subtree
both), or an individual contributor whose manager reference never
resolved — is hidden entirely, not just their subtree. This is what lets a
user check one manager and see exactly that manager's team, instead of also
seeing every other manager's own row and every unrelated individual
contributor, which the plain reused behaviour above would otherwise still
show. It also means the manager filter alone can now reach zero visible
rows (e.g. every manager unchecked) — unlike the Headcount Dashboard, where
a root is always visible with no exceptions.

## Sorting

Every string column (`id`, `name`, `position`, `currency`, and each rating
column) sorts via `localeCompare`; `baseSalary`/`bonus`/`compRatio` (spec 006)
sort numerically.
Every sort — not only the initial `name`-ascending load — breaks ties by
`name` then `id`. A missing value (the FR-1.3 placeholder) is excluded from
both the string and numeric comparison and always sorts last, regardless of
direction; alphabetical order among *present* rating values carries no
implied performance ranking, since the rating scale itself is undefined (see
[Data Schema & API Contract](../../standards/data-schema.md)).

Sortable headers are `<button>` elements inside each `<th>`, not bare click
targets on the cell, so Enter/Space activates a sort the same way a pointer
click does. Exactly one header carries an active `aria-sort` state at a
time; the direction is also shown as a non-colour arrow glyph.

## The Three Non-Table States

Each has distinct wording, so a reader can tell them apart:

| State | Message |
| --- | --- |
| Database has no active employees | "No employee data yet — import a WorkDay report to get started." (links to the import screen) |
| The combined filter leaves nothing visible (including, since spec 006, the manager filter alone once at least one root manager is unchecked) | "No employees match the current filters." |
| `GET /api/employee-details` failed, or its body is syntactically valid but missing an expected key | "Could not load employee data. Reload the page to try again." |

The failure state treats a malformed-but-parseable response identically to a
network/parse error — the page never renders a partial table from an
incomplete payload. Filters and the table are cleared in that state, so no
stale or partially-derived data remains on screen.

## Code Layout

| Path | Purpose |
| --- | --- |
| `public/employeeDetailsLogic.js` | Position, manager, and performance filtering; canonical rating categories; sorting; and payload-shape validation — pure data in, data out |
| `public/employee-details.html` | The page: position, performance, recency, and manager checkboxes; the sortable table; and DOM wiring around `employeeDetailsLogic.js` and reused `chart-logic.js` functions |
| `src/server/app.ts` | The `GET /api/employee-details` route (see [standards/employee-details-http-api.md](../../standards/employee-details-http-api.md)) |
| `test/employeeDetails/employeeDetailsLogic.test.ts` | Unit tests for the logic module |
| `test/server/employeeDetails.test.ts` | Endpoint and served-page tests |

`employeeDetailsLogic.js` is plain ES-module JavaScript rather than
TypeScript, for the same reason as `chart-logic.js`: the browser loads it
directly and this project has no build step for client code. See
[conventions/browser-screens.md](../../conventions/browser-screens.md).

## Navigation

All four screens carry the same nav — Import (`/index.html`), Headcount
(`/headcount.html`), Employee Details (`/employee-details.html`), and
Contractors (`/contractors.html`) — with the current page's link marked
`aria-current="page"`. The markup is duplicated in each page, matching the
Headcount Dashboard's existing duplicated-nav decision.
