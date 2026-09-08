# Data Schema & API Contract

The schema and public function signatures of `src/db/` (spec
[001-data-foundation](../../features/001-data-foundation/spec.md), updated
for spec [002-workday-import](../../features/002-workday-import/spec.md)'s
prerequisites, for spec
[005-headcount-manager-context](../../features/005-headcount-manager-context/spec.md)'s
`external_managers` table and `employees.external_manager_id` column, and for
spec [006-employee-details-and-headcount-refinements](../../features/006-employee-details-and-headcount-refinements/spec.md)'s
`salary_history.comp_ratio` column, and spec
[007-contractor-management](../../features/007-contractor-management/spec.md)'s
`employees.worker_type` discriminator, and spec
[012-contractor-lifecycle-table-and-manager-resolution](../../features/012-contractor-lifecycle-table-and-manager-resolution/spec.md)'s
contractor lifecycle simplification). Any feature reading or writing this data
should treat this as the stable contract — changing it is a breaking change for every downstream feature.

## Schema

```sql
-- Added 2026-08-31 for spec 005: holds a name for a supervisor id that never
-- resolves to a real employee row (the file scopes to one manager's org, so
-- that manager's own row is never in it) but whose name the raw file did
-- carry in a separate column. Deliberately not a row in `employees` — it
-- can't satisfy that table's NOT NULL position/country columns without
-- fabricating data the file never provided.
external_managers (
  id TEXT PRIMARY KEY,               -- the raw, otherwise-unresolvable supervisor id
  name TEXT NOT NULL                 -- non-empty after trimming
)

employees (
  id TEXT PRIMARY KEY,              -- non-empty after trimming
  name TEXT NOT NULL,                -- non-empty after trimming
  position TEXT NOT NULL,            -- non-empty after trimming
  country TEXT NOT NULL,             -- non-empty after trimming; raw source value, not a color bucket
  worker_type TEXT NOT NULL DEFAULT 'employee' CHECK (worker_type IN ('employee', 'contractor')),
  end_date TEXT,                     -- ISO 8601 extended date, or NULL if still employed
  manager_id TEXT REFERENCES employees(id) ON DELETE RESTRICT,
  -- Added 2026-08-31 for spec 005: a *separate* link from manager_id, set only
  -- when manager_id is null AND a name for the unresolved supervisor id was
  -- captured (see external_managers above). manager_id itself is never set to
  -- an id outside employees — its own FK forbids that; this column exists
  -- precisely because that FK can't be relaxed.
  external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL
)
-- index: employees(manager_id)
-- No hire-date column: the WorkDay source report has no hire-date field, and the
-- anniversary-lookup feature that would have used one was dropped from scope.

salary_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_year INTEGER NOT NULL,   -- integer, [1990, current UTC year + 1]
  currency TEXT NOT NULL,            -- 3-letter uppercase code
  base_salary REAL NOT NULL,         -- >= 0, finite, rounded to 2 decimals
  bonus REAL NOT NULL DEFAULT 0,     -- >= 0, finite, rounded to 2 decimals
  -- Added 2026-08-31 for spec 006, from the WorkDay export's optional "Base
  -- Pay Compa Ratio" column. Deliberately nullable and NOT part of the
  -- currency/base_salary/bonus "all present or all null" trio above: a row
  -- can have a real salary and a null comp ratio (blank cell on import, or
  -- an older export re-imported without the column). Not rounded on write,
  -- unlike base_salary/bonus, since it's a ratio, not a currency amount.
  comp_ratio REAL,                   -- >= 0, finite, when non-null
  UNIQUE (employee_id, effective_year)
)

rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  rating_period TEXT NOT NULL,       -- CHECK: one of 'Most Recent', 'Prior Rating', 'Two Year Prior Rating'
  rating_value TEXT NOT NULL,        -- non-empty after trimming, <= 200 characters
  UNIQUE (employee_id, rating_period)
)
-- Changed 2026-08-31 from an integer rating_year: the WorkDay source report has
-- no year or date for any rating, only these three relative labels. Because the
-- value set is closed at 3 periods, an employee can never have more than 3 rows.
```

Foreign keys are enforced (`PRAGMA foreign_keys = ON`). Deleting a manager
who still has direct reports fails (`ON DELETE RESTRICT`); deleting an
employee removes their salary/rating history (`ON DELETE CASCADE`).

`initDatabase` also checks, on every startup, that an already-existing
`rating_history` table has the current `rating_period` column rather than
the pre-2026-08-31 `rating_year` column — see Connection Lifecycle below.

## Read API (`src/db/queries.ts`)

| Function | Returns | Not-found behavior |
| --- | --- | --- |
| `getEmployeeById(id)` | `Employee \| null` | `null` |
| `getAllEmployees({ includeInactive?, workerType? })` | `Employee[]`, ordered by `id` ascending; `workerType` is `employee`, `contractor`, or `all` and defaults to `employee` | `[]` |
| `getDescendants(managerId, { includeInactive? })` | `Employee[]`, depth-ascending then `id`-ascending, excludes the starting employee | `[]` for an unknown id |
| `getAncestors(employeeId, { includeInactive? })` | `Employee[]`, nearest manager to most senior, excludes the starting employee | `[]` for an unknown id |
| `getCurrentSalary(employeeId)` | `SalaryRecord \| null` — highest `effective_year` not greater than the current UTC year | `null` for no eligible row or unknown employee (indistinguishable) |
| `getSalaryHistory(employeeId)` | `SalaryRecord[]`, ascending by year, unbounded | `[]` |
| `getLastRatings(employeeId, limit = 3)` | `RatingRecord[]`, in fixed period order (`Most Recent`, `Prior Rating`, `Two Year Prior Rating`), a missing period omitted; `limit` must be a positive integer | `[]` |
| `getRatingHistory(employeeId)` | `RatingRecord[]`, same fixed period order — equivalent to `getLastRatings(id, 3)` by construction, since the table can never hold more than 3 rows per employee | `[]` |
| `getAllExternalManagers()` | `ExternalManager[]` (`{ id, name }`), unfiltered — added for spec 005; the table stays small (bounded by the number of distinct unresolvable supervisor ids ever seen), so callers filter to "currently referenced" in application code rather than via a query parameter | `[]` |
| `getCurrentManagerOptions()` | `ContractorManagerOption[]` (`{ id, name, position, country, selectable }`), human-context ordered; active imported employees with active direct reports only. Exact duplicate human labels are returned as non-selectable. | `[]` |
| `getActiveContractors()` | Active contractor `Employee[]`, ordered by name then id | `[]` |

`includeInactive` defaults to `false` everywhere it appears, and filters
which rows are *returned* — traversal always walks the full graph, so an
active employee behind an inactive manager is still found.

## Write API (`src/db/mutations.ts`)

| Function | Behavior |
| --- | --- |
| `upsertEmployee(employee)` | Creates or updates `id`/`name`/`position`/`country`/`end_date`. Has no `manager_id` field — cannot touch it, on create or update. |
| `reassignManager(employeeId, newManagerId \| null)` | The *only* function that sets or changes `manager_id`. Rejects a direct or transitive cycle before writing. Throws `NotFoundError` if either id doesn't exist. |
| `upsertSalaryRecord(employeeId, effectiveYear, currency, baseSalary, bonus = 0, compRatio = null)` | Upserts one row per employee/year; `currency` may change between calls (e.g. relocation). `compRatio` (added for spec 006) validates only when non-null (finite, `>= 0`) and is stored unrounded. Throws `NotFoundError` if `employeeId` doesn't exist. |
| `upsertRatingRecord(employeeId, ratingPeriod, ratingValue)` | Upserts one row per employee/period. Throws `NotFoundError` if `employeeId` doesn't exist. |
| `deleteRatingRecord(employeeId, ratingPeriod)` | Removes the row for that employee/period if one exists — a no-op, not an error, if it doesn't. Throws `NotFoundError` if `employeeId` doesn't exist. Added for spec 002: a period that ages out of the source report's rolling window needs to be removable. |
| `deleteEmployee(employeeId)` | Throws `ConflictError` if the employee still has direct reports; otherwise deletes them and cascades their history. Throws `NotFoundError` if `employeeId` doesn't exist. |
| `upsertExternalManager(id, name)` | Added for spec 005. Insert-or-replace of `name` for one `external_managers` row — a later import's name for the same id fully replaces the earlier one, never merges. |
| `setExternalManager(employeeId, externalManagerId \| null)` | Added for spec 005. The *only* function that sets or changes `employees.external_manager_id`, mirroring `reassignManager`'s exclusive role for `manager_id`. Throws `NotFoundError` if `employeeId` doesn't exist, or if a non-null `externalManagerId` doesn't exist in `external_managers`. No cycle check — an external manager is never a real employee, so it can't participate in a `manager_id`-style cycle. |
| `createContractor({ name, position, country, managerId? })` | Creates a `contractor:<UUID>` row with an optional, current, unambiguous imported-employee manager. |
| `updateContractorDetails(id, { name, position, country })` | Atomically changes manual details without changing placement. Throws `NotFoundError` for a non-active/non-contractor row. |
| `setContractorManager(id, managerId \| null)` | Atomically assigns `No manager` or a current, unambiguous imported employee. |
| `deleteContractor(id)` | Permanently removes one active contractor and cascade-owned history; rejects imported, inactive, unknown, and already-deleted targets. |
| `runInTransaction(fn)` | Runs `fn` inside one transaction on the shared connection; commits its result or rolls back and rethrows if `fn` throws. Added for spec 002: the supported way to get atomicity across several calls to this module's functions — `getConnection()` itself is not public. |

Every write runs in a single `better-sqlite3` transaction — it fully
succeeds or writes nothing. `better-sqlite3` supports nesting transaction
functions (via savepoints), so calling this module's own functions from
inside a `runInTransaction(fn)` callback is safe.

## Connection Lifecycle (`src/db/connection.ts`)

- `initDatabase(path)` opens or creates the SQLite file, enables foreign
  keys, runs schema init, and then checks `rating_history`'s actual columns
  (`PRAGMA table_info`) — throwing `InitializationError` if it finds the old
  `rating_year` column, since `CREATE TABLE IF NOT EXISTS` leaves an
  already-existing table untouched and can't upgrade it. Also throws if a
  connection is already open, or if `path`'s parent directory doesn't exist.
  Sets a restrictive process umask (POSIX only) for as long as the
  connection is open, so the main file and any `-wal`/`-shm`/`-journal`
  sidecar files it creates are owner-only — pre-existing files are left
  untouched.
- Added 2026-08-31 for spec 005: `initDatabase` also runs a guarded
  `ALTER TABLE employees ADD COLUMN external_manager_id ...` step right after
  schema init, checking `PRAGMA table_info(employees)` first so it's a no-op
  once the column exists. This is a genuinely different case from the
  `rating_period` check above — that one *rejects* an incompatible existing
  table (the fix is a full rebuild via reimport); this one *adds* a brand-new,
  nullable, purely additive column to a table whose existing data (including
  years of `salary_history`/`rating_history`) stays completely untouched, so
  rejection would be strictly worse than upgrading in place. Confirmed
  directly against SQLite as bundled by `better-sqlite3`: `ALTER TABLE ADD
  COLUMN` with an inline `REFERENCES ... ON DELETE SET NULL` clause is
  supported and the FK is fully enforced afterward — no fallback to a
  plain-`TEXT`, unenforced-FK column was needed. See spec 005's `ADR.md`
  (ADR-001) for the full decision record.
- Added 2026-08-31 for spec 006: `initDatabase` runs a second guarded
  `ALTER TABLE salary_history ADD COLUMN comp_ratio REAL` step, following the
  identical `PRAGMA table_info(salary_history)`-guarded, purely-additive
  pattern above — a pre-existing database gains the nullable column with no
  effect on its existing `salary_history` rows (their `comp_ratio` simply
  reads as `NULL` until a subsequent import populates it; this project does
  not backfill it retroactively).
- Added 2026-09-03 for spec 007: `initDatabase` also runs a guarded
  `ALTER TABLE employees ADD COLUMN worker_type TEXT NOT NULL DEFAULT
  'employee' CHECK (...)` step. Existing rows therefore retain their identity
  and read as imported employees; only `createContractor` writes the
  `contractor` value. The `PRAGMA table_info(employees)` guard leaves a fresh
  or previously migrated database unchanged.
- Added 2026-09-07 for spec 012: `initDatabase` idempotently rebuilds a legacy
  `employees` table that contains contractor WorkDay-link columns. The single
  transaction removes `workday_worker_id` and `latest_import_matched`, retains
  employee and contractor manual data plus employee-manager relationships,
  clears contractor external-manager links, recreates the manager index, and
  checks foreign-key integrity before committing.
- `closeDatabase()` closes the connection and restores the prior umask.
  Safe to call even if nothing is open.
- `runInTransaction(fn)` — see Write API above.

## Known Constraints (see spec for full detail)

- No currency conversion — values are stored and returned exactly as given.
- One salary snapshot per employee per calendar year, not an intra-year
  change log. Ratings are keyed by a fixed 3-value period label instead of a
  year, since the source has no date for them.
- No migration framework — `CREATE TABLE IF NOT EXISTS` for new tables, the
  `rating_period` compatibility check, and (as of spec 005) one guarded
  `ALTER TABLE ADD COLUMN` step are the full extent of schema-change handling.
  A future additive column can follow the same guarded-`ALTER TABLE` pattern;
  a future *incompatible* change to an existing column should follow the
  `rating_period` reject-and-require-reimport pattern instead — the choice
  depends on whether old data can be preserved (`ADD COLUMN`) or not (reject).
- Single-threaded Node.js process (22+) — not safe to share across worker
  threads.
- `employees.id`'s expected format (numeric string, UUID, etc.) is not yet
  constrained — the real WorkDay export format wasn't known when this spec
  was written.
