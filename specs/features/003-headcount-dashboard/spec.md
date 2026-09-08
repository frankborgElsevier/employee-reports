# Spec 003: Headcount Dashboard Screen

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-08-31.
> Implementation summary: `specs/features/003-headcount-dashboard/implementation-summary.md`
> Implementation review: `specs/features/003-headcount-dashboard/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

A read-only browser screen that renders the imported org as an org-chart-style
layout: one card per active employee (name, position, country), nested under
their line manager, colour-coded by location country (UK/US = blue, India = red,
everywhere else = green). Above the chart sit a total-headcount figure and a
totals-by-position breakdown, plus a checkbox list of line managers controlling
which teams are shown. This is the second screen in the app, so it also
introduces the minimal shared navigation between the existing WorkDay Import
screen and this one.

## Goals

- Give the user a single visual answer to "who works for whom, where are they,
  and how many of each role do we have?" from data already in the database.
- Establish a read-only JSON API pattern (`GET /api/headcount`) alongside the
  existing write-oriented import endpoints.
- Introduce a thin navigation shell so a second screen is reachable without
  typing a URL, and so the fourth screen (Employee Details) only has to add a
  link.
- Keep the dashboard entirely derived — it reads the database and never writes
  to it.

---

## Feature 1: Org Chart Rendering

**Who & why:** The user is a manager-of-managers who has just imported a
WorkDay export and wants to see the shape of their org at a glance. Today the
data exists only in SQLite with no way to look at it — the import screen reports
`43 added` and nothing more. They need to see the reporting structure, spot who
sits where geographically, and confirm the import landed the people they
expected.

### Functional Requirements

#### FR-1.1: Active employees only

The dashboard renders only active employees — those whose `end_date` is `NULL`.
Employees soft-inactivated by a previous import (spec 002 FR-2.3) are absent
from the chart, from all totals, and from the manager checkbox list. This
follows the `includeInactive: false` default of `getAllEmployees()` (the same
default `getDescendants()` and `getAncestors()` carry); no UI affordance to
include inactive employees exists in this spec.

**Verify:** With one employee's `end_date` set to a date and all others `NULL`,
the rendered page contains no card for that employee and the total headcount
equals the count of the remaining employees.

#### FR-1.2: One card per employee

Each active employee renders as a single card showing exactly three pieces of
text: their `name`, their `position`, and their `country`. An employee who is
also a manager renders exactly one card for themselves, serving as the header of
the container holding their reports — they are never duplicated as both a
standalone card and a team member card. Sibling cards at any level, and root
cards at the top level, are ordered by `name` ascending, with `id` ascending as
the tie-break. The payload arrives in `id` order (FR-3.1), which is not the
render order — the browser sorts.

**Verify:** For the reference file in `workday_docs_examples/`, the page
contains exactly 43 employee cards, and the manager `00000622695` (who has 8
direct reports) appears in exactly one card, not in nine.

#### FR-1.3: Full-depth nesting under each root

The chart renders the complete reporting tree: every employee appears nested
beneath their manager, to unlimited depth. An employee who is a root (FR-1.4)
renders at the top level of the chart. A dataset routinely has several roots —
spec 002 FR-2.2 sets `manager_id` to `NULL` whenever a row's `Direct Supervisor
ID` names someone absent from the import file — and all of them render, one tree
each.

**Verify:** In a dataset where A manages B and B manages C, C's card is rendered
inside B's subtree, which is rendered inside A's subtree — three levels deep —
and A is the only card at the top level.

#### FR-1.4: An unresolvable manager makes an employee a root

An employee is a root if their `manager_id` is `NULL`, **or** if their
`manager_id` does not resolve to an employee in the payload (FR-3.1) — not the
currently-visible set, so root-ness never changes as checkboxes toggle. The
second case is reachable in normal operation: an import can soft-inactivate a
mid-level manager while their reports stay active, leaving those reports
pointing at someone FR-1.1 excludes. Such employees render at the top level
rather than disappearing from the chart, and they count in the totals like any
other visible employee. Because no employee has a manager above them, no
checkbox can hide a root (FR-2.4).

A non-empty payload always contains at least one root: the manager graph is
finite and cycle-free (AR-1.5), so following any chain upward terminates. The
chart therefore can never render empty while employees exist, and FR-1.8's
empty state and FR-2.7's all-deselected state can never both apply.

**Verify:** In a dataset where A manages B and B manages C, setting B's
`end_date` renders A and C both at the top level, with C's card present and the
total headcount reading 2.

#### FR-1.5: Nesting depth is visually distinguishable

Each level of nesting is visually distinct from its parent (e.g. indentation or
a containing box), so a reader can tell a manager's direct reports from their
skip-level reports without counting. Depth is unbounded in principle; the
rendering must remain correct (not necessarily pretty) at any depth the data
produces.

**Verify:** In the A→B→C dataset from FR-1.3, C's card is rendered at a greater
horizontal offset (or inside one more nesting container) than B's, and B's than
A's.

#### FR-1.6: Location colour-coding

Every card carries a background colour derived from the employee's `country`
value: **blue** for the United Kingdom and the United States, **red** for India,
**green** for every other country, including a country not present in the
mapping table (AR-1.2). The colour is derived per-employee from that employee's
own `country`; a manager whose reports sit in other countries still shows their
own personal location colour.

**Verify:** Importing the reference file produces 26 blue cards (United
Kingdom), 3 blue (United States of America), 13 red (India), and 1 green
(Netherlands) — 29 blue, 13 red, 1 green in total.

#### FR-1.7: Colour legend and non-colour redundancy

The screen displays a legend naming each colour bucket and the countries it
covers ("Blue — UK & US", "Red — India", "Green — all other countries"). Colour
is never the only carrier of information: FR-1.2's card `country` text is the
required mitigation for this, because the red and green buckets are exactly the
pair most affected by common colour-vision deficiency.

The three bucket colours are fixed so the contrast requirement is checkable
rather than asserted — card text `#1a1a1a` on blue `#d6e4f7`, red `#f7d6d6`, or
green `#d9f0dc`, giving WCAG contrast ratios of 13.5:1, 12.9:1, and 14.5:1
respectively, all far above the 4.5:1 minimum. A long `country` value wraps
rather than breaking the card layout.

**Verify:** The rendered page contains the text of all three legend entries, a
card for a Netherlands employee contains the string "Netherlands", and each
bucket's rendered background is the hex value named above.

#### FR-1.8: Empty database

When no active employees exist — a database that has never been imported into,
or one where every employee is inactive — the screen renders an explanatory
message ("No employee data yet — import a WorkDay report to get started.")
rather than an empty chart or an error. The message links to the Import screen.

**Verify:** Requesting the dashboard against a freshly-initialised, empty
database returns a `200` page containing the empty-state message and a link to
the import screen, with zero employee cards.

### Architectural Requirements

#### AR-1.1: Tree assembly happens client-side from a flat payload

The server returns a flat list of employees with their `managerId` (FR-3.1); the
browser assembles the parent/child tree. This keeps the endpoint's shape simple
and stable, and keeps re-filtering (Feature 2) a pure client-side operation with
no extra round trip.

#### AR-1.2: The country-to-colour mapping is a single named constant

The UK/US/India/other bucketing lives in one exported constant in a single
module (a country-string → bucket map plus a default bucket), not inlined at
call sites. The raw `country` values it matches are those the WorkDay export
produces — the reference file yields `United Kingdom`, `United States of
America`, `India`, and `Netherlands`. The mapping must recognise, at minimum:
`United Kingdom` and `United States of America` → blue; `India` → red.
Everything else falls through to green by default, so an unrecognised or
newly-appearing country never crashes or renders colourless.

#### AR-1.3: No new frontend framework

The screen is plain HTML plus vanilla JavaScript served from `public/`, matching
`public/index.html` (spec 002). No build step, bundler, or UI framework is
introduced.

#### AR-1.4: Rendering is XSS-safe

All employee-derived text (`name`, `position`, `country`) reaches the DOM
through `textContent` or an equivalent escaping path, never through
`innerHTML`/`insertAdjacentHTML` string concatenation. The same applies to
attribute values (`title`, `data-*`, `aria-label`): set via `setAttribute` with
a text value, never built by template-string interpolation. Employee names and
positions originate in an uploaded spreadsheet and are therefore untrusted
input, even in a single-user local app.

#### AR-1.5: Tree assembly and rendering are iterative

Neither building the tree nor rendering it uses unbounded recursion — a
5000-employee chain (the ceiling spec 002's `MAX_DATA_ROWS` permits) must render
rather than overflow the stack. Cycles and duplicate ids need no defensive
handling: `employees.id` is a `PRIMARY KEY`, and `reassignManager`
(`src/db/mutations.ts`) rejects direct and transitive cycles before writing, so
neither can reach the payload from this database.

---

## Feature 2: Headcount Totals & Manager Filtering

**Who & why:** The same user needs numbers, not just a picture: how many people
do I have, and how are they distributed across roles? They also need to narrow
the view — with several manager teams on one page the chart gets long, and the
question is usually about one or two teams at a time. Crucially, when they hide
a team the totals must follow, or the numbers on screen contradict the cards on
screen.

### Functional Requirements

#### FR-2.1: Total headcount

The screen displays a total headcount: the number of employee cards currently
visible. With no filtering applied, this equals the number of active employees.

**Verify:** With the reference file imported and all manager checkboxes
selected, the total headcount reads 43.

#### FR-2.2: Totals by position

The screen displays a breakdown of currently-visible employees grouped by their
exact `position` string, each row showing the position and its count, sorted by
count descending then position ascending (so the ordering is deterministic when
counts tie). Positions are grouped on the raw string with no normalisation —
`Consult/Prin Quality Test Engr` and `Consulting/Principal Quality Test Engineer`
are two distinct positions, because the source report contains both and the app
has no authority to decide they are the same role.

**Verify:** With the reference file imported and no filtering, the breakdown
contains a row `Senior Software Engineer I — 6` and separate rows for
`Consult/Prin Quality Test Engr — 1` and `Consulting/Principal Quality Test
Engineer — 3`; the sum of all row counts equals 43.

#### FR-2.3: Manager checkbox list

The screen displays one checkbox per active employee who has at least one active
direct report. Each checkbox is keyed by the manager's `id` and labelled with
their `name`; where two managers share a name, both labels are disambiguated as
`Name (id)`. The list is sorted by `name` ascending with `id` ascending as the
tie-break, matching the card ordering in FR-1.2, and is wrapped in a `fieldset`
with a `legend` so the group is announced as one control set. All checkboxes are
selected by default on page load. An employee with no direct reports never
appears in this list.

Having reports and having a manager are independent: a root (FR-1.4) with direct
reports gets a checkbox like any other manager — which is the normal case in the
reference data, where all 5 managers are roots. A checkbox controls its
manager's team, never the manager's own card (FR-2.4), so an employee with no
manager is visible in every checkbox state.

When no active employee has an active direct report — an all-root roster, which
an export omitting the mid-level managers would produce — there is nothing to
filter, and the `fieldset` is omitted entirely rather than rendered empty.

**Verify:** With the reference file imported, the checkbox list contains exactly
5 entries, keyed to ids `00000622695`, `00000289830`, `00000273460`,
`00000628358`, and `00000658249` — the only employees in that file with direct
reports — every box is checked on load, and no individual contributor appears in
the list.

#### FR-2.4: Deselecting a manager hides their team

Deselecting a manager's checkbox hides that manager's direct reports and their
entire subtree (all indirect reports), but not the manager's own card — the
manager remains visible in the position they occupy in their own manager's tree.
Reselecting restores the subtree. Filtering never triggers a network request;
it operates on data already loaded (AR-1.1).

**Verify:** In the A→B→C dataset, deselecting A hides B's and C's cards while
A's card remains; reselecting A restores both.

#### FR-2.5: Nested deselection is subtractive

When a manager is hidden because an ancestor manager was deselected, their own
checkbox state is left unchanged but has no effect while they are hidden — an
employee is visible only if every manager above them in their chain is selected.
Re-selecting the ancestor restores the descendants according to their own
current checkbox states.

**Verify:** In the A→B→C dataset, deselecting B then deselecting A hides both B
and C; reselecting A leaves C hidden (because B is still deselected) and shows
B.

#### FR-2.6: Totals recount over the visible set

Total headcount (FR-2.1) and the totals-by-position breakdown (FR-2.2) are
recomputed from the currently-visible cards every time the filter changes, so
the numbers on screen always describe exactly the cards on screen. A position
whose count falls to zero is removed from the breakdown rather than shown as
`— 0`.

**Verify:** In a dataset of 5 employees where deselecting manager A hides 2 of
them, the total headcount changes from 5 to 3 and the position rows for those 2
employees' positions decrease (or disappear) accordingly.

#### FR-2.7: Deselecting every manager

With every manager checkbox deselected, only roots (FR-1.4) remain visible; the
totals reflect that reduced set — including the position breakdown, which shows
the roots' positions and needs no special-casing for this state — and never
display a stale figure. The chart area additionally shows the message "No
manager teams selected — showing employees who report to nobody.", which is
distinct from FR-1.8's never-imported empty state and from FR-3.4's
load-failure state. The message appears only when at least one checkbox exists:
on an all-root roster there are no checkboxes (FR-2.3), so the chart is complete
rather than filtered and the message would be misleading. The chart is never
empty in this state, since a non-empty payload always has at least one root
(FR-1.4).

**Verify:** Deselecting all checkboxes in the reference dataset leaves the 11
root-level cards visible (the employees whose supervisor `00000270149` is absent
from the file, including the 5 managers themselves), the total headcount reads
11, and the "No manager teams selected" message is shown.

### Architectural Requirements

#### AR-2.1: Visibility is derived in one top-down pass

Card visibility is recomputed from the checkbox state on every change, rather
than maintained as a mutable "hidden" flag per card — this keeps FR-2.5's
subtractive behaviour correct by construction and avoids the class of bug where
a card's stored state and its ancestors' states disagree. The computation is a
single traversal from the roots down: a node is visible if its parent is visible
and its parent's checkbox is selected. Walking each node's ancestor chain
independently would instead be O(n·depth) — around 12.5M checks per toggle at
spec 002's 5000-row ceiling with a pathologically deep chain — where one
top-down pass is O(n) for the same result.

#### AR-2.2: Totals are computed from the visible set, not fetched

Both totals are computed in the browser from the same in-memory visible-employee
set the chart renders, so they cannot drift from the cards. The server does not
provide precomputed totals.

#### AR-2.3: Chart logic is DOM-independent and unit-testable

Tree assembly (FR-1.3, FR-1.4), visibility propagation (FR-2.4, FR-2.5), and
totals (FR-2.1, FR-2.2) live in a plain importable module that takes the payload
and the checkbox state as data and returns data — no DOM access. Only thin
wiring (creating elements, attaching listeners) sits outside it. This project
has no browser test harness, so this split is the only thing that gives the
subtlest requirements here automated coverage.

---

## Feature 3: Headcount API & Navigation Shell

**Who & why:** The dashboard needs its data from the server, and the server
currently exposes only two write-oriented import endpoints. Separately, this is
the app's second screen — until now `public/index.html` was the whole UI and
`npm start` opened it directly. Without navigation, the user has no way to reach
the dashboard other than typing a URL, and the third screen (spec 4) would face
the same problem.

### Functional Requirements

#### FR-3.1: `GET /api/headcount`

A read-only endpoint returning `200` with a JSON body
`{ employees: [{ id, name, position, country, managerId }] }`, containing every
active employee (FR-1.1) in the order `getAllEmployees()` returns them (`id`
ascending, lexicographic). Each entry is an explicit projection of exactly those
five fields — not the `Employee` object passed through, which would also
serialise `endDate`. `managerId` is `null` for an employee with no manager. The
endpoint never writes to the database. It returns `{ employees: [] }` — not an
error — when no active employees exist.

**Verify:** With the reference file imported, `GET /api/headcount` returns `200`
and a body whose `employees` array has 43 entries, each with exactly the five
named keys and no others.

#### FR-3.2: The endpoint excludes salary and rating data

The payload carries no salary, bonus, currency, or performance-rating fields.
The dashboard displays none of them, and compensation data must not be shipped
to the browser by a screen that has no use for it.

**Verify:** Every entry in the `GET /api/headcount` response has exactly the key
set `{id, name, position, country, managerId}` — asserted on the parsed object's
keys, not as a substring search over the serialised body, which an employee
whose name or title legitimately contains "Currency" or "Rating" would fail.

#### FR-3.3: Dashboard page served from `public/`

The dashboard is a static page served by the existing `express.static(PUBLIC_DIR)`
middleware at a stable path (`/headcount.html`), fetching `GET /api/headcount`
on load and rendering per Features 1 and 2.

**Verify:** `GET /headcount.html` returns `200` with an HTML content type from a
running server.

#### FR-3.4: Fetch failure is surfaced, not silent

If `GET /api/headcount` fails (non-`200`, or a network/parse error), the screen
displays "Could not load employee data. Reload the page to try again." in place
of the chart, and clears the totals and the manager checkbox list so no stale or
zero-derived numbers remain on screen; the colour legend and navigation stay.
All failure causes produce this one message — the user's only recourse is a
reload, so distinguishing `404` from `500` would give them nothing to act on. A
load failure must never be mistakable for FR-1.8's genuinely-empty database.

**Verify:** With the endpoint stubbed to return `500`, the page displays the
load-failure message, displays no total headcount, and displays no checkboxes.

#### FR-3.5: Shared navigation between screens

Both screens display the same navigation element, carrying both links on both
pages: "Import" → `/` and "Headcount" → `/headcount.html`. On each page the link
pointing at the current screen is marked `aria-current="page"` and visually
distinguished. The Import link is `/`, not `/index.html`, because `/` is the URL
`src/server/start.ts` opens and the one the user lands on. The import screen
stays where it is — `public/index.html`, served at `/` by the existing static
middleware — and gains the nav in place; there is no redirect, no new route, and
no change to the URL `src/server/start.ts` opens. The nav markup is duplicated
in each page rather than shared through a template or JS module: there are two
pages, and a templating layer would cost more than it saves.

**Verify:** After `npm start`, the opened page displays both nav links with the
Import link marked current, and clicking "Headcount" loads the dashboard; the
import upload/confirm flow still works unchanged from that screen.

#### FR-3.6: Import-to-dashboard continuity

After a successful import confirmation on the Import screen, the success message
includes a link to the Headcount dashboard, so the user's natural next action —
looking at what they just imported — is one click away. The link is appended as
a DOM node: `showResult(text)` in `public/index.html` assigns `textContent`, so
passing markup through it would render the link as literal text, and changing it
to `innerHTML` would undo that function's XSS safety (AR-1.4).

**Verify:** Completing a successful confirm on the import screen renders a
success message containing a clickable link to the dashboard path.

### Architectural Requirements

#### AR-3.1: The endpoint reuses `src/db/queries.ts` unchanged

`GET /api/headcount` is built on the existing `getAllEmployees()` function
(default `includeInactive: false`). This spec adds no SQL, no schema change, and
no new file under `src/db/` — the read it needs already exists, and the data
access layer convention (`specs/docs/conventions/data-access-layer.md`) directs
new features to reuse it rather than introduce a parallel one.

#### AR-3.2: No `Origin` check and no CORS headers on the read endpoint

Unlike `/api/preview` and `/api/confirm`, which are guarded by `checkOrigin` in
`src/server/app.ts`, `GET /api/headcount` performs no state change and therefore
carries no CSRF risk; a `GET` handler is not given a CSRF guard it does not
need. No CORS headers are added either: without
`Access-Control-Allow-Origin`, the browser's default policy already stops
another page the user has open from reading the roster off this port. The server
remains bound to `127.0.0.1` (spec 002).

#### AR-3.3: Route registration follows the existing app factory

The route is registered inside `createApp()` in `src/server/app.ts`, alongside
the existing routes, so `test/server/helpers.ts:withTestServer` picks it up with
no change to the test harness.

#### AR-3.4: The handler catches everything and reports generically

Any exception reaching the handler produces `500` with the JSON body
`{ "error": "Could not load employee data." }` — matching the error shape the
import routes already use — rather than propagating to Express's default HTML
error page. The message is fixed and generic; the real error is logged
server-side. This path is reachable from a test without any new injection seam:
`closeDatabase()` is safe to call at any time and `getConnection()` throws
`InitializationError` once no connection is open (`src/db/connection.ts`), so a
test closes the database inside `withTestServer` and issues the request.
Unlike the import routes, whose messages are
user-actionable validation feedback (`describeFailure` in `src/server/app.ts`),
a failure here tells the user nothing they can act on and would only risk
putting internal detail such as filesystem paths into a browser-readable
response.

---

## Data Requirements

Read-only against the spec 001 schema; this spec adds no tables, columns, or
indexes.

| Source | Field | Used for |
| --- | --- | --- |
| `employees` | `id` | Card identity, tree assembly, checkbox key, payload key |
| `employees` | `name` | Card label (FR-1.2), checkbox label and sort (FR-2.3) |
| `employees` | `position` | Card label (FR-1.2), totals-by-position (FR-2.2) |
| `employees` | `country` | Colour bucket (FR-1.6), card text (FR-1.2, FR-1.7) |
| `employees` | `manager_id` | Tree nesting (FR-1.3), root detection (FR-1.4), filter subtree walk (FR-2.4) |
| `employees` | `end_date` | Active filter (FR-1.1), via `getAllEmployees()`'s default; never serialised (FR-3.1) |

Unused by this spec: `salary_history` and `rating_history` in their entirety
(FR-3.2).

## Integration Points

| Integration | Detail |
| --- | --- |
| `src/db/queries.ts:getAllEmployees` | Sole data source (AR-3.1); called with default options |
| `src/server/app.ts:createApp` | New `GET /api/headcount` route registered here (AR-3.3) |
| `express.static(PUBLIC_DIR)` | Serves the new dashboard page with no new middleware (FR-3.3) |
| `public/index.html` | Import UI gains the shared nav in place and a post-import link (FR-3.5, FR-3.6) |
| `src/server/start.ts` | Unchanged — `/` still serves the import screen (FR-3.5) |
| `test/server/helpers.ts:withTestServer` | Reused as-is for endpoint tests (AR-3.3) |

## Related Specs

| Spec | Relationship | Affected Requirements |
| --- | --- | --- |
| [Spec 001: Data Foundation & SQLite Schema](../001-data-foundation/spec.md) | **Depends on** — supplies the `employees` table, `getAllEmployees()`, and `reassignManager`'s cycle guarantee | FR-1.1, FR-3.1, AR-1.5, AR-3.1 |
| [Spec 002: WorkDay Import Screen](../002-workday-import/spec.md) | **Depends on** — supplies the data (nothing renders before an import) and the Express server, `public/` UI pattern, and `npm start` entry point | FR-1.3, FR-1.4, FR-3.3, AR-1.3, AR-3.3 |
| [Spec 002: WorkDay Import Screen](../002-workday-import/spec.md) | **Modifies** — the import screen gains shared navigation and a post-import dashboard link; its own upload/confirm behaviour is unchanged | FR-3.5, FR-3.6 |
| [Spec 004: Employee Details Screen](../004-employee-details/spec.md) | **References** — reused this spec's navigation shell, read-only-endpoint pattern, and `chart-logic.js`'s manager-filter functions | FR-3.5, AR-3.1 |

## Constraints

- **Read-only.** No requirement in this spec writes to the database.
- **Country values are the raw WorkDay strings.** Spec 001 stores `country` as
  the source value, not a bucket; the colour mapping (AR-1.2) is presentation
  logic and lives in the presentation layer, not the schema.
- **No position normalisation.** The source report contains both abbreviated and
  full spellings of the same role (`Consult/Prin Quality Test Engr` vs
  `Consulting/Principal Quality Test Engineer`); FR-2.2 groups on the raw string
  and this spec does not introduce a canonicalisation table.
- **Single-team dataset assumption inherited from spec 002.** The database holds
  one manager's team at a time; the reference dataset is 43 employees under 5
  in-file managers who all report to one supervisor (`00000270149`) absent from
  the file. Multiple roots are therefore the normal case, not an edge case —
  spec 002 FR-2.2 nulls every manager link pointing outside the file, which in
  the reference data leaves 11 roots and a tree only two levels deep. The design
  must render this correctly but does not have to scale to a whole-company chart.
- **The roster is readable by anything that can reach the port.** Names,
  positions, countries, and the full reporting structure are served without
  authentication to any local process able to reach `127.0.0.1:<port>` while the
  server runs. This is an accepted risk inherited from spec 002's local,
  single-user model — not an oversight — and the reason FR-3.2 still withholds
  compensation data even from an unauthenticated-by-design endpoint.
- **Accessibility is scoped, not comprehensive.** FR-1.7 (non-colour redundancy,
  contrast) and FR-2.3 (`fieldset`/`legend` grouping) are the required minimum.
  Full keyboard-navigation and screen-reader auditing is deliberately beyond
  what this single-user local tool needs.
- **No framework, no build step** (AR-1.3).
- **Local, single-user, no authentication**, as established by spec 002.

## Out of Scope

- Any write, edit, or drag-to-reassign interaction on the chart.
- Salary, bonus, and performance-rating display — that data belongs to spec 004
  (Employee Details), and this endpoint deliberately excludes it (FR-3.2).
- Showing inactive (soft-deleted) employees, or any historical/point-in-time
  view of the org.
- Search, sort, print/export, or PDF/image export of the chart.
- Collapsible/expandable subtrees — the tree renders fully expanded (FR-1.3);
  the checkbox filter is the only visibility control.
- Position normalisation or a job-title canonicalisation table (Constraints).
- Country-to-colour configuration by the user — the mapping is a code constant
  (AR-1.2).
- Aggregations other than total headcount and count-by-position (e.g.
  count-by-country, span-of-control, cost per team).
- Persisting the checkbox selection across page reloads.
- A loading indicator or spinner between page load and the fetch resolving. The
  request is a single SQLite read served over loopback — tens of milliseconds —
  so a spinner would flash rather than inform. Its absence is a decision, not an
  omission.
- Retry-on-failure. FR-3.4 tells the user to reload; automatic retry against a
  local server that is either running or not adds nothing.
- Live refresh — the page fetches once on load; seeing new data after an import
  means reloading the page.
- Marking or labelling an "external" manager who exists in WorkDay but not in
  the imported file. Their reports render as roots (FR-1.4) with no indication
  that a common manager sits above them.
- A general-purpose routing/SPA shell — FR-3.5 is a two-link nav, nothing more.
- Authentication, authorization, and multi-user access control.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — every FR carries a **Verify:** line;
  Out of Scope lists 15 explicit exclusions, several of them (collapsible
  subtrees, loading indicator, retry, external-manager labelling) being adjacent
  features a reader might otherwise assume.
- [x] **Testing strategy** — follows the existing pattern
  (`specs/docs/conventions/data-access-layer.md#testing`): `node:test` via
  `tsx`, one file per feature area, test names citing FR ids. Endpoint tests go
  in `test/server/` reusing `withTestServer` (AR-3.3), asserting the exact
  five-key projection (FR-3.1) and the `500` body (AR-3.4, induced by closing the
  database inside `withTestServer`). AR-2.3 makes the chart logic importable so
  FR-1.4, FR-2.5, and FR-2.6 get real coverage rather than relying on manual
  checking. The reference file in
  `workday_docs_examples/` gives concrete fixture counts (43 employees; 29 blue
  / 13 red / 1 green; 5 managers; 11 roots) used directly in FR-1.2, FR-1.6,
  FR-2.1, FR-2.2, FR-2.3, FR-2.7, FR-3.1. The 3-level A→B→C fixture is built by
  inserting rows through `src/db`'s write API in a test helper following
  `test/db/helpers.ts:withFreshDatabase` — not as an `.xlsx` fixture, since the
  scenario cannot be produced by importing the real export.
- [x] **Existing patterns** — AR-1.3 (vanilla JS + `public/`), AR-3.1 (reuse
  `getAllEmployees`), AR-3.3 (register in `createApp`), AR-3.4 (`{ error }`
  response shape) each name the existing pattern and file being followed.
- [x] **Dependencies** — none added. AR-1.3 rules out a frontend framework;
  AR-3.1 rules out new data-layer code. `package.json` is unchanged by this spec.
- [x] **Architecture & interfaces** — FR-3.1 fixes the payload shape and its
  exact key set; AR-1.1 fixes the client/server split; AR-2.3 fixes the
  testable-logic boundary; the Data Requirements and Integration Points tables
  enumerate every field read and every existing file touched. No schema impact.
- [x] **Error handling & failure modes** — FR-1.4 (unresolvable manager),
  FR-1.8 (empty database), FR-2.3 (no managers at all — filter group omitted),
  FR-2.7 (all filters off, message gated on a checkbox existing), FR-3.4 (fetch
  failure, with a fixed message and a defined cleared state), AR-3.4 (catch-all
  server response with a fixed body), AR-1.2 (unmapped country falls through to
  green), AR-1.5 (deep chains render; cycles and duplicate ids are structurally
  impossible). The three non-chart states each have distinct, asserted wording,
  and FR-1.4's at-least-one-root invariant rules out a fourth (an empty chart
  over a non-empty payload).
- [x] **Security review** — AR-1.4 (XSS: spreadsheet-sourced text and attribute
  values), AR-3.2 (no `Origin` check needed on a `GET`, no CORS headers to be
  added, localhost binding retained), AR-3.4 (no internal error detail returned),
  FR-3.2 (compensation data withheld). The unauthenticated local roster exposure
  is recorded in Constraints as an accepted risk rather than left implicit.
- [x] **Performance impact** — one query and one HTTP round trip on page load;
  all filtering is in-memory (FR-2.4). The dataset is one manager's team
  (Constraints) — 43 rows in the reference export, bounded by spec 002's
  `MAX_DATA_ROWS = 5000`. At that ceiling the payload is roughly 0.5–1 MB of
  JSON over loopback. AR-2.1's single top-down visibility pass and AR-2.3's
  id/children map keep both assembly and re-filtering O(n) — the O(n·depth)
  per-card ancestor walk this replaced would have been ~12.5M checks per toggle
  at the ceiling — and AR-1.5 removes the one remaining hazard (stack overflow
  on a pathologically deep chain). No virtualisation needed.
- [x] **Rollout & migration** — no migration: read-only, no schema change, no
  new dependency. FR-3.5 now keeps the import screen at `/` in `index.html`, so
  the one backward-compatibility risk identified in review — `start.ts` opening
  a URL that no longer serves a page — is closed by construction. The existing
  `test/server/app.test.ts` suite guards the import endpoints while the nav and
  success-link edits are made.
- [x] **Assumptions & risks** — stated below.

### Assumptions & Risks

- **Assumed:** "Position" means the `position` column, sourced from WorkDay's
  `Business Title` (spec 002 FR-1.4) — the only role-like field the schema
  holds. Job level/grade is not stored.
- **Assumed:** A manager's card colour reflects their own country, independent
  of where their reports sit (FR-1.6) — colour is a per-person attribute, not a
  team attribute.
- **Assumed:** The `country` strings in AR-1.2's mapping are exactly those the
  WorkDay export emits. Confirmed for `United Kingdom`, `United States of
  America`, `India`, and `Netherlands` against the reference file; other spellings
  (e.g. `USA`, `UK`) have not been observed and would fall through to green.
  **Risk:** a differently-spelled US or UK value would silently mis-colour rather
  than fail — acceptable, but worth a glance at the country legend after a first
  import from a new export.
- **Risk:** FR-1.3's unlimited-depth nesting and FR-2.5's nested deselection are
  not exercised by the reference data, which is only two levels deep. The A→B→C
  fixture exists precisely because the real file cannot verify depth ≥ 3; if that
  fixture is skipped, the two subtlest requirements here ship untested.
- **Risk:** FR-3.5 and FR-3.6 edit working, reviewed import UI code. Keep the
  edits mechanical (add nav markup, append one link node) and verify against the
  existing server test suite rather than rewriting the import page.
- **Accepted:** FR-2.2's count-descending ordering means breakdown rows visibly
  reorder as the user toggles checkboxes. Kept because the primary question the
  breakdown answers is "which roles do I have most of", which a count-ordered
  list answers at a glance and an alphabetical one does not. Revisit if the
  reordering reads as jitter in use.
- **Accepted:** Roots (FR-1.4) are always visible, so total headcount can never
  fall below their count — 11 in the reference data. The screen shows the number
  without explaining this floor; FR-2.7's message covers the one case where it
  would otherwise confuse.

---

## Change Log

### Update from `critique-consolidated-v-1.md` (2026-08-31)

**Applied:**

- **Resolved the card-content contradiction.** FR-1.2 required "exactly two"
  text values while FR-1.6 (now FR-1.7) required the country on the card. Cards
  now show three values; the country's role as the non-colour redundancy
  mitigation is stated in FR-1.7.
- **Added FR-1.4: an unresolvable `managerId` makes an employee a root.** Covers
  the reachable case where an import inactivates a mid-level manager whose
  reports stay active — those reports would otherwise silently vanish from the
  chart. FRs 1.4–1.7 renumbered to 1.5–1.8.
- **Corrected FR-1.1's claim about the query layer.** It asserted that every
  `src/db/queries.ts` function defaults `includeInactive: false`; verified false
  — `getEmployeeById`, `getCurrentSalary`, `getSalaryHistory`, `getLastRatings`,
  and `getRatingHistory` take no such option. Narrowed to the three that do.
- **Committed FR-3.5 to augmenting `index.html` in place** at `/`, with no
  redirect, no new route, no `start.ts` change, `aria-current="page"` for the
  active link, and nav markup duplicated per page rather than templated.
- **Fixed FR-2.3's checkbox identity:** keyed by `id`, labelled by `name`,
  `Name (id)` only on a name collision, sorted `name` then `id`, wrapped in a
  `fieldset`/`legend`. Corrected the verify line, which had implied ID labels.
  Also stated that roots are always visible and unfilterable.
- **Specified sibling and root ordering** (`name`, then `id`) in FR-1.2,
  matching FR-2.3 so the chart and filter list read in the same order.
- **Required an explicit five-field projection** in FR-3.1 so `endDate` is never
  serialised by passing the `Employee` object through.
- **Broadened AR-3.4** to a catch-all with a generic client message and
  server-side logging, with the reasoning for why it diverges from the import
  routes' echo-the-message behaviour.
- **Added AR-1.5** requiring iterative tree assembly and rendering, and
  recording that cycles and duplicate ids are structurally impossible
  (`PRIMARY KEY`; `reassignManager`'s transitive-cycle rejection, verified at
  `src/db/mutations.ts:68`).
- **Promoted the DOM-independent testable module from a risk note to AR-1.6**,
  and named the A→B→C fixture's construction (write API + `withFreshDatabase`,
  not an `.xlsx`) in the checklist.
- **Fixed the three non-chart state messages:** FR-3.4 now has fixed wording and
  defines what it clears; FR-2.7's misleading "no teams selected" became "No
  manager teams selected — showing employees who report to nobody."
- **Extended AR-1.4 to attribute values**, and specified FR-3.6's link as an
  appended DOM node — `showResult` assigns `textContent`, so markup passed
  through it would render as literal text.
- **Added to AR-3.2:** no CORS headers, with the reason (default browser policy
  already blocks cross-origin reads of the roster).
- **Added accessibility minimums** — contrast ratio and long-value layout in
  FR-1.7, `fieldset`/`legend` in FR-2.3 — plus a Constraints entry stating that
  full keyboard/screen-reader auditing is a deliberate limit.
- **Recorded the local roster exposure** in Constraints as an accepted risk
  inherited from spec 002, rather than leaving it implied by "no authentication".

**Rejected:**

- **Cycle detection and duplicate-id defence in the renderer** (Codex). The
  database cannot produce either: `employees.id` is a `PRIMARY KEY` and
  `reassignManager` rejects direct and transitive cycles before writing. AR-1.5
  states why instead of specifying defensive code for an unreachable input. The
  iterative-rendering half of the same recommendation was accepted — a deep
  chain is reachable.
- **A required loading indicator** (Codex). A local SQLite read over loopback
  resolves in tens of milliseconds; a spinner would flash rather than inform.
  Recorded in Out of Scope with that reasoning so the absence is a decision.
- **Per-status-code failure messages** (Claude). `404` and `500` leave the user
  with the same single recourse — reload — so distinguishing them gives them
  nothing to act on. FR-3.4 states this explicitly.
- **Always-on `Name (ID)` checkbox labels** (Codex). The IDs are 11-digit
  zero-padded strings that would dominate every label; disambiguation now
  applies only on an actual name collision.
- **Stable (position-ascending) ordering for the totals breakdown.** The
  reordering-on-toggle concern is real but count-descending answers the
  question the breakdown exists for. Recorded as an accepted trade-off in
  Assumptions & Risks rather than silently kept.
- **A `getHeadcount` helper in `test/server/helpers.ts`** (Claude). A one-line
  `fetch` needs no wrapper; `postPreview`/`postConfirm` exist because multipart
  and origin-header construction are genuinely verbose. This is an
  implementation detail, not a spec requirement, either way.

**Reorganized:**

- Feature 1's FRs renumbered (old FR-1.4→1.5, 1.5→1.6, 1.6→1.7, 1.7→1.8) to
  place the new root-detection requirement next to the nesting requirement it
  qualifies. All cross-references in Data Requirements, Related Specs, the
  checklist, and Assumptions updated to match.
- Accessibility requirements folded into the requirements they qualify (FR-1.7,
  FR-2.3) with a scope limit in Constraints, rather than added as a standalone
  section.
- The "external manager" open question moved from Assumptions & Risks to Out of
  Scope, since FR-1.4 now settles the rendering behaviour and only the optional
  labelling remains excluded.

### Update from `critique-consolidated-v-2.md` (2026-08-31)

**Applied:**

- **Removed FR-2.3's "neither do roots" clause** — the one factually wrong
  sentence in the revision. All 5 managers in the reference file are themselves
  roots (they report to the absent supervisor `00000270149`), so the clause
  contradicted FR-2.3's own verify line and FR-2.7's. Replaced with the correct
  statement: having reports and having a manager are independent properties; a
  root with reports gets a checkbox like any other manager, and a checkbox never
  hides its own manager's card.
- **Specified the zero-manager state.** On an all-root roster the `fieldset` is
  omitted entirely rather than rendered empty (FR-2.3), and FR-2.7's "No manager
  teams selected" message is gated on at least one checkbox existing — otherwise
  it would display over a complete, unfiltered roster.
- **Replaced FR-3.2's verify** with a key-set assertion on the parsed entries.
  The substring search it replaced would fail spuriously on an employee whose
  name or title contains "Currency" or "Rating", and would miss a field leaked
  under a different name.
- **Fixed FR-3.5's impossible wording.** Both pages now carry both links, with
  literal hrefs `/` and `/headcount.html`; the link matching the current page
  gets `aria-current="page"`. The Import href is `/`, not `/index.html`, since
  that is the URL `start.ts` opens.
- **Tightened AR-2.1 to a single top-down visibility pass.** The per-card
  ancestor walk was O(n·depth) — roughly 12.5M checks per toggle at spec 002's
  5000-row ceiling with a deep chain. One traversal from the roots down gives
  the same result in O(n), and composes with AR-1.5's iterative requirement.
- **Fixed AR-3.4's body string** to `{ "error": "Could not load employee data." }`
  and recorded how the path is induced in a test — `closeDatabase()` is safe to
  call at any time and `getConnection()` throws afterwards
  (`src/db/connection.ts`), so no injection seam is needed.
- **Gave FR-1.7's contrast requirement checkable values** — text `#1a1a1a` on
  `#d6e4f7`/`#f7d6d6`/`#d9f0dc`, computed at 13.5:1, 12.9:1, and 14.5:1. The
  4.5:1 figure previously had no acceptance condition.
- **Replaced "rendered set" with "payload (FR-3.1)"** in FR-1.4, closing the
  reading where root-ness would change as checkboxes toggle.
- **Stated the at-least-one-root invariant** in FR-1.4: a finite cycle-free
  graph always has a root, so the chart can never be empty over a non-empty
  payload, and the FR-1.8 and FR-2.7 states are mutually exclusive.
- **Noted in FR-1.2** that the payload's `id` order is not the render order.

**Rejected:**

- **Dependency injection for the data layer** (Codex), proposed so the `500`
  path could be tested. Verified unnecessary: `closeDatabase()` is idempotent
  and `getConnection()` throws `InitializationError` once closed, so
  `withTestServer` can induce the failure today. Adding an injection seam to
  `createApp()` would change working spec 002 architecture to buy nothing.
- **Nav markup examples and DOM-append instructions** (Claude). Both are
  ordinary implementation choices; the spec states WHAT (both links, correct
  hrefs, `aria-current`, link appended as a node rather than markup through
  `showResult`) and leaves HOW to the implementer.
- **A responsiveness/interaction-time target** (Codex). Once AR-2.1 is O(n) the
  target has nothing to guard — a number would be ceremony.

**Reorganized:**

- `AR-1.6` (DOM-independent testable module) moved to Feature 2 as **AR-2.3**:
  it governs FR-2.1, FR-2.2, FR-2.4, and FR-2.5, and sat under Feature 1 only by
  accident of when it was added. All references updated.
- The "Error handling & failure modes" and "Performance impact" checklist items
  rewritten to cite the new requirements rather than the ones they replaced.
