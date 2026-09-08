# Data Access Layer Convention

Established by `src/db/` (spec
[001-data-foundation](../../features/001-data-foundation/spec.md)), the
first module in the repository. Future data-backed features should follow
this pattern rather than introducing a new one.

A module with no schema or SQL of its own — like `src/import/` (spec
[002-workday-import](../../features/002-workday-import/spec.md)), which
only calls into `src/db/`'s public functions — doesn't need the
`schema.ts`/`connection.ts`/`queries.ts`/`mutations.ts` split. It keeps the
parts of this convention that still apply (`types.ts`, `errors.ts` with one
small class per failure category) and replaces the SQL-facing files with
whatever its own responsibilities actually are (for `src/import/`:
`mapping.ts`, `parseWorkbook.ts`, `reconcile.ts`).

## Module Layout

One file per responsibility, not one file per table:

- `schema.ts` — SQL DDL only (as a template string, run via `db.exec`)
- `connection.ts` — lifecycle (open/close), not queries or writes
- `queries.ts` — all read functions
- `mutations.ts` — all write functions, with their field validation inline
- `validation.ts` — small, pure, reusable validators — no SQL
- `types.ts` — plain interfaces for the module's public shapes
- `errors.ts` — one small class per error category
- `index.ts` — the only file other code should import from (barrel export)

## Error Handling

Small custom `Error` subclasses (`NotFoundError`, `ValidationError`,
`CycleError`, `ConflictError`, `InitializationError` in `src/db/errors.ts`),
not a single generic `Error`. The convention distinguishes "not found" from
"reject the write" by return value, not exception type:

- A function that looks up one entity by id returns `null` when nothing
  matches, rather than throwing.
- A function that returns a collection returns an empty array for both "no
  such parent id" and "parent exists, nothing matched" — these are treated
  as the same case; a caller that needs to tell them apart looks up the
  parent explicitly first.
- A write that fails validation, an integrity check, or targets a
  nonexistent id throws.

For a compound lifecycle action, keep its invariants and its writes in the
same mutation transaction. For example, contractor manager selection verifies
that the imported employee is active, manages an active report, and has an
unambiguous human-readable identity before changing the contractor row.

## Query Patterns

- SQL is written by hand with `better-sqlite3` prepared statements — no ORM.
  Every caller-supplied value is a bound parameter (`?` or `@name`); no SQL
  string ever interpolates a caller-controlled value directly.
- Optional query filters use an options-object parameter with an object-level
  default (e.g. `function getAllEmployees(options: { includeInactive?:
  boolean } = {})`), not a positional boolean — and the object-level default
  matters: without it, calling the function with zero arguments would fail to
  type-check even though the inner property is optional.
- Upsert-style writes use `INSERT ... ON CONFLICT(...) DO UPDATE`, not a
  separate exists-check-then-insert-or-update branch.
- A write function that operates on an existing entity by id (not creating a
  new one) explicitly checks the id exists first and throws `NotFoundError`
  if not — an `UPDATE`/`DELETE` that matches zero rows must never look
  identical to one that succeeded.

## Testing

- Node's built-in test runner (`node:test`) via the `tsx` loader — no
  separate test framework dependency.
- One test file per feature area under `test/db/` (e.g. `employees.test.ts`,
  `hierarchy.test.ts`), not one file per source file.
- Each test opens a fresh temp-file SQLite database (see
  `test/db/helpers.ts:withFreshDatabase`) rather than sharing state across
  tests or using `:memory:` — this exercises the real file-lifecycle code
  paths (permissions, directory checks) that an in-memory database would
  skip.
- Test names cite the requirement they verify (e.g. `"FR-1.4: a direct
  self-reference is rejected"`), so a failing test points straight back to
  the spec requirement it covers.
