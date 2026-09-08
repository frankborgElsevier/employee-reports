# Spec 001: Data Foundation & SQLite Schema

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-08-31.
> Implementation summary: `specs/features/001-data-foundation/implementation-summary.md`
> Implementation review: `specs/features/001-data-foundation/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

This spec defines the SQLite schema and a typed Node.js/TypeScript data-access
layer — both queries and writes — that will back every screen in the WorkDay
reporting dashboard app: employees, their org hierarchy (line manager
relationships), salary history, and performance rating history. It is a
prerequisite for the Headcount Dashboard, Employee Details, and WorkDay
Import specs described in [specs/roadmap.md](../../roadmap.md).

## Goals

- Provide a single, consistent SQLite schema for employee, org-hierarchy,
  salary, and rating data that later screens can query without re-deriving
  data shapes.
- Provide a typed data-access layer (query and write functions) so
  downstream specs — including the future WorkDay Import spec — call
  functions instead of writing ad hoc SQL.
- Support "last three end-of-year ratings" and "current salary" as queries
  over full history tables, rather than fixed columns, so history isn't lost
  and isn't artificially capped at three.

## Initiative Context

None — no Cyclops initiative or slice exists in this repository.

---

## Feature 1: Employee & Org Hierarchy Schema

**Who & why:** Every other spec in this project (Headcount Dashboard,
Employee Details, WorkDay Import) needs a single source of truth for "who is
an employee, what do they do, and who do they report to." It also needs to
distinguish active employees from those who have left, since headcount
totals must reflect only current staff. Without this defined up front, each
screen would invent its own shape for employee and org data, and
reconciling them later would require a migration.

### Functional Requirements

#### FR-1.1: Employee record

The schema defines an `employees` table with one row per employee, holding:
`id` (the WorkDay employee id, primary key, stable natural key), `name`,
`position` (free-text current job title/position), `country` (raw
location/country value as provided by the data source — not a
pre-computed color bucket), `end_date` (nullable ISO 8601 date — see
FR-1.2), and `manager_id` (nullable, self-referencing foreign key to
`employees.id`). There is no hire-date field: the anniversary-lookup
feature that originally motivated one was dropped from scope, and no
WorkDay report field supplies a hire date (see `workday_docs_examples/`).
**Verify:** Inserting an employee with a valid `manager_id` pointing to
another existing employee succeeds; inserting an employee with `manager_id`
set to a non-existent employee id fails.

#### FR-1.2: Active employee determination and field validation

An employee is **active** when `end_date IS NULL`, and **inactive** (a
former employee) once `end_date` is set. `end_date`, when present, must be
a valid ISO 8601 extended calendar date (`YYYY-MM-DD` only — not basic
format, week dates, or ordinal dates; e.g. `2025-03-14`); a malformed value
is rejected.
`id`, `name`, `position`, and `country` must each be non-empty after
trimming leading/trailing whitespace — an empty or whitespace-only value
is rejected. All of these checks are enforced by `upsertEmployee` (FR-4.3)
before any row is written. Query functions that return multiple employees
(`getAllEmployees`, FR-4.1) accept an optional flag to include inactive
employees, defaulting to active-only, since headcount totals and
org-hierarchy views need active employees by default.
**Verify:** Writing an employee with `end_date = '2025-13-40'` (not a valid
calendar date) is rejected; writing one with `name = '   '` or
`id = '   '` (whitespace only) is rejected; `getAllEmployees()` called
with no arguments returns only employees where `end_date IS NULL`.

#### FR-1.3: Root-of-hierarchy support

`manager_id` is nullable. Exactly the employees with no manager (e.g. the
most senior person(s) in the org) have `manager_id = NULL`, representing the
root(s) of the org hierarchy.
**Verify:** An employee inserted with `manager_id = NULL` is retrievable and
is treated as a hierarchy root by traversal queries (FR-1.5).

#### FR-1.4: Circular manager reference prevention

The `reassignManager` write function (FR-4.3) rejects any change that would
make an employee their own manager, directly or transitively (a cycle in
the manager graph). SQLite foreign keys alone cannot express this, so it is
validated in application code before writing.
**Verify:** Attempting to set employee A's manager to employee B, when B
(directly or via a chain) already reports to A, is rejected with an error
before any row is written.

#### FR-1.5: Org hierarchy traversal query

The data-access layer exposes a function to retrieve an employee's full
reporting chain in both directions: all descendants (direct and indirect
reports) given a manager id, and all ancestors (chain of managers) given an
employee id, using a recursive query over `manager_id`. Results exclude the
starting employee themselves. Descendants are ordered by hierarchy depth
ascending (direct reports before their own reports), then by `id`
ascending among siblings at the same depth, for deterministic output;
ancestors are ordered from nearest manager to most senior. Like
`getAllEmployees` (FR-1.2), both functions accept the same optional
`includeInactive` flag, defaulting to active-only — this filters which
rows are *returned*, not which are *traversed*: an inactive employee
sitting between two active employees in the chain does not block
traversal, so an active descendant behind an inactive manager is still
found and returned.
**Verify:** Given a 3-level hierarchy (A manages B, B manages C), querying
descendants of A returns B before C; querying ancestors of C returns B
before A, and neither result includes the starting employee. Calling
`getDescendants` with the default `includeInactive: false` excludes any
descendant whose `end_date` is set, but still returns an active
grandchild whose direct manager is inactive.

#### FR-1.6: Foreign key delete behavior

Deleting an employee who still has direct reports (another employee's
`manager_id` pointing to them) is rejected until those reports are
reassigned (FR-4.3) to a different manager or to `NULL`. Deleting an
employee with no remaining direct reports also removes their
`salary_history` and `rating_history` rows, since those rows have no
independent meaning without the employee they describe.
**Verify:** Deleting an employee who is still referenced by another
employee's `manager_id` fails; deleting an employee with no direct reports
succeeds and removes their `salary_history`/`rating_history` rows along
with the employee row.

### Architectural Requirements

#### AR-1.1: SQLite driver

Use `better-sqlite3` (v13.x; requires Node.js >= 22, per its published
`engines` field) as the Node.js SQLite driver. It provides a synchronous
API, a built-in `.transaction()` wrapper, and a larger, more established
feature set than the built-in `node:sqlite` module — which reached
"release candidate" stability as of Node.js 25.7 but is still newer and
less battle-tested than `better-sqlite3`. No ORM is introduced; queries
and writes are hand-written SQL via prepared statements, since the schema
is small and an ORM would add a dependency without solving a problem this
project has. Every value supplied by a caller (employee names, positions,
countries, rating text, etc.) is passed as a bound parameter — no SQL
string concatenation is permitted — to eliminate SQL injection risk.
This spec targets Node.js 22 or later.

#### AR-1.2: Schema initialization

The schema is created via a single idempotent initialization script (e.g.
`CREATE TABLE IF NOT EXISTS`) run on app startup, rather than a full
migration framework. `CREATE TABLE IF NOT EXISTS` does nothing to a table
that already exists under an older column shape — it neither errors nor
updates it — so a schema change to an already-defined table (as happened
to `rating_history` on 2026-08-31, see Change Log) needs its own explicit
compatibility check (FR-4.2) rather than relying on the init script to
catch the mismatch. This remains sufficient for a project with no real
migration to perform yet (no deployed database predates any schema
version); a full migration framework is revisited only if that stops being
true (see Out of Scope).

#### AR-1.3: Foreign key enforcement

SQLite foreign key constraints are OFF by default per connection; the
data-access layer executes `PRAGMA foreign_keys = ON` once, when the single
shared connection (AR-4.3) is opened, so that `employees.manager_id`
referential integrity (FR-1.1) and the delete behavior in FR-1.6 are
actually enforced.

---

## Feature 2: Salary History

**Who & why:** The Employee Details screen needs current base salary,
currency, and bonus per employee. Storing only a single "current" value
would lose history and make it impossible to answer questions like "what
was this person's salary last year" later, so salary is modeled as a
history table.

### Functional Requirements

#### FR-2.1: Salary history record

The schema defines a `salary_history` table with one row per employee per
effective year, holding: `employee_id` (foreign key to `employees.id`),
`effective_year` (integer calendar year), `currency` (ISO 4217 currency
code, e.g. `GBP`, `USD`, `INR`), `base_salary` (numeric), and `bonus`
(numeric, defaults to 0 if not provided). The combination of
(`employee_id`, `effective_year`) is unique.
**Verify:** Inserting two `salary_history` rows for the same employee and
the same `effective_year` fails on the second insert.

#### FR-2.2: Current salary query

The data-access layer exposes a function that returns an employee's
"current" salary, currency, and bonus as the `salary_history` row with the
highest `effective_year` that is not greater than the current calendar
year (see AR-2.2 for how "current calendar year" is determined). This
excludes any future-dated row permitted by FR-2.3 (e.g. a planned raise
recorded a year in advance) until that year actually arrives.
**Verify:** Given an employee with `salary_history` rows for 2023, 2024,
and 2025, the current-salary query returns the 2025 row; if a 2026 row is
also present while the current calendar year is still 2025, the query
still returns the 2025 row.

#### FR-2.3: Salary field validation

The `upsertSalaryRecord` write function (FR-4.3) rejects a salary record
if: `base_salary` is negative or not a finite number (`NaN`/`Infinity` are
rejected); `bonus` is negative or not a finite number (`bonus = 0` is
valid — it is the field's own default); `currency` does not match a
3-letter uppercase code pattern (e.g. `USD`, `GBP`, `INR`); or
`effective_year` is not an integer in the inclusive range [1990, current
year + 1] (see AR-2.2 for "current year"). This assumes salary is recorded
as one snapshot per employee per calendar year, not tracked at intra-year
granularity — a mid-year raise updates the existing year's row rather than
creating a second row for that year.
**Verify:** Writing a salary record with `base_salary = -1000` is
rejected; writing one with `currency = 'usd'` (lowercase) is rejected;
writing one with `effective_year = 1989` is rejected but
`effective_year = 1990` is accepted; writing one with
`base_salary = Infinity` is rejected; writing one with `bonus = 0`
succeeds.

### Architectural Requirements

#### AR-2.1: No currency conversion

The schema and data-access layer store and return currency values exactly
as provided; no currency normalization or conversion to a common currency
is performed at this layer. If cross-currency aggregation is needed later
(e.g. a total-compensation-in-USD view), that is a presentation-layer
concern for a future spec, not this one.

#### AR-2.2: "Current calendar year" definition

Wherever this spec refers to "the current calendar year" (FR-2.2, FR-2.3,
FR-3.3), it means the year component of the system clock at the moment of
the call, evaluated in UTC — not local time — so behavior at year
boundaries doesn't depend on the server's timezone configuration.

#### AR-2.3: Salary/bonus precision

`base_salary` and `bonus` are stored as SQLite `REAL` (IEEE 754 double).
To bound floating-point representation error, `upsertSalaryRecord`
(FR-4.3) rounds both values to 2 decimal places before writing. This is
adequate for currencies with a 2-decimal minor unit (e.g. `USD`, `GBP`,
`INR`); currencies with a different minor-unit precision (e.g. `JPY`'s 0,
`BHD`'s 3) are out of scope until real WorkDay data requires handling
them (see Constraints).

---

## Feature 3: Performance Rating History

**Who & why:** The Employee Details screen needs each employee's most
recent performance ratings. Modeling this as history (rather than three
fixed columns) means an employee with only one or two recorded ratings is
handled naturally, and "the most recent ratings" becomes a query rather
than a schema constraint.

### Functional Requirements

#### FR-3.1: Rating history record

The schema defines a `rating_history` table with one row per employee per
rating period, holding: `employee_id` (foreign key to `employees.id`),
`rating_period` (text, one of exactly three values: `"Most Recent"`,
`"Prior Rating"`, `"Two Year Prior Rating"` — see Change Log,
2026-08-31: originally this was an integer `rating_year`, but the WorkDay
Import spec's actual source report has no year or date for any rating,
only these three relative labels), and `rating_value` (text — the rating
label/score exactly as provided by the source data; the specific rating
scale is defined by the WorkDay Import spec once real report data is
available). The combination of (`employee_id`, `rating_period`) is unique,
and `rating_period` is constrained (at the database level, via a `CHECK`
constraint, in addition to application-level validation in FR-3.3) to the
three values above. Because the value set is closed at exactly three
periods, an employee can never have more than 3 `rating_history` rows.
**Verify:** Inserting two `rating_history` rows for the same employee and
the same `rating_period` fails on the second insert; inserting a row with
`rating_period = 'Q1 2024'` (not one of the three allowed values) fails at
the database level even if application validation were somehow bypassed.

#### FR-3.2: Ratings query, in fixed period order

The data-access layer exposes a function that returns an employee's
ratings in a fixed order — `"Most Recent"`, then `"Prior Rating"`, then
`"Two Year Prior Rating"` — limited to the first 3 by default (with the
limit as a parameter); a period with no row is omitted, not padded with a
placeholder. Unlike the original `rating_year`-based design, "descending by
year" has no meaning for three relative labels, so ordering is the fixed
period sequence above, not a sort over a stored value. Because the table
can hold at most 3 rows per employee (FR-3.1), this function and the
complete-history function (FR-4.1) now return equivalent results by
construction — both exist for API-shape consistency with `salary_history`'s
equivalent pair, not because they can diverge. The `limit` parameter must
be a positive integer; a `limit` of zero or negative is rejected.
**Verify:** An employee with rows for only `"Most Recent"` and
`"Prior Rating"` (no `"Two Year Prior Rating"` row) returns exactly those 2
rows, in that order, when queried with the default limit of 3; calling the
function with `limit = 0` is rejected; calling it with `limit = 1` returns
only the `"Most Recent"` row, if present.

#### FR-3.3: Rating field validation

The `upsertRatingRecord` write function (FR-4.3) rejects a rating record
if: `rating_value` is empty or whitespace-only after trimming, exceeds 200
characters, or `rating_period` is not exactly one of `"Most Recent"`,
`"Prior Rating"`, or `"Two Year Prior Rating"` (case-sensitive, no
trimming — a caller is expected to pass one of these three literal
values, not arbitrary text). Beyond these bounds, the specific rating
value's scale/format is not validated further, since the real WorkDay
rating format is not yet known (see Constraints).
**Verify:** Writing a rating record with an empty `rating_value` is
rejected; writing one with a 500-character `rating_value` is rejected;
writing one with `rating_period = "Most Recent"` is accepted, but
`rating_period = "most recent"` (wrong case) or `rating_period = "Last
Year"` (not one of the three values) is rejected.

---

## Feature 4: Typed Data-Access Layer

**Who & why:** Downstream specs (Headcount Dashboard, Employee Details,
WorkDay Import) should not need to know SQL or the exact table shapes, for
either reading or writing data. A typed TypeScript module gives them a
stable, testable API surface to build against.

### Functional Requirements

#### FR-4.1: Query function coverage

The data-access layer exposes at minimum: `getEmployeeById(id)`,
`getAllEmployees(options: { includeInactive?: boolean } = {})` (see FR-1.2
for the active/inactive filter default — the options object itself
defaults to `{}`, so `getAllEmployees()` with no arguments is a valid,
type-checking call), `getDescendants(managerId, options: {
includeInactive?: boolean } = {})` / `getAncestors(employeeId, options: {
includeInactive?: boolean } = {})` (see FR-1.5 for ordering,
exclusion-of-self, and the shared `includeInactive` default — same
options-object shape and default as `getAllEmployees`),
`getCurrentSalary(employeeId)`,
`getSalaryHistory(employeeId)`, `getLastRatings(employeeId, limit = 3)`,
and `getRatingHistory(employeeId)`. `getAllEmployees` results are ordered
by `id` ascending — plain string/lexicographic ordering as stored, not
numeric, even if `id` values happen to be numeric strings; callers should
not assume numeric sort order. `getSalaryHistory` and `getRatingHistory`
return an
employee's complete history with no limit or pagination — since
per-employee history volume is inherently small (at most one row per
calendar year for `salary_history`; at most 3 rows total, ever, for
`rating_history`, per FR-3.1) — this is distinct from `getAllEmployees`,
which returns organization-wide data and may need pagination later if
headcount grows large enough to matter (see the open Performance checklist
item). `getSalaryHistory` orders by year ascending (chronological);
`getRatingHistory` and `getLastRatings` both order by the fixed period
sequence in FR-3.2 (`"Most Recent"`, `"Prior Rating"`,
`"Two Year Prior Rating"`) — as of this schema, the two rating functions
return equivalent results by construction, since the table can never hold
more than 3 rows per employee. Each function returns typed TypeScript
objects, not raw SQLite rows.
**Verify:** Each listed function has a corresponding TypeScript type
signature and returns a strongly-typed result, verified by a unit test per
function.

#### FR-4.2: Database initialization entry point

The data-access layer exposes a single initialization function (e.g.
`initDatabase(path: string)`) that opens or creates the SQLite file at the
given path, enables foreign keys (AR-1.3), and runs the schema
initialization script (AR-1.2). `initDatabase` does not create missing
parent directories in `path` — the caller is responsible for ensuring the
containing directory exists, and a missing directory causes it to throw.
Calling `initDatabase` while a connection from a previous call is still
open (consistent with the single-connection model in AR-4.3) throws,
rather than silently returning or replacing the existing connection. The
data-access layer also exposes a matching `closeDatabase()` function that
closes the current connection; after it runs, `initDatabase` may be
called again (against the same or a different path) without throwing.
This pairing exists specifically so tests can open a fresh database,
run assertions, and close it, rather than only ever supporting one
connection for the lifetime of the process. After running the schema
script, `initDatabase` also checks the shape of an already-existing
`rating_history` table (via `PRAGMA table_info`) and throws if it finds the
pre-2026-08-31 `rating_year` column instead of `rating_period` — since
`CREATE TABLE IF NOT EXISTS` (AR-1.2) silently leaves a pre-existing table
untouched, this is the only way an old-shaped database is caught at all,
and this spec has no migration framework to upgrade it in place (see
Constraints). A brand-new database file (where the table doesn't exist yet
and is created fresh by the schema script) never triggers this check.
**Verify:** Calling `initDatabase` against a path with no existing file
creates a new SQLite file containing all defined tables; calling it again
while a connection is already open throws; calling it with a path whose
parent directory doesn't exist throws; calling `closeDatabase()` followed
by `initDatabase` (against any path) succeeds without throwing; calling
`initDatabase` against a database file whose `rating_history` table has a
`rating_year` column instead of `rating_period` throws a clear
"outdated schema" error rather than opening the connection.

#### FR-4.3: Mutation function coverage

The data-access layer exposes write functions: `upsertEmployee(employee)`
(creates or updates an employee's `id`, `name`, `position`, `country`, and
`end_date`; the input type has no `manager_id` field at
all, and a brand-new employee is always created with `manager_id = NULL`),
`reassignManager(employeeId, newManagerId | null)` (the only function that
can set or change `manager_id`; performs the cycle check from FR-1.4 before
writing — assigning a manager to a new hire, including their very first
manager, is always a separate call after `upsertEmployee`),
`upsertSalaryRecord(employeeId, effectiveYear, currency, baseSalary,
bonus = 0)` (creates a new `salary_history` row or updates the existing
row for that employee and year — including changing `currency` between
calls, e.g. for a genuine mid-year relocation — applying the validation
in FR-2.3; `bonus` is optional and defaults to `0`, matching FR-2.1's
record-level default), `upsertRatingRecord(employeeId, ratingPeriod,
ratingValue)` (creates a new `rating_history` row or updates the existing
row for that employee and period, applying the validation in FR-3.3), and
`deleteRatingRecord(employeeId, ratingPeriod)` (removes the `rating_history`
row for that employee and period if one exists — a period with no
existing row is a no-op, not an error, matching ordinary delete semantics,
since there's nothing meaningful to reject; added so a caller whose source
data drops a previously-recorded period, e.g. it ages out of a rolling
3-period window, can remove the now-stale row rather than leave it
orphaned). Each function runs as a single `better-sqlite3` transaction —
either the full write succeeds, or nothing is written.
**Verify:** Calling `upsertSalaryRecord` twice for the same employee and
`effective_year` results in exactly one `salary_history` row, with the
second call's values (including a changed `currency`) overwriting the
first; calling `reassignManager` with a manager id that would create a
cycle throws before any row is written and leaves the database unchanged;
`upsertEmployee`'s input type has no `manager_id` property, so it is not
possible to change an employee's manager through it; calling
`upsertSalaryRecord`, `reassignManager`, or `deleteRatingRecord` with an
`employeeId` that doesn't exist throws rather than writing nothing
silently; calling `upsertSalaryRecord` without a `bonus` argument succeeds
and writes `bonus = 0`; calling `deleteRatingRecord` for an existing
employee's period that has no row succeeds without error and changes
nothing.

#### FR-4.4: Employee deletion

The data-access layer exposes `deleteEmployee(employeeId)`, which enforces
the behavior defined in FR-1.6: it fails if the employee still has direct
reports, and otherwise removes the employee along with their
`salary_history` and `rating_history` rows. It also throws if `employeeId`
doesn't correspond to an existing employee (AR-4.4).
**Verify:** Calling `deleteEmployee` on an employee who still has direct
reports fails; calling it on an employee with no direct reports removes
their `salary_history`/`rating_history` rows along with the employee row;
calling it with an `employeeId` that doesn't exist throws.

#### FR-4.5: Transaction wrapper for multi-step callers

The data-access layer exposes `runInTransaction<T>(fn: () => T): T`, which
runs the given function inside a single `better-sqlite3` transaction on the
shared connection and returns its result — or rolls back and rethrows if
`fn` throws. This exists for callers (the future WorkDay Import spec is the
first) that need several of this Feature's write functions — each already
individually transactional — to succeed or fail together as one unit, e.g.
several `upsertEmployee`/`reassignManager`/`upsertRatingRecord` calls
across many rows in one uploaded file. It is the only supported way for a
caller to get transactional atomicity across multiple calls to this
Feature's functions; the underlying `getConnection()` used internally by
this Feature is not part of the public API (see AR-4.3) and callers must
not reach for it directly. `better-sqlite3` supports this kind of nesting
automatically via savepoints, so calling this Feature's own functions
(each already wrapped in their own `.transaction()`) from inside the
function passed to `runInTransaction` is safe.
**Verify:** Calling `runInTransaction(() => { upsertEmployee(a); throw new
Error("boom"); })` leaves no `a` row in the database — the whole callback,
including the already-completed `upsertEmployee` call, is rolled back;
calling `runInTransaction(() => { upsertEmployee(a); upsertEmployee(b);
return "ok"; })` returns `"ok"` and leaves both `a` and `b` committed.

### Architectural Requirements

#### AR-4.1: Location for shared code

Since this is the first spec in the project, there is no existing codebase
convention to follow. This data-access layer establishes the initial
convention (e.g. a `src/db/` module) that subsequent specs should follow
and reference, rather than introducing a second pattern.

#### AR-4.2: Database file permissions

The SQLite file created by `initDatabase` is created with restrictive file
permissions (owner read/write only, equivalent to mode `0600`) on
POSIX-compliant filesystems (Linux, macOS), since it stores compensation
and performance-rating data; Windows has no equivalent permission model, so
this protection applies only where the host OS supports it. This
restriction must also cover SQLite sidecar files (`-wal`, `-shm`,
`-journal`) regardless of when SQLite creates them — including ones
created or recreated during normal write activity after `initDatabase`
has already returned — since WAL/journal mode can copy recent compensation
and rating data into them; `initDatabase` achieves this by setting a
restrictive process umask (equivalent to `0077`) before opening the
connection, rather than chmod'ing individual sidecar files after the
fact, so every file SQLite creates for the life of the connection
inherits owner-only permissions automatically. If a database file already
exists at `path` with broader permissions, `initDatabase` does not alter
them — this permission hardening applies only to files created after
`initDatabase` is called, not to pre-existing ones. This is local-file
protection, not a substitute for OS-level access control.

#### AR-4.3: Connection lifecycle

The application holds at most one shared database connection at a time,
opened via `initDatabase` and closed only via the explicit
`closeDatabase()` (FR-4.2) — never automatically. In normal production
use this connection is opened once at startup and kept open for the
process's lifetime; `closeDatabase()` exists primarily so tests can tear
down and re-initialize between test cases. No function in this Feature
opens or closes its own connection per call. This connection is used only
on the main thread — `better-sqlite3` connections are not safe to share
across Node.js worker threads, so this spec assumes a single-threaded
Node.js process. This matches `better-sqlite3`'s synchronous,
single-connection design (AR-1.1). `getConnection()`, the internal function
this Feature's own query/mutation functions use to reach the shared
connection, is not exported from this Feature's public module surface — a
caller that needs transactional atomicity across multiple calls uses
`runInTransaction` (FR-4.5), not the raw connection.

#### AR-4.4: Error handling contract

- **Single-entity lookup by id** (`getEmployeeById`): returns `null` when
  no matching row exists, rather than throwing.
- **Collection queries** (`getAllEmployees`, `getDescendants`,
  `getAncestors`, `getSalaryHistory`, `getRatingHistory`): return an empty
  array both when the given id doesn't correspond to any employee and
  when it does but has no matching rows — these two cases are
  indistinguishable from the collection alone; a caller that needs to
  tell them apart calls `getEmployeeById` first.
- **Single-value history queries** (`getCurrentSalary`, and
  `getLastRatings` when nothing qualifies): return `null` / an empty
  array in the same two indistinguishable cases as collection queries
  above, for the same reason.
- **Writes that fail validation or an integrity check** — FR-1.2's field
  checks, FR-1.4's cycle check, FR-1.6/FR-4.4's delete-with-reports
  conflict, FR-2.3/FR-3.3's field validation, FR-4.2's initialization
  failures — throw an error.
- **Writes against a nonexistent employee id** (`reassignManager`,
  `upsertSalaryRecord`, `upsertRatingRecord`, `deleteEmployee`): throw,
  rather than silently affecting zero rows and appearing to succeed;
  `reassignManager` also throws if a non-null `newManagerId` doesn't
  correspond to an existing employee.

The specific error type/class hierarchy is an implementation detail left
to the data-access layer, not specified by this spec.

---

## Data Requirements

### `employees`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | TEXT | Primary key — non-empty after trimming (FR-1.2) |
| `name` | TEXT | Not null |
| `position` | TEXT | Not null |
| `country` | TEXT | Not null — raw location value, not a color bucket |
| `end_date` | TEXT (ISO 8601 date) | Nullable — NULL means still employed (FR-1.2) |
| `manager_id` | TEXT | Nullable, foreign key → `employees.id`, `ON DELETE RESTRICT` (FR-1.6) |

Index: `employees(manager_id)` — supports the hierarchy traversal in FR-1.5.

### `salary_history`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | INTEGER | Primary key, autoincrement |
| `employee_id` | TEXT | Not null, foreign key → `employees.id`, `ON DELETE CASCADE` (FR-1.6) |
| `effective_year` | INTEGER | Not null |
| `currency` | TEXT | Not null — ISO 4217 code |
| `base_salary` | REAL | Not null |
| `bonus` | REAL | Not null, default 0 |

Unique constraint on (`employee_id`, `effective_year`). SQLite's automatic
index for this constraint already supports the current-salary lookup in
FR-2.2 (equality on `employee_id`, ordered by `effective_year`); no
additional index is needed.

### `rating_history`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | INTEGER | Primary key, autoincrement |
| `employee_id` | TEXT | Not null, foreign key → `employees.id`, `ON DELETE CASCADE` (FR-1.6) |
| `rating_period` | TEXT | Not null — `CHECK` constrained to `'Most Recent'`, `'Prior Rating'`, `'Two Year Prior Rating'` (FR-3.1) |
| `rating_value` | TEXT | Not null |

Unique constraint on (`employee_id`, `rating_period`). As with
`salary_history`, this constraint's automatic index already supports the
ratings lookup in FR-3.2; no additional index is needed. (Changed from an
integer `rating_year` on 2026-08-31 — see Change Log.)

## Integration Points

- **WorkDay Import spec (spec 002, written):** is the sole caller of the
  write functions in Feature 4 to populate these tables from WorkDay report
  exports. This spec defines the schema and write API those imports use,
  but not the import/mapping logic itself, nor batch/bulk performance
  tuning (see Out of Scope). Spec 002 accounts for `upsertEmployee` not
  accepting `manager_id` by calling `reassignManager` per employee after
  upserting their base record, and uses `runInTransaction` (FR-4.5) to wrap
  its whole reconciliation — including every `upsertEmployee`/
  `reassignManager` pair — in one transaction, resolving what this
  Integration Point previously left as an open question (how to handle a
  batch import interrupted mid-way).
- **Headcount Dashboard spec (future):** will read `employees` (using the
  active-only default from FR-1.2 for headcount totals) and use the
  org-hierarchy traversal (FR-1.5) and `country` field (for color-bucket
  derivation, computed outside this spec) to render its screen.
- **Employee Details spec (future):** will read `employees`,
  `salary_history`, and `rating_history` via the data-access layer (Feature
  4) to render its table. The anniversary lookup originally planned for
  this screen was dropped from scope (see `specs/roadmap.md`), which is
  also why `employees` has no hire-date column.

## Related Specs

| Spec | Relationship | Affected Requirements |
| --- | --- | --- |
| Spec 002: WorkDay Import Screen | **Depended on by** — its AR-3.1 and AR-5.2 named the `rating_period`/`getLastRatings`/`deleteRatingRecord` and `runInTransaction` changes applied in this update; it cannot be implemented until this update lands | FR-3.1–FR-3.3, FR-4.1, FR-4.2, FR-4.3, FR-4.5 |

The Headcount Dashboard and Employee Details specs described in
[specs/roadmap.md](../../roadmap.md) still depend on this spec once
written, but haven't named specific requirements yet.

## Constraints

- No ORM — direct SQL via `better-sqlite3` prepared statements (AR-1.1).
- No currency conversion or normalization at this layer (AR-2.1).
- No migration framework beyond an idempotent init script (AR-1.2); revisit
  if the schema must change after production data exists.
- `country` values are stored exactly as provided by the eventual import
  source; this spec does not define a normalization/mapping table for
  country name variants (e.g. "United Kingdom" vs "UK" vs "GB") since the
  actual WorkDay export format is not yet known.
- Salary and rating validation (FR-2.3, FR-3.3) rejects obviously malformed
  values (negative amounts, malformed currency codes, an out-of-range
  `effective_year`, an unrecognized `rating_period`) but does not enforce
  business-specific rules WorkDay itself may apply (e.g. approved salary
  bands) — those remain WorkDay's responsibility as the source system.
- This spec assumes a single-threaded Node.js process accessing the
  database (AR-4.3); it does not address multi-process or worker-thread
  access patterns.
- This spec targets Node.js 22+, matching `better-sqlite3`'s published
  `engines` requirement (AR-1.1).
- The 2-decimal rounding rule in AR-2.3 assumes currencies with a 2-decimal
  minor unit; it does not correctly represent zero-decimal (e.g. `JPY`) or
  three-decimal (e.g. `BHD`) currencies.
- `employees.id`'s expected format (numeric string, UUID, alphanumeric,
  case sensitivity, maximum length) is not defined, consistent with the
  spec's existing "format not yet known" stance on `country` — the actual
  WorkDay employee id format is not yet known.

## Out of Scope

- WorkDay report parsing, file formats, and field mapping (WorkDay Import
  spec).
- Batch/bulk-insert performance tuning and transaction chunking for
  large-volume imports — this spec's write functions (FR-4.3) operate per
  record; the WorkDay Import spec will define how many records are written
  per transaction/batch.
- The color-bucket derivation rule (UK/US → blue, India → red, everywhere
  else → green) and any other presentation logic (Headcount Dashboard
  spec).
- Authentication, authorization, or multi-user access control.
- A full schema migration/versioning framework.
- Position normalization (e.g. a separate `positions` table with metadata
  beyond a name) — `position` is a plain text field unless a future spec
  demonstrates a need for more structure.
- A specific error type/class hierarchy (AR-4.4 defines only the
  return-null-vs-throw contract, not the exact exception shapes).
- Currency-specific minor-unit precision beyond the 2-decimal default
  (AR-2.3) — zero-decimal and three-decimal currencies are deferred until
  real WorkDay data requires them.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — scope is the schema + data-access
  layer (reads and writes) only (see Overview, Out of Scope); each FR has a
  Verify line.
- [x] **Testing strategy** — each FR's Verify line implies a unit test
  against a real (in-memory or temp-file) SQLite database, including
  malformed-date, blank-field (including a blank `id`), future-dated-salary,
  invalid-`limit`, inclusive year-boundary, non-finite-number,
  `initDatabase`/`closeDatabase` re-entrancy/missing-directory,
  missing-employee-id (for both queries and writes), invalid-`rating_period`,
  no-op-delete-of-an-absent-rating, `runInTransaction` rollback/commit, and
  outdated-schema-detection cases; follows the test pattern this spec
  established (AR-4.1).
- [N/A] **Existing patterns** — no existing codebase to compare against;
  this spec establishes the initial pattern (AR-4.1).
- [x] **Dependencies** — `better-sqlite3` (Node.js >= 22, per its
  published `engines` field) is justified in AR-1.1 against the
  now-release-candidate `node:sqlite` built-in and against introducing an
  ORM.
- [x] **Architecture & interfaces** — table shapes and indexes are in Data
  Requirements; query function signatures are in FR-4.1 (with explicit
  options-object defaults so zero-argument calls type-check), write/delete
  function signatures are in FR-4.3/FR-4.4 (including `upsertSalaryRecord`'s
  `bonus = 0` default, matching FR-2.1's record-level default, and the new
  `deleteRatingRecord`), the transaction wrapper is in FR-4.5,
  initialization/teardown (`initDatabase`/`closeDatabase`, plus the
  old-schema guard) is in FR-4.2, the "current calendar year" and
  salary-precision terms are defined once each in AR-2.2/AR-2.3, and the
  not-found/empty-vs-throw contract — including collection, history-query
  (both missing-row and missing-employee cases), and missing-employee-id
  write cases — is in AR-4.4.
- [x] **Error handling & failure modes** — circular manager references
  (FR-1.4), foreign-key delete conflicts (FR-1.6), duplicate history rows
  for the same period/year (FR-2.1, FR-3.1), invalid foreign keys (FR-1.1),
  malformed dates and blank id/name/position/country (FR-1.2), an invalid
  ratings-query limit (FR-3.2), malformed/non-finite salary values and an
  unrecognized `rating_period` (FR-2.3, FR-3.3), `initDatabase` misuse and
  an outdated schema (FR-4.2), and writes against a nonexistent employee id
  (AR-4.4) are all explicitly rejected, and AR-4.4 states the general
  not-found/empty-vs-throw contract for every function category.
- [x] **Security review** — this is a local, single-file SQLite database
  with no network exposure or multi-user access in this spec's scope; all
  inputs go through parameterized/prepared statements (AR-1.1), the
  database file and its WAL/journal sidecar files — including ones
  created or recreated after `initDatabase` returns — are covered by a
  restrictive process umask where the OS supports it (AR-4.2), and
  `rating_period` is now constrained at the database level via a `CHECK`
  constraint in addition to application validation (FR-3.1). Revisit if
  the app ever adds a server/API layer or multi-user access.
- [ ] **Performance impact** — expected data volume (number of employees)
  is not yet known. The hierarchy traversal (FR-1.5) is now backed by an
  index on `employees(manager_id)`, and history lookups are covered by
  existing unique-constraint indexes, but whether `getAllEmployees` needs
  pagination is still open until a rough headcount scale is known;
  `better-sqlite3`'s synchronous model is expected to be more than
  sufficient for typical company headcounts (hundreds to low thousands of
  rows).
- [x] **Rollout & migration** — this spec's first real schema change
  (`rating_year` → `rating_period`, 2026-08-31) landed with no deployed
  database predating it, so there was nothing to migrate in practice — but
  FR-4.2's new old-schema guard means a database that *did* predate the
  change would fail loudly at startup rather than silently misbehave under
  `CREATE TABLE IF NOT EXISTS`. This spec still has no migration framework
  (AR-1.2, Out of Scope) — the guard only detects incompatibility, it
  doesn't upgrade a database in place.
- [x] **Assumptions & risks** — key assumptions are called out inline:
  `country` format is unknown until WorkDay Import is scoped (Constraints),
  rating scale/values are opaque text beyond basic validation until then
  (FR-3.1, FR-3.3), salary history assumes one snapshot per employee per
  calendar year with `currency` free to change between updates (FR-2.3,
  FR-4.3), rating history assumes exactly the three period labels spec 002's
  source report produces, with no calendar date at all (FR-3.1, Constraints),
  "current calendar year" is fixed to UTC to avoid timezone-dependent
  boundary behavior (AR-2.2), 2-decimal salary/bonus rounding assumes
  2-decimal-minor-unit currencies (AR-2.3, Constraints), the
  single-init-script approach (AR-1.2) has no in-place upgrade path beyond
  failing loudly on a mismatch (FR-4.2), the data layer assumes a
  single-threaded Node.js process on Node 22+ (AR-4.3, Constraints), and
  bulk-import transaction coordination across multiple write calls is now
  handled via `runInTransaction` (FR-4.5) rather than left as an open
  question for the WorkDay Import spec (Integration Points).

---

## Change Log

### Update from critique-consolidated-v-1.md

**Applied:**

- Added `end_date` column and active/inactive employee semantics (FR-1.2),
  resolving the Headcount Dashboard's headcount-total blocker.
- Added explicit foreign key delete behavior: `RESTRICT` for `manager_id`,
  `CASCADE` for salary/rating history (FR-1.6).
- Added the full mutation/write API — `upsertEmployee`, `reassignManager`,
  `upsertSalaryRecord`, `upsertRatingRecord` (FR-4.3), and `deleteEmployee`
  (FR-4.4) — each scoped to a single transaction.
- Added salary and rating field validation (FR-2.3, FR-3.3): non-negative
  amounts, currency code shape, sane year ranges, and a rating-value length
  cap.
- Clarified hierarchy traversal ordering and exclusion of the starting
  employee (FR-1.5).
- Clarified that `getSalaryHistory`/`getRatingHistory` are intentionally
  unbounded (small per-employee volume), distinct from `getAllEmployees`
  (FR-4.1).
- Added an index on `employees(manager_id)` to support hierarchy traversal.
- Made prepared-statement usage explicit for all string inputs (AR-1.1),
  and added database file permission handling (AR-4.2) and connection
  lifecycle (AR-4.3).
- Upgraded the Security checklist item from N/A to addressed, citing the
  above.

**Rejected:**

- Indexes on `salary_history(employee_id, effective_year)` and
  `rating_history(employee_id, rating_year)` — SQLite's existing `UNIQUE`
  constraints on these same column pairs already create equivalent
  automatic indexes; adding explicit duplicate indexes would be redundant.
- Distinct error codes/types for constraint violations vs. validation
  failures — this is an implementation detail (how errors are surfaced),
  not a requirement; left to the implementer.
- Timezone context on `start_date` — the field is a date-only value used
  for year-over-year anniversary comparisons, where time-of-day and
  timezone don't change the result; adding this would be unused
  complexity.
- Arbitrary max-length limits on `name`, `position`, and `country` — no
  concrete need identified yet; revisit once the real WorkDay export is
  inspected, consistent with the spec's existing "format not yet known"
  stance on `country`.
- Batch/bulk-insert performance tuning — correctly belongs to the future
  WorkDay Import spec, not this one; added an Out of Scope note instead of
  specifying it here.

**Reorganized:**

- Renumbered Feature 1's FRs (FR-1.1–FR-1.6) to insert the new
  active-employee (FR-1.2) and delete-behavior (FR-1.6) requirements in
  their logical place rather than appending them at the end.
- Added FR-4.3/FR-4.4 (mutation functions) directly after the existing
  FR-4.1/FR-4.2 (query functions) in Feature 4, keeping all data-access-layer
  function definitions together rather than scattering write behavior
  across Features 2/3.

**Not applied (follow-up outside this skill's scope):**

- Updating `specs/ARCHITECTURE.md`'s Tech Stack table to reflect the
  Node.js/TypeScript + better-sqlite3 decision — recommended as a separate,
  manual follow-up since `/spec-update` only modifies the spec file itself.

### Update from critique-consolidated-v-2.md

**Applied:**

- Closed the `upsertEmployee`/`manager_id` cycle-check bypass: `FR-4.3` now
  states `upsertEmployee`'s input type excludes `manager_id` entirely, so
  `reassignManager` (with its FR-1.4 cycle check) is the only way to set or
  change it, for both new hires and existing employees.
- Added a general not-found-vs-throw error contract (AR-4.4), without
  dictating a specific exception hierarchy (also added to Out of Scope for
  clarity).
- Fixed `FR-2.2`'s "current salary" definition to exclude future-dated
  `salary_history` rows (highest `effective_year` **not greater than the
  current calendar year**), resolving the contradiction with `FR-2.3`'s
  one-year-ahead allowance.
- Added ISO 8601 format validation for `start_date`/`end_date` to `FR-1.2`,
  alongside the existing ordering check.
- Extended the `includeInactive` filter to `getDescendants`/`getAncestors`
  (`FR-1.5`), matching `getAllEmployees`'s default.
- Specified ordering for `getAllEmployees` (by `id`) and
  `getSalaryHistory`/`getRatingHistory` (chronological, ascending by year) —
  and contrasted that with `getLastRatings`'s descending order (`FR-4.1`).
- Bounded `getLastRatings`'s `limit` parameter to positive integers
  (`FR-3.2`).
- Clarified that `currency` may legitimately change when
  `upsertSalaryRecord` updates an existing year's row (e.g. a genuine
  mid-year relocation) (`FR-4.3`).
- Reworded `AR-1.3` to match `AR-4.3`'s single-connection model (the
  pragma is set once, not "per new connection").
- Added a single-threaded-process assumption to `AR-4.3` and Constraints,
  and a POSIX-only caveat to `AR-4.2`'s file-permission requirement.

**Confirmed, no change needed:**

- `reassignManager(A, A)` (self-management): already rejected by `FR-1.4`'s
  existing "directly or transitively" wording: a direct self-reference is
  the "directly" case.
- Rollout & migration checklist item: correctly stays `[N/A]` — no prior
  draft of this spec has been implemented, so there is no deployed database
  under an older schema to migrate. Added a one-line note to the checklist
  making this reasoning explicit instead of leaving it a bare `[N/A]`.
- Country-name normalization and opaque rating-value format: both already
  documented as deferred, known risks in Constraints from the v1 update; no
  new gap.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately, per the v1 note above — unchanged by this update.

### Update from critique-consolidated-v-3.md

**Applied:**

- Defined "current calendar year" precisely — system clock, evaluated in
  UTC — in a new `AR-2.2`, cross-referenced from `FR-2.2`, `FR-2.3`, and
  `FR-3.3` instead of leaving the term undefined in three places.
- Extended `AR-4.4`'s error contract to cover collection-returning
  functions (empty array for both "no such employee" and "employee exists,
  nothing to show") and single-value history functions (`null`/empty when
  the employee exists but has no eligible row).
- Extended `FR-1.2`'s validation to reject empty/whitespace-only `name`,
  `position`, and `country`, matching the validation already applied to
  `currency` and `rating_value` elsewhere in the spec.
- Tightened `FR-1.2`'s date format to "ISO 8601 extended format
  (`YYYY-MM-DD`) only," ruling out basic format, week dates, and ordinal
  dates.
- Clarified `getAllEmployees`'s `id` ordering (`FR-4.1`) is lexicographic,
  not numeric, and added a deterministic `id`-based secondary sort for
  same-depth siblings in `getDescendants` (`FR-1.5`).
- Stated that `includeInactive: false` (`FR-1.5`) filters returned rows
  only — traversal still walks through inactive nodes to reach active
  descendants beyond them.
- Tightened `FR-2.3`/`FR-3.3`: year fields must be integers in an explicit
  inclusive range, `base_salary`/`bonus` must be finite numbers, and
  `bonus = 0` is explicitly confirmed valid.
- Specified `initDatabase`'s behavior for a missing parent directory
  (throws; doesn't create it) and for a second call in the same process
  (throws) (`FR-4.2`).
- Added an Integration Points note flagging that the future WorkDay Import
  spec owns deciding how to handle a batch import interrupted between an
  employee's `upsertEmployee` and `reassignManager` calls, since each is
  individually — but not jointly — transactional.
- Updated the Spec Completeness Checklist's Testing strategy, Architecture
  & interfaces, Error handling & failure modes, and Assumptions & risks
  notes to reflect all of the above.

**Rejected:**

- Prepared-statement caching guidance — an implementation detail (how to
  call `better-sqlite3`), not a behavioral requirement.
- Specific hierarchy depth/breadth limits (e.g. "~50 levels," "1000 direct
  reports") — would be unfounded, invented numbers; the existing open
  Performance checklist item already acknowledges scale is unknown pending
  real data, which is more honest than a fabricated bound.
- Schema-drift detection beyond `CREATE TABLE IF NOT EXISTS` — speculative
  machinery for a project with zero implementations and zero deployed
  databases; the v2 Rollout & Migration reasoning already covers why this
  isn't needed yet.
- Making `ORDER BY`/`LIMIT` parameters bound rather than string-interpolated
  — already satisfied: no ordering in this spec is user-selectable, and
  the one user-supplied numeric parameter (`getLastRatings`'s `limit`) is
  already required to be a validated, bound parameter under `AR-1.1`.
- Backup/restore guidance — reasonable operational advice, but not a
  schema/data-access-layer requirement; out of scope by the same logic as
  auth/authz.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately, per the v1/v2 notes above — unchanged by this update.

### Update from codex (gpt-5.6-terra) spec-review, 2026-08-31

Applying the 3 findings from a `/spec-review` re-run against the
post-v3 spec (no separate consolidated-critique file this round; findings
came directly from the review's Risks section).

**Applied:**

- Every write function taking an existing employee id
  (`reassignManager`, `upsertSalaryRecord`, `upsertRatingRecord`,
  `deleteEmployee`) now explicitly throws if that id doesn't correspond to
  an existing employee, instead of silently affecting zero rows and
  appearing to succeed; `reassignManager` also throws for a non-existent
  `newManagerId` (AR-4.4, with matching Verify additions on FR-4.3/FR-4.4).
- Fixed `FR-4.1`'s function signatures so they type-check as actually
  called elsewhere in the spec: `getAllEmployees`'s options object now has
  an explicit `= {}` default (so `getAllEmployees()` with zero arguments
  is valid, matching FR-1.2's own Verify line), and `getDescendants`/
  `getAncestors` now show the `includeInactive` options parameter in their
  signature at all (FR-1.5 described the behavior, but the FR-4.1 listing
  omitted the parameter entirely).
- Extended `FR-1.2`'s field validation to include `id` itself — previously
  every other identifying text field (`name`, `position`, `country`) was
  validated non-blank, but the primary key that all other tables reference
  was not. Added a matching Data Requirements table note and Verify case.
- Updated the checklist's Testing strategy, Architecture & interfaces, and
  Error handling & failure modes notes to reflect all of the above.

**Rejected:** none this round — all 3 findings were valid and cheap to
close.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately — unchanged by this update.

### Update from codex (gpt-5.6-terra) spec-review, round 2

Applying the 5 findings from a second `/spec-review` re-run. Two factual
claims in this round's findings were verified directly (not taken on
faith) before being applied: `node:sqlite`'s current stability
(confirmed via the Node.js docs: reached "release candidate" as of
Node.js 25.7, not merely "experimental") and `better-sqlite3`'s Node
version requirement (confirmed via the npm registry: `>=22`, current
version 13.x).

**Applied:**

- `getCurrentSalary`/`getLastRatings` (AR-4.4) now explicitly return
  `null`/empty for a nonexistent employee id too, not just for an
  existing employee with no eligible row — closing the one case the v4
  round's AR-4.4 extension had missed.
- Added a `closeDatabase()` function (FR-4.2) paired with `initDatabase`,
  and reworded `AR-4.3`'s connection lifecycle to describe open/close as
  an explicit pair (primarily for test teardown) rather than a
  one-way-only-per-process connection with no defined way to reset it.
- Added `AR-2.3`, a 2-decimal rounding rule for `base_salary`/`bonus` to
  bound floating-point representation error, with an explicit Constraints/
  Out-of-Scope note that this assumes 2-decimal-minor-unit currencies.
- Extended `AR-4.2` to cover SQLite sidecar files (`-wal`/`-shm`/
  `-journal`, which can copy sensitive data in WAL mode) and to state that
  `initDatabase` does not alter permissions on a pre-existing database
  file.
- Corrected `AR-1.1`'s driver comparison: `node:sqlite` is now a release
  candidate, not "experimental" — the choice of `better-sqlite3` still
  stands (maturity, feature set, ecosystem), but the stated reason was
  factually stale. Also added a verified Node.js version requirement
  (`>= 22`) to `AR-1.1` and Constraints.
- Updated the Testing strategy, Dependencies, Architecture & interfaces,
  Error handling & failure modes, Security review, and Assumptions & risks
  checklist notes to reflect all of the above.

**Rejected:** none this round.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately — unchanged by this update.

### Manual update, 2026-08-31: removed `start_date`

The Employee Details anniversary-lookup feature — the sole reason
`employees.start_date` existed — was dropped from scope after reviewing
the actual WorkDay report (`workday_docs_examples/`), which has no hire-date
field at all. Leaving `start_date` as a `NOT NULL` column with no data
source would have made every future import fail validation. This spec was
already `CLOSED - IMPLEMENTED` with a passing test suite when the decision
was made, so the removal was applied to both the spec and the shipped code
(`src/db/schema.ts`, `types.ts`, `queries.ts`, `mutations.ts`) plus the
five affected test files, not just this document.

**Applied:**

- Removed `start_date` from the `employees` table (Data Requirements),
  `FR-1.1`'s employee record definition, `FR-1.2`'s validation (the
  `end_date`-earlier-than-`start_date` check no longer applies; `end_date`
  format is still validated on its own), and `FR-4.3`'s `upsertEmployee`
  field list.
- Updated the Employee Details integration note to record that the
  anniversary lookup was dropped and that this is why no hire-date column
  exists.
- Removed the now-meaningless "`end_date` earlier than `start_date`" test
  case; repointed the malformed-calendar-date test at `end_date` (the only
  remaining date field) instead of `start_date`.

**Rejected:** none.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately — unchanged by this update.

### Manual update, 2026-08-31

No new critique/review file was supplied this round. Read the full spec
fresh looking for remaining gaps; found none — the last two `/spec-review`
rounds' fixes have closed everything substantive. Applied one
reorganization for clarity only.

**Applied:** none — no new requirements or clarifications were needed.

**Rejected:** none.

**Reorganized:**

- `AR-4.4` (error handling contract) had grown into a single dense
  paragraph across three prior rounds of additions, bundling five
  distinct rules (single-lookup, collection, single-value-history, write
  validation failures, write-against-nonexistent-id). Restructured it into
  a bulleted list, one rule per bullet, with no change in meaning —
  purely for readability, per this skill's "cut the noise" and "logical
  grouping" principles.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately — unchanged by this update.

### Update from codex (gpt-5.6-terra) spec-review, round 3

Applying the 2 findings from a third `/spec-review` re-run.

**Applied:**

- `upsertSalaryRecord`'s `bonus` parameter (FR-4.3) now has an explicit
  `= 0` default, matching FR-2.1's record-level "defaults to 0 if not
  provided" — previously the write-function signature required `bonus` as
  a plain positional argument, contradicting the schema-level default.
- `AR-4.2` now covers SQLite sidecar files (`-wal`/`-shm`/`-journal`)
  created or recreated *after* `initDatabase` returns (e.g. during normal
  write activity), not just ones present at initialization time.
  `initDatabase` achieves this via a restrictive process umask
  (equivalent to `0077`) set before opening the connection, rather than
  chmod'ing individual sidecar files after the fact — this covers every
  file SQLite creates for the life of the connection, including ones that
  didn't exist yet when `initDatabase` ran.
- Updated the Architecture & interfaces and Security review checklist
  notes to reflect both fixes.

**Rejected:** none this round.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately — unchanged by this update.

### Manual update, 2026-08-31: applied Spec 002's two prerequisites

Spec 002 (WorkDay Import Screen) named two changes this spec had to make
before spec 002 could be implemented (its AR-3.1 and AR-5.2): the real
WorkDay report has no year/date for performance ratings at all, only three
relative labels, and spec 002's reconciliation needs to wrap several of
this spec's write calls in one atomic transaction without reaching into
this spec's internals. This spec was already `CLOSED - IMPLEMENTED` with a
passing test suite, so — consistent with this project's precedent when
`start_date` was removed (2026-08-31, earlier this file) — both the spec
and the shipped code (`src/db/schema.ts`, `types.ts`, `queries.ts`,
`mutations.ts`, `connection.ts`, `index.ts`) plus the affected test files
were updated, not just this document.

**Applied:**

- **Replaced `rating_history.rating_year` (INTEGER) with `rating_period`
  (TEXT)** (FR-3.1), constrained at the database level to exactly
  `"Most Recent"`, `"Prior Rating"`, `"Two Year Prior Rating"` via a `CHECK`
  constraint, with the unique constraint moved to (`employee_id`,
  `rating_period`). Since the value set is closed at 3 periods, an employee
  can never have more than 3 rating rows — a stronger guarantee than the
  old unbounded-years design.
- **Redefined the ratings query** (FR-3.2, formerly "Last-N-ratings query")
  to return rows in the fixed period order (`"Most Recent"`,
  `"Prior Rating"`, `"Two Year Prior Rating"`) instead of sorting by a year
  that no longer exists. Noted that `getRatingHistory` and `getLastRatings`
  now return equivalent results by construction, since the table can never
  hold more than 3 rows per employee — both are kept for API-shape
  consistency with `salary_history`'s pair, not because they can diverge.
- **Rewrote rating field validation** (FR-3.3): `rating_period` must be
  exactly one of the three literal values (case-sensitive), replacing the
  old `[1990, current year + 1]` range check, which no longer applies to
  anything.
- **Added `deleteRatingRecord(employeeId, ratingPeriod)`** (FR-4.3): removes
  a specific rating row if one exists (a no-op, not an error, if it
  doesn't) — needed because ratings were previously upsert-only, so a
  period that ages out of the source report's rolling window could never
  be removed.
- **Added `runInTransaction<T>(fn: () => T): T`** (new FR-4.5): wraps a
  caller-supplied function in one transaction on the shared connection.
  `getConnection()` was never part of this spec's public API (AR-4.3
  clarified this explicitly), so spec 002 needed a supported way to get
  transactional atomicity across multiple write calls without reaching
  into this Feature's internals.
- **Added an old-schema startup guard** (FR-4.2): `CREATE TABLE IF NOT
  EXISTS` (AR-1.2) cannot alter an already-existing table, so
  `initDatabase` now checks `rating_history`'s actual columns via `PRAGMA
  table_info` and throws a clear "outdated schema" error if it finds the
  old `rating_year` column, rather than silently running against a
  mismatched table. This is a compatibility check, not a migration — this
  spec still has no migration framework (AR-1.2, Out of Scope).
- Updated Data Requirements, Integration Points, and Related Specs (added
  a table — spec 002 is the first spec to actually depend on this one) to
  reflect all of the above.
- Updated the Spec Completeness Checklist: Testing strategy, Architecture &
  interfaces, Error handling, Security, Rollout & migration (moved from
  `[N/A]` to `[x]` — this was the first real schema change), and
  Assumptions & risks.
- Applied the equivalent changes to the implementation: `schema.ts`'s
  `rating_history` table definition, `types.ts`'s `RatingRecord`/
  `RatingPeriod` types, `mutations.ts`'s `validateRatingRecord`/
  `upsertRatingRecord`/new `deleteRatingRecord`, `queries.ts`'s
  `getLastRatings`/`getRatingHistory` (fixed period order instead of a SQL
  `ORDER BY`), `connection.ts`'s new `runInTransaction` and old-schema
  check, `index.ts`'s exports, and the corresponding test files
  (`rating.test.ts`, `lifecycle.test.ts`).

**Rejected:** none.

**Not applied (follow-up outside this skill's scope):**

- Still recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table
  separately — unchanged by this update.
