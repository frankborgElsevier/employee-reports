# Headcount Dashboard

The app's second screen: a read-only org chart of active imported employees and
manually entered contractors, served at `/headcount.html` by the same Express server that hosts
the [WorkDay Import](../workday-import/index.md) screen and reading the
[Data Foundation](../data-foundation/index.md) database.

Implemented by [spec 003-headcount-dashboard](../../../features/003-headcount-dashboard/spec.md),
extended by [spec 005-headcount-manager-context](../../../features/005-headcount-manager-context/spec.md)
with team-size badges, external-manager placeholder cards, and manager-first
sibling ordering, and by [spec 006-employee-details-and-headcount-refinements](../../../features/006-employee-details-and-headcount-refinements/spec.md)
with the position-by-region breakdown table described below.
Spec [007-contractor-management](../../../features/007-contractor-management/spec.md)
adds manually entered contractor cards and a Contractors navigation screen.
Spec [010-contractor-reimport-and-headcount-simplification](../../../features/010-contractor-reimport-and-headcount-simplification/spec.md)
removes the former Team breakdown so the screen stays focused on the
position-by-region matrix and org chart.

## What It Shows

- **Total people** and a **position-by-region breakdown table** (specs 006
  and 007), both recomputed from whatever cards are currently visible — the
  numbers always describe what is on screen. External-manager placeholder
  cards (see below) are excluded from both, since they were never part of
  the imported roster. The breakdown table groups positions into eight
  fixed seniority bands (Software Engineer 1/2, Senior 1/2, Principal, Lead,
  Senior Principal, and a catch-all Other), in that fixed order — replacing
  the flat, count-descending list spec 003 originally shipped — and within
  each band breaks the count out by blue/red/green employee country buckets
  plus a purple contractor bucket, a row total, a per-bucket totals row, and a
  grand total that always agrees with the "Total people" figure above
  it. A band with no currently-visible member position, or the whole table
  when nothing is visible at all, is simply omitted/zeroed rather than shown
  padded with zero rows.
- **One card per active worker** showing name, position, and country, nested
  under their line manager to unlimited depth. A card for anyone with at least
  one active report — direct or indirect — also shows `[TeamSize: X]`, `X`
  being the total count of everyone below them at any depth (added in spec
  005; computed client-side in `chart-logic.js`'s `buildTree`, not a separate
  API call).
- **A colour-coded card per location bucket**, except that contractors use a
  lavender/purple engagement-type card with a visible `Contractor` label — see
  [standards/location-colour-buckets.md](../../standards/location-colour-buckets.md).
  An external-manager card (below) uses a distinct `card external` style
  instead, since it has no country.
- **A checkbox per line manager** (anyone with at least one active direct
  report, including an external-manager placeholder), all selected on load,
  controlling which teams are shown.
- **Managers before non-managers.** Within a team, and among root-level
  cards, siblings that themselves have at least one active report sort ahead
  of siblings that don't; within each of those two groups the existing
  alphabetical-by-name order is unchanged (spec 005).

Everything is derived. No requirement on this screen writes to the database.

## External Manager Placeholders (spec 005)

An employee's `Direct Supervisor ID` sometimes names someone outside the
imported file — most commonly the manager who ran the export, since a
WorkDay "Team Market Range Analysis for Managers" report scopes to one
manager's org and never includes that manager's own row (see
[WorkDay Import](../workday-import/index.md)). When the raw file also carried
that supervisor's *name* in a separate column, the import captures it and the
dashboard renders one placeholder card per such name, styled distinctly
(`card external`, with a `(not in imported data)` label after the name, no
position/country line) with that manager's reports nested underneath it —
exactly like a real manager's card, including its own `[TeamSize: X]` badge
and checkbox entry. Reimporting the reference export now renders it as **1
root** (the report-running manager, "Frank Borg", `TeamSize: 43`) instead of
11 disconnected roots — see
[standards/headcount-http-api.md](../../standards/headcount-http-api.md#external-manager-entries-spec-005).

## Roots Are Not Always Named

A real employee still renders at the top level, with no placeholder card
above them, whenever their `manager_id` is `NULL`, or names someone absent
from the payload *and* no name for that supervisor id was ever captured (the
raw file lacked the optional name column, or the cell was blank for every row
that referenced it). This is also the path reached when an import
soft-inactivates a mid-level manager whose reports stay active: the reports
remain visible as roots rather than disappearing from the chart, since no
"external manager" concept applies to an inactive *real* employee (spec 005's
Out of Scope).

A non-empty payload always has at least one root, since the manager graph is
finite and `reassignManager` (`src/db/mutations.ts`) rejects cycles before
writing. The chart can never be empty while employees exist.

## Filtering

A checkbox controls its manager's *team*, never the manager's own card. An
employee is visible only if every manager above them in their chain is
selected, so deselections are subtractive: hiding a manager whose ancestor is
already hidden changes nothing, and re-showing the ancestor restores
descendants according to their own checkbox states.

Roots have nobody above them, so no checkbox can hide them — with every box
deselected, every root card (real or external-manager placeholder) remains and
the screen says so. On an all-root roster (nobody has reports) the filter
group is omitted entirely rather than rendered empty.

Visibility is recomputed in a single top-down pass from the roots rather than by
walking each employee's ancestor chain, which keeps re-filtering O(n) instead of
O(n·depth).

## The Three Non-Chart States

Each has distinct wording, so a reader can tell them apart:

| State | Message |
| --- | --- |
| Database has no active employees | "No employee data yet — import a WorkDay report to get started." (links to the import screen) |
| Every manager checkbox deselected (and at least one exists) | "No manager teams selected — showing employees who report to nobody." |
| `GET /api/headcount` failed | "Could not load employee data. Reload the page to try again." |

The load-failure state also clears the totals and the filter group, so no stale
or zero-derived number can be mistaken for a real one. The colour legend and
navigation survive all three.

## Code Layout

| Path | Purpose |
| --- | --- |
| `public/chart-logic.js` | Tree assembly, colour bucketing, manager list, visibility, totals, and position-region breakdown — pure data in, data out |
| `public/headcount.html` | The page: styles, colour legend, and DOM wiring for the headline and position-region matrix |
| `src/server/app.ts` | The `GET /api/headcount` route (see [standards/headcount-http-api.md](../../standards/headcount-http-api.md)) |
| `test/dashboard/chartLogic.test.ts` | Unit tests for the logic module |
| `test/server/headcount.test.ts` | Endpoint and served-page tests |

`chart-logic.js` is plain ES-module JavaScript rather than TypeScript because
the browser loads it directly and this project has no build step for client
code. The tests import the same file the browser runs. See
[conventions/browser-screens.md](../../conventions/browser-screens.md).

## Navigation

All four screens carry the same nav — Import (`/index.html`), Headcount
(`/headcount.html`), Employee Details (`/employee-details.html`), and
Contractors (`/contractors.html`) — with the current page's link marked
`aria-current="page"`. The markup is duplicated in each page; with four
static pages a templating layer still costs more than it saves. A successful
import also appends a link to the dashboard, so the natural next action is one
click away.

The root URL (`/`) is not a static page: it redirects to Headcount whenever
there is at least one active employee or contractor, and redirects to Import
only when the active roster is empty.
