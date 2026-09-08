# Architectural Decision Records: 005-headcount-manager-context

## ADR-001: Migrating a pre-existing `employees` table to add `external_manager_id`

- **Date:** 2026-08-31
- **Status:** Accepted
- **Context:** AR-2.1 adds a new nullable column, `employees.external_manager_id`, with a
  foreign key to a new `external_managers` table. `src/db/connection.ts`'s `initDatabase()`
  runs `db.exec(SCHEMA_SQL)` on every connection open, and `SCHEMA_SQL` uses
  `CREATE TABLE IF NOT EXISTS` throughout (AR-1.2/AR-1.3 of spec 001). That statement is a
  no-op for a table that already exists, so a real, pre-existing `data/employees.sqlite`
  file — gitignored, holding potentially years of imported salary/rating history — would
  never gain the new column just by re-running `SCHEMA_SQL`. Every write that later tries to
  set `external_manager_id` on such a database would fail with "no such column". This
  codebase has never added a column to an already-existing table before; the one existing
  precedent, `assertCompatibleSchema()` in `connection.ts`, handles the *different* case of
  an existing column being in the *wrong* shape (`rating_year` vs. `rating_period`) by
  rejecting the database outright and requiring a fresh file. That rejection pattern doesn't
  fit here: a *missing new* column is not a corrupt or incompatible database, and rejecting
  it would force every existing user to throw away their historical data for a purely
  additive change.
- **Decision:** Added a new guarded step, `migrateExternalManagerColumn(db)`, that runs
  immediately after `db.exec(SCHEMA_SQL)` (and after `assertCompatibleSchema`) inside
  `initDatabase()`. It checks `PRAGMA table_info(employees)` for a column named
  `external_manager_id`; if absent, it runs:

  ```sql
  ALTER TABLE employees ADD COLUMN external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL
  ```

  This was verified against a real temp-file SQLite database (created via `better-sqlite3`,
  matching the bundled SQLite 3.53.4): the inline `REFERENCES ... ON DELETE SET NULL` clause
  on `ALTER TABLE ... ADD COLUMN` **succeeded**, added the column with `NULL` for every
  existing row, left existing rows and the `manager_id` column completely untouched, and the
  resulting FK was fully enforced — an `UPDATE` setting `external_manager_id` to a
  non-existent `external_managers.id` failed with `FOREIGN KEY constraint failed`, and
  deleting the referenced `external_managers` row correctly set the column back to `NULL`
  (`ON DELETE SET NULL`) on the referencing row. Because this variant worked, the plain-`TEXT`
  fallback (no inline FK clause) described as a contingency was **not needed** and is not
  used — FK enforcement for `external_manager_id` applies uniformly to both freshly-created
  and ALTER-migrated databases.

  The check-then-`ALTER` guard makes the step idempotent: a database that already has the
  column (freshly created via `SCHEMA_SQL`'s `CREATE TABLE`, or already migrated on a prior
  `npm start`) is left alone on every subsequent call, so running it twice, or on every
  `npm start`, is safe.
- **Rationale:** This is additive and non-destructive by construction — it does not touch
  existing rows, `manager_id` (and its existing `ON DELETE RESTRICT` FK), or any
  salary/rating history table, and requires no re-import. It runs automatically inside
  `initDatabase()`, so there is no separate manual migration step for users to remember: the
  column simply appears the next time `npm start` opens the database. Testing the real
  behavior first (rather than assuming the fallback would be needed) avoided adding
  unnecessary complexity — the modern SQLite bundled with `better-sqlite3` fully supports an
  `ALTER TABLE ADD COLUMN` with an inline `REFERENCES` clause, since the new column has no
  non-constant default.
- **Consequences:** A new database and an ALTER-migrated database end up in the identical
  final shape, with identical FK enforcement — there is no reduced-guarantee fallback path to
  document or reason about. The migration step adds one `PRAGMA table_info` query and, at
  most once per database file, one `ALTER TABLE` statement to every `initDatabase()` call,
  which is negligible overhead. As with the rest of this codebase's schema evolution
  strategy (no migration framework, per spec 001's Constraints), this is a narrowly-scoped,
  hand-written, idempotent guard rather than a general migration mechanism — a future column
  addition to an existing table would need its own similarly-guarded step, not a reusable
  abstraction, unless a third such case arises and justifies extracting one.
