# Data Foundation

The SQLite schema and TypeScript data-access layer backing the WorkDay
reporting dashboard app: employees, their org hierarchy (line-manager
relationships), salary history, and performance rating history. It is the
first module in the codebase and the shared foundation every planned screen
(Headcount Dashboard, Employee Details) and the future WorkDay Import
feature will read and write through.

Implemented by [spec 001-data-foundation](../../../features/001-data-foundation/spec.md),
extended by spec [005-headcount-manager-context](../../../features/005-headcount-manager-context/spec.md)
with the `external_managers` table and `employees.external_manager_id` column.

## What It Stores

Four tables, defined in `src/db/schema.ts`:

- **`employees`** — one row per employee: `id` (the WorkDay employee id, the
  primary key other tables reference), `name`, `position`, `country`
  (raw value from the source, not a presentation color bucket), `end_date`
  (`NULL` means still employed), `manager_id` (nullable, self-referencing —
  `NULL` means the employee is a hierarchy root), and `external_manager_id`
  (nullable, references `external_managers` — set only when `manager_id` is
  null and a name for the unresolved supervisor id was captured; see below).
  There is no hire-date column: the WorkDay source report has no hire-date
  field.
- **`external_managers`** — one row per unresolvable supervisor id whose name
  the raw file did carry (added for spec 005): `id` (the raw supervisor id,
  never a real `employees.id`), `name`. Not a row in `employees` — it can't
  satisfy that table's `NOT NULL` position/country without fabricating data.
- **`salary_history`** — one row per employee per calendar year:
  `employee_id`, `effective_year`, `currency`, `base_salary`, `bonus`.
  Salary is a yearly snapshot, not an intra-year change log — a mid-year
  raise overwrites that year's row.
- **`rating_history`** — one row per employee per rating period:
  `employee_id`, `rating_period` (one of `Most Recent`, `Prior Rating`,
  `Two Year Prior Rating` — the source report has no date for ratings, only
  these three relative labels), `rating_value` (opaque text; the real
  WorkDay rating scale isn't known yet).

An employee's org position is derived from `manager_id`, not a separate
table — ancestors/descendants are computed with a recursive SQL query at
read time (see below).

## The Module

`src/db/` (barrel-exported from `src/db/index.ts`):

| File | Responsibility |
| --- | --- |
| `schema.ts` | Table/index/foreign-key DDL |
| `connection.ts` | `initDatabase`/`closeDatabase` — connection lifecycle, file permissions |
| `queries.ts` | All read functions |
| `mutations.ts` | All write functions, including field validation |
| `validation.ts` | Shared validators (dates, currency codes, year ranges, rounding) |
| `types.ts` | `Employee`, `SalaryRecord`, `RatingRecord`, etc. |
| `errors.ts` | `NotFoundError`, `ValidationError`, `CycleError`, `ConflictError`, `InitializationError` |

See [conventions/data-access-layer.md](../../conventions/data-access-layer.md)
for the pattern this module establishes, and
[standards/data-schema.md](../../standards/data-schema.md) for the exact
schema and function-signature contract.

## Key Behaviors Worth Knowing

- **Active vs. inactive employees:** an employee is active when `end_date IS
  NULL`. `getAllEmployees` and the org-hierarchy traversal functions default
  to active-only, with an `includeInactive` option to see everyone.
- **Org hierarchy traversal filters what's *returned*, not what's
  *traversed*:** an inactive manager doesn't hide their still-active reports
  from `getDescendants`/`getAncestors` — it only affects whether the inactive
  manager themselves shows up in the result.
- **Manager assignment is separated from employee creation/update:**
  `upsertEmployee` cannot set or change `manager_id` at all — only
  `reassignManager` can, and it rejects any change that would create a
  cycle (direct or transitive) before writing anything.
- **"Current salary" and "current calendar year"** are defined precisely:
  the salary row with the highest `effective_year` not greater than the
  current UTC calendar year — so a salary row dated a year in the future
  (a planned raise) doesn't become "current" before its year arrives.
- **The schema has changed twice already, in production terms, via two
  different mechanisms:** `initDatabase` checks for the pre-2026-08-31
  `rating_history` shape and refuses to open a database built under it
  (an incompatible change — no way to preserve old rows, so reimport is
  required), and, since spec 005, also runs a guarded `ALTER TABLE employees
  ADD COLUMN external_manager_id ...` (an additive, nullable change — safe to
  apply in place, so an existing database's employees/salary/rating history
  is preserved rather than requiring reimport). `CREATE TABLE IF NOT EXISTS`
  alone can do neither; this module still has no general migration framework,
  just these two narrow, deliberate exceptions. See
  [strategies/index.md](../../strategies/index.md#schema-evolution).
- **`upsertExternalManager`/`setExternalManager`** (spec 005) follow the same
  separation-of-concerns precedent as `upsertEmployee`/`reassignManager`:
  only `setExternalManager` may write `external_manager_id`, and it enforces
  that a non-null value actually names an existing `external_managers` row.

This module is also the sole target of spec
[002-workday-import](../../../features/002-workday-import/spec.md)'s
reconciliation logic — see
[domains/workday-import/index.md](../workday-import/index.md).
