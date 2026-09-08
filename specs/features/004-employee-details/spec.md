# Spec 004: Employee Details Screen

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-08-31.
> Implementation summary: `specs/features/004-employee-details/implementation-summary.md`
> Implementation review: `specs/features/004-employee-details/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

A read-only browser screen that renders every active employee as one row in a
sortable table — employee id, name, position, current salary (currency, base,
bonus), and their last three rating periods — with checkbox filters by
position and by line manager. This is the third screen in the app, alongside
the WorkDay Import screen (spec 002) and the Headcount Dashboard (spec 003),
and the individual-employee counterpart to the Dashboard's aggregate view:
where the Dashboard answers "what does my org look like," this screen answers
"what does this specific person look like."

## Goals

- Give the user a single table showing every active employee's compensation
  and rating detail, which no existing screen exposes (spec 003's dashboard
  explicitly withholds this data).
- Let the user narrow the table to a subset of positions and/or line-manager
  teams, matching the interaction model spec 003 already established for its
  manager checkbox list, rather than inventing a second filtering convention.
- Reuse spec 003's `public/chart-logic.js` tree/manager functions unchanged
  for the manager filter, instead of duplicating hierarchy logic.
- Add a third `GET /api/employee-details` read-only endpoint alongside the
  existing import and headcount endpoints, and extend the shared nav
  (spec 003 FR-3.5) to a third link.

---

## Feature 1: Employee Details Table

**Who & why:** A user who has just imported a WorkDay export, or who already
uses the Headcount Dashboard to see org shape, now wants to look up or scan
individual employees' compensation and rating history — "what is this
person's current salary," "who hasn't been rated in the last cycle," "which
team's bonuses look off." Today that data exists only in SQLite with no
screen exposing it at all; the Dashboard (spec 003) deliberately excludes it
(FR-3.2 of that spec).

### Functional Requirements

#### FR-1.1: Active employees only, one row per employee

The table renders exactly one row per active employee — those whose
`end_date` is `NULL` — matching the `includeInactive: false` default of
`getAllEmployees()` that spec 003's dashboard already relies on. An employee
soft-inactivated by an import (spec 002 FR-2.3) has no row and does not count
toward anything on this screen. There is no UI affordance to include inactive
employees.

**Verify:** With one employee's `end_date` set to a date and all others
`NULL`, the rendered table contains no row for that employee and has exactly
as many rows as there are remaining active employees.

#### FR-1.2: Row contents

Each row shows exactly these values, one per column, in this left-to-right
order: `id`, `name`, `position`, current-salary `currency`, current-salary
`baseSalary`, current-salary `bonus`, then the employee's rating value for
each of the three fixed periods (`"Most Recent"`, `"Prior Rating"`,
`"Two Year Prior Rating"`), each in its own column in that order — matching
FR-4.1's payload key order, so the column layout isn't left to the
implementer to invent. "Current salary" is the `salary_history` row
`getCurrentSalary` (spec 001 FR-2.2) returns — the row for the highest
`effective_year` not greater than the current calendar year — not full
salary history; this screen shows one salary snapshot per employee, matching
the roadmap's "salary currency, base salary, bonus" column list. There is no
start-date/hire-date column: that field was dropped from the schema entirely
(spec 001, Change Log, 2026-08-31 — the real WorkDay export has no hire-date
field), and the anniversary-lookup feature that would have used it is
formally out of scope for this spec (see Out of Scope).

**Verify:** For an active employee with a `salary_history` row for the
current-or-earlier year and all three `rating_history` rows present, their
table row shows their `id`, `name`, `position`, that salary row's `currency`/
`baseSalary`/`bonus`, and all three rating values in the fixed period order.

#### FR-1.3: Missing salary or rating data renders as a placeholder, per cell

When `getCurrentSalary` returns `null` for an employee (no eligible
`salary_history` row), the `currency`/`baseSalary`/`bonus` columns each show
an em dash (`—`) rather than blank cells or `0`. Independently, when
`getLastRatings` (spec 001 FR-3.2) has no row for a given period — e.g. a
recent hire with only a `"Most Recent"` rating and no `"Prior Rating"` or
`"Two Year Prior Rating"` — that period's column shows `—` for that row only;
other rating columns for the same row, and all columns for other rows, are
unaffected. These two kinds of missing data (salary vs. rating) are
independent and can occur in any combination on the same row.

**Verify:** An employee with no `salary_history` row at all shows `—` in all
three salary columns while still showing their available ratings; an
employee with only a `"Most Recent"` rating shows that value in the "Most
Recent Rating" column and `—` in the other two rating columns, while still
showing their salary if one exists.

#### FR-1.4: Empty database

When no active employees exist — a database that has never been imported
into, or one where every employee is inactive — the screen renders an
explanatory message ("No employee data yet — import a WorkDay report to get
started.") in place of the table, matching spec 003 FR-1.8's wording pattern
for the same underlying condition. The message links to the Import screen.
The filter checkboxes (Feature 2) are not rendered in this state, since there
is nothing to filter.

**Verify:** Requesting the screen against a freshly-initialised, empty
database shows the empty-state message and a link to the import screen, with
zero table rows and no filter checkboxes.

### Architectural Requirements

#### AR-1.1: Rendering is XSS-safe

All employee-, salary-, and rating-derived text (`id`, `name`, `position`,
`currency`, `ratingValue` for each period) reaches the DOM through
`textContent` or an equivalent escaping path, never through
`innerHTML`/`insertAdjacentHTML` string concatenation — matching spec 003
AR-1.4's rule, extended here to `currency` and `ratingValue`, neither of
which that spec's dashboard ever renders. `id` is included here — unlike
spec 003, which only ever uses `id` as a checkbox attribute, this screen
renders it as an ordinary visible table cell (FR-1.2), and spec 001 leaves
its character format entirely unconstrained (Constraints: "not defined"),
so it is exactly as untrusted as `name` or `position` once it's cell text.
The same applies to attribute values built from this data — the checkbox
`value`/`id`/`label[for]` pairs FR-2.1's position checkboxes need, and the
`Name (id)` labels FR-2.2's manager checkboxes reuse from `managerList()` —
set via `setAttribute` (or a direct property assignment) with a text value,
never built by template-string interpolation, matching spec 003 AR-1.4 and
`specs/docs/conventions/browser-screens.md` exactly rather than only the
text-node half of that rule. FR-2.1's position checkboxes in particular use
a generated, screen-local unique identifier (e.g. an index-based prefix) as
the `id`/`for` attribute value, never the raw `position` string itself —
unlike spec 003's checkbox ids, which happen to be numeric in every
observed export (spec 001 leaves `employees.id`'s format formally
undefined, per its Constraints, but the reference data is consistently
numeric), `position` is arbitrary imported text that can contain spaces or
other characters unsuited to a bare DOM identifier; the raw position string
is used only as the checkbox's `value`
and its label's text content, both of which tolerate arbitrary text safely.
`ratingValue` in particular is free-text (spec 001 FR-3.1: "exactly as
provided," validated only for length and non-blankness), so it is exactly as
untrusted as `name` or `position`. Numeric values (`baseSalary`, `bonus`)
are rendered as plain numbers with no
unit conversion or formatting beyond what the data already carries.

#### AR-1.2: No new frontend framework

The screen is plain HTML plus vanilla JavaScript served from `public/`,
matching `public/index.html` and `public/headcount.html`. No build step,
bundler, or UI framework is introduced (spec 002 AR pattern, spec 003
AR-1.3).

---

## Feature 2: Position & Manager Filters

**Who & why:** With every active employee in one table, the user needs to
narrow it down — to one manager's team when checking that team's
compensation, or to one position when comparing ratings across people who do
the same job. The Dashboard already solved "narrow to a subset of managers"
for its own screen (spec 003 FR-2.3–FR-2.7); this feature reuses that
solution rather than inventing a second filtering interaction for the same
underlying data.

### Functional Requirements

#### FR-2.1: Position checkbox list

The screen displays one checkbox per distinct `position` value among active
employees, labelled with that exact string, sorted alphabetically ascending
(string comparison via `localeCompare`, see AR-3.1). Positions are grouped
on the raw string with no normalisation — matching
spec 003 FR-2.2's precedent, `Consult/Prin Quality Test Engr` and
`Consulting/Principal Quality Test Engineer` remain two distinct checkboxes.
The list is wrapped in a `fieldset` with a `legend` ("Filter by position").
All checkboxes are selected by default on page load. Unchecking a position
hides every row with that exact `position` value; this operates entirely in
the browser on data already loaded, with no network request (mirrors spec
003 AR-2.2's "computed in the browser, not fetched" principle).

**Verify:** With the reference file imported, the position checkbox list
contains one entry per distinct `position` string among the 43 employees,
sorted alphabetically, all checked on load; unchecking one position's
checkbox hides exactly the rows whose `position` matches that string.

#### FR-2.2: Manager checkbox list

The screen displays one checkbox per active employee who has at least one
active direct report, reusing `managerList()` from `public/chart-logic.js`
(spec 003 FR-2.3) unchanged — same `id`-keyed, `name`-labelled, `Name (id)`
disambiguated-on-collision entries, sorted `name` then `id`, wrapped in a
`fieldset`/`legend` ("Filter by manager"). All checkboxes are selected by
default on page load. When no active employee has an active direct report,
the `fieldset` is omitted entirely, exactly as spec 003 FR-2.3 specifies for
the same condition.

**Verify:** With the reference file imported, the manager checkbox list
contains exactly the same 5 entries (keyed to the same ids) that spec 003's
dashboard shows for the same file, all checked on load.

#### FR-2.3: Manager filter visibility mirrors the Dashboard's team-hiding behaviour

Row visibility from the manager filter is computed by calling `visibleIds()`
from `public/chart-logic.js` (spec 003 FR-2.4/FR-2.5) unchanged, against the
same employee set this screen already has in memory: unchecking a manager
hides that manager's entire reporting subtree but leaves the manager's own
row visible; re-checking restores it. Nested deselection is subtractive
(unchecking an ancestor hides a descendant regardless of the descendant's own
checkbox state, per spec 003 FR-2.5) and a root — an employee with no
manager, or whose manager doesn't resolve within the active set — is always
visible regardless of any checkbox state (spec 003 FR-1.4/FR-2.7). This is a
direct reuse of already-tested logic, not a reimplementation: no new
tree-traversal code is written for this behaviour.

**Verify:** In the A→B→C hierarchy fixture spec 003's tests use, unchecking A
hides B and C from this screen's table while A's row remains; unchecking B
as well and then re-checking A leaves C hidden (B is still unchecked) and
shows B — the same outcomes spec 003 FR-2.4/FR-2.5 assert, now observed
through this screen's table instead of the org chart.

#### FR-2.4: Position and manager filters combine as AND

A row is visible only when it passes both filters at once: its `position`
checkbox is checked, and it is within the manager filter's visible set
(FR-2.3). Deselecting checkboxes in either filter can only remove rows, never
add rows the other filter has already excluded.

**Verify:** With one position checkbox and one manager checkbox both
unchecked, a row for an employee matching neither exclusion stays visible; a
row matching either exclusion is hidden; a row matching both is hidden (not
double-counted or restored).

#### FR-2.5: No rows match the combined filter

When the combined filter (FR-2.4) leaves zero visible rows — reachable by
unchecking every position checkbox, or by combining position and manager
filtering narrowly enough that nothing satisfies both — the table area shows
"No employees match the current filters." instead of an empty table with
headers and no rows. The manager filter alone can never reach zero rows by
itself: `visibleIds()`'s root-is-always-visible invariant (FR-2.3, inherited
from spec 003 FR-1.4) guarantees at least one row stays visible from that
filter alone, in any non-empty dataset — reaching zero always requires the
position filter to exclude the remaining root(s) too.

**Verify:** Unchecking every position checkbox leaves zero visible rows and
displays the no-match message; re-checking any one position removes the
message and shows the matching row(s) again.

### Architectural Requirements

#### AR-2.1: Manager-filter logic is imported from `chart-logic.js`, not duplicated

This screen's client-side module imports `buildTree`, `managerList`, and
`visibleIds` from `public/chart-logic.js` rather than reimplementing
hierarchy traversal. All three functions operate on plain `{ id, managerId,
name }`-shaped objects (spec 003). The `GET /api/employee-details` payload
(FR-4.1) — itself a merge of `getAllEmployees()`, `getCurrentSalary()`, and
`getLastRatings()` (FR-4.2), not a single query's result — is a superset of
that shape: it carries `position`/`currency`/`baseSalary`/`bonus`/`ratings`
fields alongside `id`/`managerId`/`name`, and the three imported functions
simply ignore whatever they don't use, so no adapter layer is needed. This
follows the working-rules principle of following existing patterns before
introducing new abstractions.

#### AR-2.2: Position-filter logic is a small, independent function

Unlike the manager filter, the position filter has no hierarchy — it is a
plain set-membership check (`employee.position` is in the checked set) — and
is implemented as a small standalone function in this screen's own logic
module, not folded into or copied from `chart-logic.js`.

#### AR-2.3: Filter and sort logic is DOM-independent and unit-testable

Position filtering (FR-2.1), the manager-filter integration (AR-2.1), the
AND combination (FR-2.4), sorting (Feature 3), and the payload-shape
validation FR-4.4 requires (checking for a missing `ratings` key or
sub-key) all live in a plain importable module
(`public/employeeDetailsLogic.js`) that takes the payload and current
filter/sort state as data and returns data, with no DOM access — matching
spec 003 AR-2.3's split for the same reason: this project has no browser
test harness, so this is the only way these rules get automated coverage.
FR-4.4's validation function specifically is what makes that FR's
malformed-payload rule testable at all — without it, "the page displays the
load-failure message" would be thin wiring with no automatable seam, the
same as it already is for FR-1.4 and FR-2.5's non-table states, which this
project accepts as manually verified. Only thin wiring (creating table
rows, attaching checkbox/header-click listeners, and branching to the
failure UI when the validation function returns invalid) sits outside it.

---

## Feature 3: Column Sorting

**Who & why:** A table of every active employee's compensation and ratings
is far more useful when the user can order it — highest base salary first,
alphabetically by name, or by a specific rating column to spot who's
overdue a review. The roadmap flagged sort behaviour as an open question;
sortable columns with no pagination keeps the interaction simple and matches
the expected data volume (spec 001/003's precedent: hundreds to low
thousands of employees).

### Functional Requirements

#### FR-3.1: Clickable column headers sort the table

Clicking a column header sorts the table by that column, ascending;
clicking the same header again reverses to descending; clicking a different
header switches to that column, ascending. Each sortable header's click
target is a `<button>` element inside the `<th>` (not a bare click handler
on the `<th>` itself), so Enter/Space activates the same sort a pointer
click does — the WAI-ARIA sortable-table pattern this FR follows expects a
keyboard-operable trigger, not only the `aria-sort` indicator described
below. The currently-sorted column and direction are indicated visually
(e.g. an arrow glyph, not colour alone, so the state doesn't depend on
colour perception) and via `aria-sort` (`"ascending"` or `"descending"`) on
that header. Exactly one sortable header carries `aria-sort="ascending"` or
`"descending"` at any time; every other sortable header either omits the
attribute or sets it to `"none"` — never more than one header showing an
active sort state at once. On initial page load, before any header is
activated, the table is sorted by `name` ascending, with `id` ascending as
the tie-break — matching the ordering convention spec 003 already
established for cards and the manager checkbox list. The same
`name`-then-`id` tie-break applies to every subsequent user-initiated sort,
not only this initial one (AR-3.1).

**Verify:** Clicking the "Base Salary" header once sorts all visible rows by
`baseSalary` ascending and sets that header's `aria-sort="ascending"`, while
every other sortable header's `aria-sort` is absent or `"none"`; clicking it
again reverses to descending and updates `aria-sort` to `"descending"`;
clicking "Name" afterward sorts by name ascending and moves `aria-sort` to
the "Name" header (the "Base Salary" header's `aria-sort` reverts to absent
or `"none"`); pressing Enter on the "Base Salary" header's button while it
has focus produces the identical result as clicking it. Separately, with
two employees sharing the same `baseSalary` value (both rows tied on the
sorted column), sorting by "Base Salary" places the one with the
alphabetically-earlier `name` first, and if their `name`s also tie, the one
with the lexicographically-earlier `id` first — confirming the
`name`-then-`id` tie-break (AR-3.1) actually governs a user-initiated sort,
not only the initial load.

#### FR-3.2: Sort comparison per column type

`id`, `name`, `position`, `currency`, and each rating-period column sort as
plain strings via `localeCompare` (AR-3.1) — `id` sorts this way even though
its values happen to look numeric, matching `getAllEmployees`'s own
string-ordering convention (spec 001 FR-4.1) in kind, though not
necessarily in the exact collation SQLite's default binary comparison uses
server-side (see AR-3.1). `baseSalary` and `bonus` sort numerically. Both
rules apply only when the sorted column holds a real value: the FR-1.3
missing-value placeholder — reachable in `currency`, `baseSalary`, `bonus`,
and any rating-period column, never in `id`/`name`/`position` — is not
compared by either the string or the numeric rule and instead always
follows FR-3.3's missing-values-sort-last rule, which governs all five of
those columns, not only the two numeric ones (see FR-3.3).

**Verify:** Given `id` values `"9"` and `"10"`, ascending sort by `id`
places `"10"` before `"9"`, because string comparison compares the leading
characters `"1"` and `"9"` directly rather than the numeric values 10 and 9
— the rule that governs even though it looks backwards to a reader expecting
numeric order. The reference file's own ids are fixed-width, zero-padded
11-digit strings, so this divergence never actually surfaces there; the rule
still governs any future dataset whose ids aren't fixed-width.

#### FR-3.3: Missing values sort last, in either direction

A row whose value in the sorted column is the FR-1.3 placeholder (no
current salary, or no rating for that period) sorts after every row with a
present value, regardless of ascending or descending direction — so
placeholder rows cluster at the bottom of the table rather than jumping to
the top when the direction is reversed. This rule governs every sortable
column that can carry the placeholder — `currency`, `baseSalary`, `bonus`,
and each of the three rating-period columns — not only `baseSalary`/`bonus`;
`id`, `name`, and `position` never carry it, since none of FR-1.1's active
employees is ever missing an id, name, or position.

**Verify:** Sorting by "Bonus" ascending places every employee with a
recorded bonus before every employee with none; reversing to descending
still leaves the no-bonus employees last, not first. Sorting by
"Most Recent Rating" ascending likewise places every employee with a
recorded value for that period before every employee with none, confirming
the same rule governs a string (`localeCompare`-sorted) column, not only
the numeric `bonus` example.

#### FR-3.4: Sorting operates on the currently filtered set, with no network request

Sorting is applied to whichever rows Feature 2's filters currently make
visible, and re-applied automatically whenever the filter selection changes,
without a new fetch — consistent with FR-2.1's "already loaded, no network
request" rule for filtering.

**Verify:** With a sort applied and a position unchecked afterward, the
remaining visible rows stay in the previously chosen sort order; no new
request to `GET /api/employee-details` is made when either the filter or the
sort changes.

### Architectural Requirements

#### AR-3.1: String comparison uses `localeCompare`, with one universal tie-break

Every string-column sort (FR-3.2's `id`/`name`/`position`/`currency`/
rating-period columns) and the position-checkbox ordering (FR-2.1) compare
using `String.prototype.localeCompare` — the same comparator
`chart-logic.js`'s `byNameThenId` helper already uses for the manager filter
reused on this screen (AR-2.1) — not a plain binary/`<` compare, which is
what `getAllEmployees`'s SQL `ORDER BY id ASC` uses server-side but which
this client-side module has no need to match bit-for-bit. Every
user-initiated sort, not only the initial-load sort (FR-3.1), breaks ties by
`name` ascending then `id` ascending. Within a tied or ordered rating-value
column, this comparator governs the same way; the resulting alphabetical
order carries no implied rating-quality ranking, since the rating scale
itself is undefined (spec 001 FR-3.3) — FR-3.3's missing-values-last rule,
not alphabetical order, is what actually serves the "who's overdue a
review" use case this Feature's Who & why names.

(Sorting logic itself, and the filter/sort module boundary, are additionally
covered by AR-2.3, which scopes all of Feature 3's logic into the same
DOM-independent module as Feature 2's filtering.)

---

## Feature 4: Employee Details API & Navigation

**Who & why:** The table needs its data from the server, and the existing
`GET /api/headcount` endpoint (spec 003) deliberately excludes salary and
rating fields (spec 003 FR-3.2) — this screen cannot reuse that payload as-is
and needs its own endpoint. Separately, this is the app's third screen, and
spec 003's own Related Specs table already anticipated this: "will reuse
this spec's navigation shell and read-only-endpoint pattern."

### Functional Requirements

#### FR-4.1: `GET /api/employee-details`

A read-only endpoint returning `200` with a JSON body `{ employees: [{ id,
name, position, managerId, currency, baseSalary, bonus, ratings: {
mostRecent, priorRating, twoYearPriorRating } }] }`, containing every active
employee (FR-1.1) in the order `getAllEmployees()` returns them (`id`
ascending, lexicographic — the browser re-sorts per Feature 3). `currency`/
`baseSalary`/`bonus` are `null` together when `getCurrentSalary` returns
`null` for that employee (FR-1.3); each of `ratings.mostRecent`/
`priorRating`/`twoYearPriorRating` is independently `null` when
`getLastRatings` has no row for that period. `managerId` is `null` for an
employee with no manager, matching spec 003 FR-3.1's existing field. Each
entry is this explicit eight-key projection, not the `Employee` object
(`src/db/types.ts`) passed through with salary/rating fields appended — that
would also serialise `country` and `endDate`, neither of which belongs in
this payload, matching spec 003 FR-3.1's identical caution for its own
`Employee`-derived endpoint. The endpoint never writes to the database, and
returns `{ employees: [] }` — not an error — when no active employees
exist.

**Verify:** With the reference file imported, `GET /api/employee-details`
returns `200` and a body whose `employees` array has 43 entries, each with
exactly the eight top-level keys named above — `id`, `name`, `position`,
`managerId`, `currency`, `baseSalary`, `bonus`, `ratings` (the last being a
nested object with exactly its three named keys) — and no salary/rating-
history entries beyond the current snapshot and last three periods. An
employee with no `salary_history` row shows `currency`, `baseSalary`, and
`bonus` all `null` together, never a mix of `null` and a present value —
guaranteed by spec 001's schema, where a `salary_history` row's `currency`
and `base_salary` are `NOT NULL` and `bonus` defaults to `0` (spec 001 Data
Requirements), so a row is always all three fields or none of them. Against
a freshly-initialised, empty database, the same endpoint returns `200` with
`{ employees: [] }`, not an error. Every one of these `200` responses
carries a `Cache-Control: no-store` header (AR-4.4).

#### FR-4.2: The endpoint composes existing query functions, with no new SQL

The handler builds each entry from `getAllEmployees()`, `getCurrentSalary(id)`,
and `getLastRatings(id, 3)` (all exported by `src/db/index.ts` today) — one
call per employee to the latter two, since neither function accepts a batch
of ids. `getLastRatings` returns an array that omits any period with no row
(spec 001 FR-3.2) rather than padding it, so turning that array into FR-4.1's
three independently-nullable, named keys requires the handler to map each
returned `ratingPeriod` string to its camelCase payload key (`"Most
Recent"` → `mostRecent`, `"Prior Rating"` → `priorRating`, `"Two Year Prior
Rating"` → `twoYearPriorRating`) and leave any key with no corresponding row
as `null`. This mapping is the one real data-shaping step the endpoint
performs. Beyond it, the handler adds no new file under `src/db/` — the
mapping itself is ordinary presentation-layer logic that may live in the
route handler or a small helper alongside it, wherever `src/server/`
conventions already put comparable logic; "no new file under `src/db/`"
means no new query, not "no helper functions anywhere." No new schema and
no new query are added either — matching spec 003 AR-3.1's precedent of
reusing the data-access layer rather than introducing a parallel read path.
The per-employee call pattern is an accepted N+1 query shape at this
project's expected data volume (see Constraints), not a defect to fix in
this spec.

**Verify:** For an employee with only a `"Most Recent"` `rating_history`
row, the payload's `ratings.mostRecent` holds that value while
`ratings.priorRating` and `ratings.twoYearPriorRating` are both `null` —
confirming the mapping itself, not just its presence. Separately (a
structural check verified by code review rather than a `node:test` case,
unlike every other FR's Verify line): the route handler's implementation
calls only functions already exported from `src/db/index.ts`; no new `.ts`
file is added under `src/db/`.

#### FR-4.3: Employee Details page served from `public/`

The screen is a static page served by the existing
`express.static(PUBLIC_DIR)` middleware at a stable path
(`/employee-details.html`), fetching `GET /api/employee-details` on load and
rendering per Features 1–3.

**Verify:** `GET /employee-details.html` returns `200` with an HTML content
type from a running server.

#### FR-4.4: Fetch failure is surfaced, not silent

If `GET /api/employee-details` fails (non-`200`, a network/parse error, or a
syntactically-valid response body missing an expected key such as `ratings`
or a `ratings` sub-key), the screen displays "Could not load employee data.
Reload the page to try again." — the identical wording spec 003 FR-3.4 uses
for its own fetch failure — in place of the table, and shows no filter
checkboxes and no stale/zero-derived state. A malformed-but-parseable body
is treated identically to a network/parse error: the screen never renders a
partial table from an incomplete payload. This message is distinct from
FR-1.4's genuinely-empty-database state and from FR-2.5's no-rows-match
state.

**Verify:** With the endpoint stubbed to return `500`, the page displays the
load-failure message, displays no table rows, and displays no filter
checkboxes; that `500` response also carries the `Cache-Control: no-store`
header (AR-4.4) — "every response" in AR-4.4 includes the error path, not
only the successful one. Separately, calling `employeeDetailsLogic.js`'s
validation function (AR-2.3) with a body of `{ employees: [{ id: "1", name:
"A", position: "X", managerId: null, currency: "USD", baseSalary: 1, bonus:
0 }] }` (a syntactically valid response with no `ratings` key at all)
returns invalid — this half is `node:test`-automatable, unlike the rest of
this Verify line. The page-rendering consequence of that invalid result —
displaying the identical load-failure message, no table rows, and no filter
checkboxes for this case exactly as for the `500` case — is verified
manually, the same as FR-1.4's and FR-2.5's non-table states already are in
this project, which has no browser test harness to automate DOM assertions.
An implementation that only wraps `fetch`/`.json()` in a `try`/`catch` and
never calls the validation function would fail the automated half of this
Verify line, even before a human checks the rendered page.

#### FR-4.5: Shared navigation gains a third link

The nav element on all three pages (`index.html`, `headcount.html`, and the
new `employee-details.html`) lists all three screens: "Import" → `/`,
"Headcount" → `/headcount.html`, "Employee Details" →
`/employee-details.html`. On each page, the link to the current screen
carries `aria-current="page"`. This edit to `index.html` and `headcount.html`
is mechanical — adding one `<a>` per existing nav element — and does not
change either page's existing upload/confirm or chart behaviour. As spec 003
AR notes for the same duplicated-nav decision: with three static pages, a
templating layer would still cost more than it saves.

**Verify:** After `npm start`, both the Import and Headcount pages display
all three nav links with the correct link marked current on each; clicking
"Employee Details" from either page loads this screen.

### Architectural Requirements

#### AR-4.1: No `Origin` check and no CORS headers on the read endpoint

Matching spec 003 AR-3.2's reasoning for `GET /api/headcount`: `GET
/api/employee-details` performs no state change and carries no CSRF risk, so
it is not given the `checkOrigin` guard the import routes use, and no CORS
headers are added — the browser's default same-origin policy already stops
another page from reading this data off the port. The server remains bound
to `127.0.0.1` (spec 002).

#### AR-4.2: Route registration follows the existing app factory

The route is registered inside `createApp()` in `src/server/app.ts`,
alongside the existing routes, so `test/server/helpers.ts:withTestServer`
picks it up with no change to the test harness (matching spec 003 AR-3.3).

#### AR-4.3: The handler catches everything and reports generically

Any exception reaching the handler produces `500` with the JSON body
`{ "error": "Could not load employee data." }` (matching spec 003 AR-3.4's
identical shape and reasoning for the headcount endpoint) rather than
propagating to Express's default HTML error page. The real error is logged
server-side; the client-facing message is fixed and generic. This path is
tested the same way spec 003's `500` path is tested: closing the database
inside `withTestServer` before issuing the request, since `closeDatabase()`
is safe to call at any time and `getConnection()` throws once no connection
is open.

#### AR-4.4: No-store caching header on the response

The handler sets `Cache-Control: no-store` on every `GET
/api/employee-details` response, so a browser or intermediate proxy never
retains a copy of a response carrying salary or rating data. This is a
low-cost hardening step beyond what spec 003's `GET /api/headcount` needs,
since that endpoint carries no compensation data. It narrows how long a past
response can outlive the request that produced it; it does not change who
can request the data live — that remains governed by the accepted-risk
framing in Constraints.

---

## Data Requirements

Read-only against the spec 001 schema; this spec adds no tables, columns, or
indexes.

| Source | Field | Used for |
| --- | --- | --- |
| `employees` | `id` | Row identity, sort key, payload key (FR-1.2, FR-3.1, FR-4.1) |
| `employees` | `name` | Row label, sort key, manager-checkbox label via `managerList()` (FR-1.2, FR-2.2, FR-3.1) |
| `employees` | `position` | Row label, position-checkbox value and grouping, sort key (FR-1.2, FR-2.1, FR-3.2) |
| `employees` | `manager_id` | Manager-filter tree assembly via `buildTree`/`visibleIds` (FR-2.2, FR-2.3) |
| `employees` | `end_date` | Active filter (FR-1.1), via `getAllEmployees()`'s default; never serialised |
| `salary_history` | `currency`, `base_salary`, `bonus` | Current-salary columns, via `getCurrentSalary` (FR-1.2, FR-1.3, FR-4.1) |
| `rating_history` | `rating_period`, `rating_value` | Three rating columns, via `getLastRatings` and the period-to-key mapping (FR-1.2, FR-1.3, FR-4.1, FR-4.2) |

## Integration Points

| Integration | Detail |
| --- | --- |
| `src/db/index.ts:getAllEmployees`, `getCurrentSalary`, `getLastRatings` | Sole data source (FR-4.2); no new query functions added |
| `src/server/app.ts:createApp` | New `GET /api/employee-details` route registered here (AR-4.2, AR-4.4) |
| `express.static(PUBLIC_DIR)` | Serves the new page with no new middleware (FR-4.3) |
| `public/chart-logic.js:buildTree`, `managerList`, `visibleIds` | Reused unchanged for the manager filter (AR-2.1, FR-2.2, FR-2.3) |
| `public/employeeDetailsLogic.js` (new) | Position filtering, AND combination, sorting, payload-shape validation — DOM-independent (AR-2.2, AR-2.3, FR-4.4) |
| `public/index.html`, `public/headcount.html` | Both gain a third nav link (FR-4.5); no other change |
| `test/server/helpers.ts:withTestServer` | Reused as-is for endpoint tests (AR-4.2) |

## Related Specs

| Spec | Relationship | Affected Requirements |
| --- | --- | --- |
| [Spec 001: Data Foundation & SQLite Schema](../001-data-foundation/spec.md) | **Depends on** — supplies the schema and `getAllEmployees`/`getCurrentSalary`/`getLastRatings` this spec composes without adding new SQL | FR-1.1, FR-1.2, FR-4.1, FR-4.2 |
| [Spec 002: WorkDay Import Screen](../002-workday-import/spec.md) | **Depends on** — supplies the Express server, `public/` static-file pattern, and `npm start` entry point | FR-4.3, AR-1.2 |
| [Spec 002: WorkDay Import Screen](../002-workday-import/spec.md) | **Modifies** — `index.html`'s nav gains a third link; upload/confirm behaviour unchanged | FR-4.5 |
| [Spec 003: Headcount Dashboard Screen](../003-headcount-dashboard/spec.md) | **Depends on** — reuses `chart-logic.js`'s `buildTree`/`managerList`/`visibleIds` unchanged, and the nav-shell/read-only-endpoint/data-access-layer-reuse pattern its own Related Specs table anticipated | FR-2.2, FR-2.3, AR-2.1, FR-4.2, FR-4.5, AR-4.1, AR-4.2, AR-4.3 |
| [Spec 003: Headcount Dashboard Screen](../003-headcount-dashboard/spec.md) | **Modifies** — `headcount.html`'s nav gains a third link; chart/filter behaviour unchanged | FR-4.5 |

## Constraints

- **Read-only.** No requirement in this spec writes to the database.
- **No anniversary lookup.** Formally dropped, matching spec 001's Change Log
  (2026-08-31): the schema has no hire-date field at all, since the real
  WorkDay export supplies none. The roadmap entry that originally proposed
  it predates that discovery.
- **No currency conversion or normalisation**, inherited from spec 001
  AR-2.1: `currency` is displayed exactly as stored; no cross-currency
  aggregation is computed by this screen.
- **No position normalisation**, inherited from spec 003's precedent:
  differently-spelled equivalent roles remain distinct checkbox entries and
  distinct rows.
- **Per-employee N+1 queries are accepted, not optimised.** `getCurrentSalary`
  and `getLastRatings` take a single employee id each and re-prepare their
  SQL statement on every call — `src/db/queries.ts` has no cached
  prepared-statement pattern for either function. This spec calls them once
  per active employee rather than adding a batch query or caching
  statements. Actual latency at this project's expected scale (hundreds to
  low thousands of employees) has not been measured — see Assumptions &
  Risks — so this is an accepted, not a verified, tradeoff. If a future
  import brings headcount to a scale where this becomes noticeable, batching
  `getCurrentSalary`/`getLastRatings` into multi-employee queries in
  `src/db/queries.ts` is the fix, not a workaround in this screen's own
  endpoint.
- **Local, single-user, no authentication**, inherited from spec 002/003 —
  the roster and, on this screen, compensation and rating data as well, are
  served without authentication to any local process able to reach
  `127.0.0.1:<port>` while the server runs. This includes other local users
  or processes on a shared machine, not only other browser tabs: binding to
  loopback and omitting CORS headers (AR-4.1) stops a remote or
  cross-origin read, not a same-machine one. `Cache-Control: no-store`
  (AR-4.4) narrows how long a past response can outlive the request that
  produced it, but does not change who can request it live.
- **No framework, no build step** (AR-1.2).

## Out of Scope

- The anniversary lookup (any date-range-based "who has a work anniversary in
  this window" query) — dropped along with the underlying schema field (see
  Constraints).
- Creating, editing, or deleting any employee, salary, or rating record from
  this screen.
- Total headcount or any position-count aggregation — that is spec 003's
  Dashboard, which this spec does not duplicate.
- Free-text search, beyond the two checkbox filters.
- Pagination — the full filtered/sorted set renders at once, matching the
  clarified decision for this spec.
- Persisting filter selection or sort column/direction across a page
  reload — every reload resets to all-checked filters and FR-3.1's default
  sort (`name` ascending), regardless of what was selected before the
  reload.
- Full salary or rating history views (`getSalaryHistory`, `getRatingHistory`)
  — this screen shows only the current salary snapshot and last three
  ratings, matching the roadmap's column list.
- Currency conversion, aggregation, or a "total compensation" figure.
- A direct-reports-only manager filter mode — the manager filter always
  shows the selected manager's whole subtree (clarified decision).
- A loading indicator or spinner between page load and the fetch resolving —
  same reasoning as spec 003's equivalent decision, though this endpoint's
  N+1 query pattern (FR-4.2) makes it somewhat slower than spec 003's single
  query; see Assumptions & Risks.
- Retry-on-failure — FR-4.4 tells the user to reload, matching spec 003's
  equivalent decision.
- Live refresh — the page fetches once on load.
- A "Manager" text column in the table itself — the roadmap's column list
  names id, name, position, salary fields, and ratings only; the manager
  checkbox list is the only place manager identity surfaces on this screen.
- Authentication, authorization, and multi-user access control.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — every FR carries a **Verify:** line;
  Out of Scope lists 14 explicit exclusions, resolving the roadmap's open
  anniversary-lookup and pagination questions explicitly rather than by
  omission.
- [x] **Testing strategy** — follows the existing pattern
  (`specs/docs/conventions/data-access-layer.md#testing`,
  `conventions/browser-screens.md`): `node:test` via `tsx`, test names citing
  FR ids. Endpoint tests go in `test/server/` reusing `withTestServer`
  (AR-4.2), asserting the exact eight-key/nested-`ratings` projection
  (FR-4.1), the `rating_period`-to-camelCase-key mapping including its
  null-when-absent cases (FR-4.2), the empty-database `{ employees: [] }`
  case, the `500` body (AR-4.3), and the `Cache-Control: no-store` header
  on both the `200` and `500` paths (AR-4.4) — these are genuine server
  responses, so `test/server/` covers them directly. FR-4.4's
  malformed-`200`-body case is different in kind: it's a client-rendering
  behavior, and this project has no browser test harness to automate DOM
  assertions (the same limitation FR-1.4's and FR-2.5's non-table states
  already accept). Its Verify line is split accordingly — the payload
  validation function itself (AR-2.3) is `node:test`-automatable, imported
  the same way `chart-logic.js`'s functions already are; the actual "page
  displays the message" consequence is manually verified, not claimed as
  automated. FR-4.2's own "no new file under `src/db/`" clause is a
  structural check verified by code review rather than a `node:test` case,
  unlike every other FR's Verify line — noted explicitly there rather than
  left implicit. AR-2.3 makes the filter/sort/validation logic importable,
  and the A→B→C hierarchy fixture spec 003's tests already use is reused
  here (via `test/db`'s write API, not an `.xlsx` fixture) to verify
  FR-2.3's reused `visibleIds` behaviour, and FR-2.5's corrected zero-rows
  example, through this screen. AR-3.1's tie-break rule now has a worked
  Verify case in FR-3.1 (two rows tied on the sorted column, resolved by
  `name` then `id`), and FR-3.3's missing-values-last rule now has a
  worked example for a string (rating) column, not only the numeric
  `bonus` example. The reference file gives concrete fixture counts (43
  employees; 5 managers) reused from spec 003.
- [x] **Existing patterns** — AR-1.2 (vanilla JS + `public/`), AR-2.1 (import
  `chart-logic.js` rather than duplicate), AR-3.1 (`localeCompare`, matching
  `chart-logic.js`'s own comparator), AR-4.2 (register in `createApp`),
  AR-4.3 (`{ error }` response shape) each name the existing pattern and file
  being followed, mirroring spec 003's own checklist structure.
- [x] **Dependencies** — none added. `package.json` is unchanged by this
  spec.
- [x] **Architecture & interfaces** — FR-4.1 fixes the payload shape and its
  exact eight-key set (including the nested `ratings` object, FR-4.2's
  explicit `rating_period`-to-key mapping, and an explicit caution against
  passing the raw `Employee` object through); FR-1.2 now fixes the table's
  left-to-right column order rather than leaving it implied; AR-2.1/AR-2.2
  fix the client-side module boundary (reused vs. new logic); AR-3.1 fixes
  the string-comparator and tie-break rules; AR-2.3 fixes the
  testable-logic boundary, now including FR-4.4's payload-shape validation
  function alongside filtering/sorting; the Data Requirements, Integration
  Points, and
  Related Specs tables enumerate every field read, every existing file
  touched, and every spec-003 requirement this one leans on (including
  FR-4.2's data-access-layer-reuse precedent). No schema impact.
- [x] **Error handling & failure modes** — FR-1.3 (missing salary/rating data,
  per cell), FR-1.4 (empty database), FR-2.2 (no managers at all — fieldset
  omitted), FR-2.5 (filters leave zero rows), FR-4.4 (fetch failure, fixed
  message and cleared state — now with equal Verify coverage for both the
  transport-failure and malformed-but-parseable-body branches, not prose
  for the latter only), AR-4.3 (catch-all server response with a fixed
  body). The three non-table states (FR-1.4, FR-2.5, FR-4.4) each have
  distinct, asserted wording.
- [x] **Security review** — AR-1.1 (XSS: spreadsheet-and-report-sourced
  text nodes — now including `id`, since this screen renders it as a
  visible cell unlike spec 003 — *and* attribute values built from the same
  data, now including free-text `ratingValue` and `currency` and not just
  name/position/country, plus a generated-DOM-id requirement for position
  checkboxes so raw `position` text is never used as a bare identifier —
  restated explicitly rather than left for the reader to infer from
  `browser-screens.md`), AR-4.1 (no `Origin` check needed on a `GET`, no
  CORS headers, localhost binding retained), AR-4.3 (no internal error
  detail returned), AR-4.4 (`Cache-Control: no-store` on a response carrying
  compensation and rating data, now Verified on both the `200` and `500`
  paths). The unauthenticated local exposure of that
  data — a step beyond spec 003's roster-only exposure, and one that reaches
  other local users on a shared machine, not just other browser tabs — is
  recorded explicitly in Constraints as an accepted, inherited risk rather
  than left implicit.
- [ ] **Performance impact** — one `getAllEmployees()` call plus two
  per-employee calls (`getCurrentSalary`, `getLastRatings`, each re-preparing
  its SQL statement — see Constraints) — an N+1 pattern explicitly accepted
  in FR-4.2/Constraints rather than batched. This is expected to stay fast
  at the same scale spec 001/003 already assume (hundreds to low thousands
  of employees, `better-sqlite3`'s synchronous model), but that expectation
  is not measured against real data volume, so it is left open rather than
  asserted as fact — consistent with spec 001's own open Performance item
  for the identical "real volume unknown" situation. All filtering and
  sorting happen client-side on data already loaded (FR-2.1, FR-3.4), so
  neither triggers a new request. No virtualisation needed at the scale
  actually observed so far (43 employees).
- [x] **Rollout & migration** — no migration: read-only, no schema change,
  no new dependency. FR-4.5's nav edits to `index.html`/`headcount.html` are
  additive (one new `<a>` each); the existing `test/server/app.test.ts` and
  `test/server/headcount.test.ts` suites guard those pages' existing
  behaviour while the edits are made.
- [x] **Assumptions & risks** — stated below.

### Assumptions & Risks

- **Assumed:** The manager filter's default-all-checked, uncheck-to-hide
  interaction (FR-2.3) is the right mental model to carry over from spec
  003's dashboard, rather than a default-none-checked, check-to-include
  model more typical of standalone filter panels. Chosen for consistency
  across the app's two filterable screens, and because it lets this spec
  reuse `visibleIds()` verbatim (AR-2.1) instead of writing new
  inclusion-based traversal logic.
- **Assumed:** The position filter (FR-2.1) defaults to all-checked as well,
  matching the manager filter's default, even though it has no hierarchy of
  its own — consistency between the two filter panels on one screen.
- **Risk:** FR-4.2's N+1 query pattern (one `getCurrentSalary` and one
  `getLastRatings` call per active employee) has not been measured against
  real data volume beyond the ~43-row reference file. If a future import
  brings headcount into the thousands, this is the first place to look
  before adding a batch query to `src/db/queries.ts` — not a change this
  spec makes preemptively, consistent with spec 001's existing open
  Performance checklist item.
- **Risk:** FR-4.5 edits working, reviewed code in `index.html` and
  `headcount.html`. Keep the edits mechanical (one additional `<a>` per nav
  element) and verify against the existing server test suites rather than
  rewriting either page.
- **Accepted:** This screen exposes compensation and rating data — a step
  beyond spec 003's roster-only exposure — to any local process able to
  reach the port, with no additional guard beyond what spec 002/003 already
  established for a local, single-user tool. Recorded as an inherited,
  accepted risk (Constraints) rather than a gap introduced by this spec.
- **Accepted:** FR-3.3's missing-values-sort-last rule is a specific, minor
  UX choice with no precedent elsewhere in this project; revisit if using
  the screen reveals it reads as surprising rather than helpful.

---

## Change Log

### Update from critique-consolidated-v-1.md

**Applied:**

- Fixed FR-4.1's Verify line and the Testing/Architecture checklist entries
  to say **eight** top-level payload keys, not seven — a plain factual
  error in the original draft.
- Reworded "last three end-of-year ratings" (Overview) to "last three rating
  periods," since spec 001's schema stores three relative, undated labels
  with no calendar anchor at all.
- Added the explicit `rating_period` → camelCase-key mapping requirement to
  FR-4.2, including the absent-period-fills-with-`null` rule, and a Verify
  case that actually exercises the mapping rather than only the route's
  file-structure.
- Restated AR-1.1's XSS rule to cover attribute values (checkbox
  `value`/`id`/`label[for]` pairs), not just text nodes — it had silently
  dropped the attribute-value half of the exact rule it claimed to extend
  from spec 003 AR-1.4 and `browser-screens.md`.
- Added new **AR-3.1**, fixing the sort/filter string comparator
  (`localeCompare`, matching `chart-logic.js`'s own `byNameThenId`) and a
  universal `name`-then-`id` tie-break for every user-initiated sort, not
  only the initial load. Updated FR-2.1, FR-3.1, and FR-3.2 to reference it,
  and replaced FR-3.2's flawed Verify example (`"...099"` vs. `"...100"`,
  which is actually lexicographic-numeric-equivalent for equal-length
  zero-padded ids and demonstrated nothing) with a genuinely divergent
  `"9"` vs. `"10"` example, noting why the reference file's own ids never
  actually surface the divergence.
- Required sortable column headers to be keyboard-operable (a `<button>`
  inside each sortable `<th>`, Enter/Space equivalent to a click) in FR-3.1,
  since the WAI-ARIA pattern that FR already cited by name expects a
  keyboard trigger, not only the `aria-sort` indicator.
- Corrected FR-2.5's impossible example: the manager filter alone can never
  reach zero visible rows, since `visibleIds()`'s root-is-always-visible
  invariant (inherited from spec 003 FR-1.4) guarantees at least one row
  survives it; reaching zero always requires the position filter too.
- Reworded AR-2.1: the payload is a merge of three query calls
  (`getAllEmployees`/`getCurrentSalary`/`getLastRatings`), not a native
  superset of the `Employee` type, even though it happens to satisfy
  `chart-logic.js`'s shape requirements either way.
- Softened the Constraints performance claim to match the hedging already
  present in Assumptions & Risks, noted that `getCurrentSalary`/
  `getLastRatings` re-prepare their SQL statement on every call, and added a
  concrete threshold ("if headcount reaches a scale where this becomes
  noticeable, batch these calls in `src/db/queries.ts`"). Downgraded the
  Performance checklist item from `[x]` to `[ ]`, matching spec 001's own
  honest precedent for the identical "real volume unknown" situation.
- Added new **AR-4.4**, requiring `Cache-Control: no-store` on the
  endpoint's response, and a shared-machine caveat to the "local,
  single-user, no authentication" Constraints bullet (loopback binding and
  no CORS headers stop a remote/cross-origin read, not a same-machine one).
- Added FR-4.1 Verify cases for the empty-database `{ employees: [] }`
  response and the all-or-nothing salary-field-nullability guarantee (cited
  against spec 001's `NOT NULL`/default schema), and extended FR-4.4 to
  treat a syntactically-valid but malformed payload (a missing `ratings` key
  or sub-key) identically to a network/parse failure.
- Noted explicitly, in both FR-4.2 and the Testing Strategy checklist item,
  that FR-4.2's "no new file under `src/db/`" Verify line is a structural
  check confirmed by code review, not an automatable `node:test` case like
  every other FR's Verify line.
- Fixed the Out of Scope count in the Scope checklist item (14 exclusions,
  not 13 — a plain counting error in the original draft, unrelated to the
  critique but caught while reviewing the same section).

**Rejected:** none — every finding across all three critiques (main-agent,
codex, claude-haiku) was valid and cheap to close; none introduced scope
beyond clarifying or correcting what the spec already claimed to do.

**Reorganized:**

- Feature 3 gained a real Architectural Requirements subsection (new
  AR-3.1); the placeholder parenthetical note that previously stood there
  is now a closing cross-reference to AR-2.3 underneath it, rather than the
  section's only content.

### Update from critique-consolidated-v-2.md

**Applied:**

- Added the missing Verify case to FR-4.4 for the malformed-but-parseable
  `200` body branch — the one v1 fix (of three originally flagged missing
  Verify cases) that had only gotten prose, not an actual test scenario;
  independently caught by two of the three v2 critiques.
- Added a `Cache-Control: no-store` check to both FR-4.1's `200` Verify
  line and FR-4.4's `500` Verify line, so AR-4.4's "every response" claim
  has coverage on both paths rather than none.
- Added `id` to AR-1.1's text-node enumeration — this screen, unlike spec
  003, renders `id` as an ordinary visible table cell (FR-1.2), and spec
  001 leaves its format entirely unconstrained, so it's exactly as
  untrusted as `name`/`position` by AR-1.1's own stated reasoning.
- Added a requirement to AR-1.1 that position checkboxes use a generated,
  screen-local DOM identifier rather than the raw `position` string as the
  `id`/`for` attribute value — unlike spec 003's numeric employee ids,
  `position` is arbitrary text that can contain characters unsuited to a
  bare DOM identifier.
- Added a tie-break-specific Verify case to FR-3.1 (two rows tied on the
  sorted column, resolved by `name` then `id`), closing the one rule in the
  document that previously had no way to be confirmed by test.
- Added an `aria-sort` single-active-header invariant and a non-colour
  visible direction indicator to FR-3.1, with matching Verify coverage.
- Cross-referenced FR-3.3 from FR-3.2 for numeric-column missing-value
  handling, closing a small ambiguity between the two FRs.
- Stated FR-1.2's left-to-right column order explicitly, rather than
  leaving it implied by FR-4.1's payload key order.
- Added a one-line clarification to the existing "no persistence" Out of
  Scope item: every reload resets to all-checked filters and the FR-3.1
  default sort.
- Added a "not the raw `Employee` object passed through" caution to FR-4.1,
  mirroring spec 003 FR-3.1's identical caution for its own endpoint.
- Clarified FR-4.2's "no new file under `src/db/`" wording: it rules out a
  new query/schema, not a presentation-layer helper function living
  elsewhere.
- Added FR-4.2 to the spec 003 "Depends on" row's Affected Requirements in
  Related Specs, since FR-4.2's own prose cites spec 003 AR-3.1's
  data-access-layer-reuse precedent directly.
- Updated the Testing Strategy, Error Handling, Security Review, and
  Architecture & Interfaces checklist notes to reflect all of the above.

**Rejected:**

- A non-normative "implementation sketch" with concrete function
  signatures for `public/employeeDetailsLogic.js` — this project's
  spec-writing convention is WHAT-not-HOW, and spec 003's equivalent AR-2.3
  for `chart-logic.js` carries exactly the same level of specificity (data
  in/data out, no code); adding a sketch here would be inconsistent with
  that precedent, not a gap relative to it.
- Recategorizing AR-4.4 from "Architectural" to a separate "Security"
  grouping — this spec's own structure already files security-flavoured
  rules as Architectural Requirements throughout (AR-1.1, AR-4.1, AR-4.3);
  AR-4.4 following the same pattern isn't a new organizational problem.
- Reordering Features 2 and 3 to avoid FR-2.1's forward reference to
  AR-3.1 — forward references already exist elsewhere in this document's
  ordinary style, and reordering would cost more narrative clarity than it
  buys.
- A performance-risk action threshold — already present in the Constraints
  section's N+1-queries bullet since the v1 update; no change needed.
- A suspected contradiction between AR-3.1 and AR-2.1 over whether
  `chart-logic.js`'s (unexported) `byNameThenId` is "reused" — checked
  directly against the source: AR-3.1 cites it only as a design precedent
  to match, never as an import, and AR-2.1's actual reused-imports list
  never includes it. No contradiction exists.

**Reorganized:** none this round — all changes were merged into their
existing, most-relevant requirement rather than appended separately.

### Update from critique-consolidated-v-3.md

**Applied:**

- Extended AR-2.3 to require FR-4.4's payload-shape validation (checking
  for a missing `ratings` key or sub-key) to live as a pure function in
  `public/employeeDetailsLogic.js`, alongside the existing filtering/sorting
  logic — this is what actually makes the malformed-payload rule
  `node:test`-automatable, since this project has no browser test harness
  to assert DOM/page-rendering behavior directly.
- Split FR-4.4's malformed-payload Verify line into its automatable half
  (the validation function returns invalid for the given body) and its
  manually-verified half (the page renders the failure state) — the
  previous wording implied both were covered by the same automated test,
  which isn't possible for the rendering half in this project's test setup.
- Corrected the Testing Strategy checklist to state plainly which FR-4.4
  cases `test/server/` actually covers (genuine server responses:
  empty-database, `500`, `Cache-Control`) versus the malformed-`200` case's
  split automated/manual coverage — removing the overclaim that grouped it
  with the server-testable cases.
- Broadened FR-3.3 to state explicitly that its missing-values-sort-last
  rule governs all five FR-1.3-placeholder-capable columns (`currency`,
  `baseSalary`, `bonus`, and the three rating-period columns), not only
  `baseSalary`/`bonus`; adjusted FR-3.2's cross-reference to match, and
  added a rating-column Verify example to FR-3.3 alongside the existing
  `bonus` one.
- Corrected AR-1.1's rationale sentence, which had called spec 003's
  employee ids "numeric" — spec 001's own Constraints leave that format
  formally undefined; reworded to "happen to be numeric in every observed
  export," matching this document's own careful phrasing in FR-3.2.
- Updated the Integration Points table and the Architecture & Interfaces
  checklist note to reflect `employeeDetailsLogic.js`'s new
  validation responsibility.

**Rejected:** none — both substantive findings (the testability gap, the
incomplete FR-3.2/FR-3.3 cross-reference) and the one rationale correction
were valid and cheap to close.

**Reorganized:** none — all changes were merged into their existing,
most-relevant requirement.

**Note on review cadence:** this was the third consecutive critique/update
round. All three v3 adapters converged on a "diminishing returns reached"
verdict, with the findings above being the only substantive items across
all three independent reviews. No further critique round is planned before
implementation.

