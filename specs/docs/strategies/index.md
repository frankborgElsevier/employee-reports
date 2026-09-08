# Strategies

Change-over-time guidance: rollout, rollback, migrations, release flow,
deprecation, scaling.

## Schema Evolution

`src/db/schema.ts` uses idempotent `CREATE TABLE IF NOT EXISTS` statements
run on every `initDatabase` call, not a migration framework — `CREATE TABLE
IF NOT EXISTS` leaves an already-existing table untouched rather than
altering it.

The schema changed for the first time on 2026-08-31: `rating_history`'s
`rating_year` (INTEGER) became `rating_period` (TEXT), driven by spec
[002-workday-import](../features/002-workday-import/spec.md) discovering
the real WorkDay source has no date for ratings at all. No deployed
database predated the change, so there was nothing to migrate — but
`initDatabase` still gained a startup compatibility check (`PRAGMA
table_info` on `rating_history`) that throws if it finds the old column,
rather than silently running against a mismatched table. See
[001-data-foundation](../features/001-data-foundation/spec.md)'s
Change Log (2026-08-31) for the full rationale, and
[standards/data-schema.md](../standards/data-schema.md) for the current
schema.

The schema changed again on 2026-08-31 for spec
[005-headcount-manager-context](../features/005-headcount-manager-context/spec.md),
adding a new `external_managers` table and a new nullable
`employees.external_manager_id` column — and this time a real, pre-existing
`data/employees.sqlite` *did* need to keep working. Two different patterns
now coexist, chosen by whether the change can preserve existing data:

- **Incompatible change to an existing column** (the `rating_period` case
  above): add a startup compatibility check that *rejects* an old-shaped
  table (`InitializationError`), and require reimport. Appropriate when the
  old column's data can't be losslessly reinterpreted as the new shape.
- **Additive, nullable new column** (spec 005's case): add a guarded
  `ALTER TABLE ... ADD COLUMN` step at startup (checking `PRAGMA table_info`
  first, so it's a no-op once the column exists) instead of a rejection
  check. Confirmed working with an inline `REFERENCES ... ON DELETE SET NULL`
  clause against the SQLite version bundled with `better-sqlite3` — existing
  rows, and every other table's data, are left untouched. Appropriate
  whenever the new column has no bearing on interpreting old rows, so there's
  nothing to lose by upgrading in place. See spec 005's `ADR.md` (ADR-001)
  for the full decision record and the specific SQLite behavior confirmed.

A schema change to an already-defined table always needs its own explicit
handling in `initDatabase` — pick whichever of the two patterns above fits,
rather than relying on an updated `CREATE TABLE` statement alone (that
statement only ever helps a *brand-new* database).

Spec [010-contractor-reimport-and-headcount-simplification](../../features/010-contractor-reimport-and-headcount-simplification/spec.md)
uses the additive pattern for contractor import-link fields and a partial
unique index. The fields are nullable/defaulted so current local databases
remain usable; the index is created idempotently after the columns exist.

## Scaling `getAllEmployees`

`getAllEmployees` (`src/db/queries.ts`) returns the full active-employee set
with no pagination. This is expected to comfortably handle typical company
headcounts (hundreds to low thousands of rows) given
`better-sqlite3`'s synchronous model, but the actual threshold is unknown
until real WorkDay data establishes a headcount scale — see spec 001's
Spec Completeness Checklist (Performance impact).
