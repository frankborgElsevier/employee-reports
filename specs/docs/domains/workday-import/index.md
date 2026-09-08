# WorkDay Import

The app's first running process: a local web server and browser screen
that lets a user upload the WorkDay "Team Market Range Analysis for
Managers" `.xlsx` export and reconcile it against the
[Data Foundation](../data-foundation/index.md) database.

Implemented by [spec 002-workday-import](../../../features/002-workday-import/spec.md).

## Running It

`npm start` (`src/server/start.ts`) creates `data/` and `data/tmp-uploads/`
if missing, sweeps any temp upload left over from a crashed prior run,
bootstraps `data/employees.sqlite` via `initDatabase`, and starts an
Express server bound to `http://127.0.0.1:3200` — then opens the user's default
browser to it (the `open` package). The fixed port keeps bookmarks and direct
screen URLs stable; another local process must not already be using port 3200.
The root URL is a data-aware landing route: it redirects to Headcount when at
least one active employee or contractor exists, and to this Import screen when
the database has no active people. The Import navigation link is always
`/index.html`, so it remains available after data has been loaded.

## The Two-Step Import Flow

Uploading a file never writes to the database directly. Instead:

1. **`POST /api/preview`** (`src/server/app.ts`) — parses and reconciles the
   file inside a database transaction that is *always* rolled back,
   regardless of whether the reconciliation would succeed. If it would
   succeed, the server retains the uploaded file and returns a short-lived
   token plus added/updated/inactivated employee counts. If it would fail, it
   returns the specific error and no token — there's nothing to confirm.
2. **`POST /api/confirm`** (referencing that token) — re-runs the identical
   reconciliation against the retained file and this time lets the
   transaction commit.

This exists specifically so an accidental wrong-file upload is visible
*before* it changes anything — see
[standards/import-http-api.md](../../standards/import-http-api.md) for the
full request/response contract.

## The Reconciliation Pipeline (`src/import/`)

| File | Responsibility |
| --- | --- |
| `mapping.ts` | Required column headers and the rating-column-to-period map |
| `parseWorkbook.ts` | Opens the `.xlsx` (ExcelJS), validates headers, maps each row into a typed, validated `ImportRow` — including the optional `Direct Supervisor Name` column (spec 005; see below) |
| `reconcile.ts` | The actual database reconciliation — upsert, manager reassignment, external-manager name capture and linking, salary/rating writes, soft-inactivation |
| `types.ts` | `ImportRow`, `ReconciliationCounts` |
| `errors.ts` | `WorkbookStructureError` (can't even attempt a preview), `LimitExceededError` (size/row/entry caps), `RowValidationError` (one row's content is invalid) |

`reconcile()` processes every workbook row as an imported employee row.
Contractors have no WorkDay identity and are untouched by preview and confirmed
imports. `reconcile()` always runs the same sequence, inside one
`runInTransaction` call from the data-access layer: upsert every employee
present in the file; resolve and aggregate external-manager names (below);
reassign managers (resolving each `Direct Supervisor ID` against existing
employees *before* ever calling `reassignManager`, since that function
throws on an unresolved id) and, for a row that stays unresolved, link its
external-manager reference; write salary and rating rows; then
soft-inactivate every currently-active employee absent from the file.
Whether that transaction commits or rolls back is the *only* difference
between a preview and a confirmed import — there is no separate "preview
mode" in the reconciliation logic itself.

**Departure is inferred from absence, not deleted.** An employee missing
from the file gets `end_date` set (once — an already-inactive employee's
`end_date` is never overwritten by a later import that still excludes
them), never `deleteEmployee`. This assumes the database holds one
manager's team at a time; an earlier design that tried to safely mix
multiple teams by inferring team boundaries from the manager hierarchy
turned out not to work (an external supervisor id is never actually
written as anyone's `manager_id`, so it can't be used to find their
reports) and was removed — see spec 002's Change Log. That specific
limitation still holds — `manager_id`'s own foreign key still forbids an
external id — but spec 005 added a *second*, separate link column
(`external_manager_id`) precisely because of it; see below.

## Capturing External Manager Names (spec 005)

A file scoped to one manager's org never contains that manager's own row —
only their `Direct Supervisor ID`, on their reports' rows, which never
resolves against `employees`. If the file also carries that supervisor's
*name* (the optional `Direct Supervisor Name` column, detected the same way
as any other header — absence just means every row's captured name is
`null`, and the import proceeds exactly as it always has), `reconcile()`:

1. Groups every row with the same unresolved supervisor id, picks whichever
   name occurs most often for that id (ties broken by `localeCompare` on the
   full trimmed string), and upserts exactly one `external_managers` row per
   distinct id — never one write per row.
2. Links each of that id's reports via `setExternalManager`, leaving
   `manager_id` `null` exactly as before.
3. Self-heals for free: if that same id resolves to a real employee in a
   later import (they were added to the file, or their own row appears),
   `setExternalManager(..., null)` clears the stale link on that row and
   `reassignManager` links to the real employee normally — no explicit
   cleanup step is needed.

See [domains/headcount-dashboard/index.md](../headcount-dashboard/index.md#external-manager-placeholders-spec-005)
for how this renders, and
[standards/data-schema.md](../../standards/data-schema.md) for the
`external_managers` table and `external_manager_id` column.

## Upload Safety (`src/server/`)

| File | Responsibility |
| --- | --- |
| `app.ts` | Express app: routes, Multer upload config, the `Origin`-header check, error-to-HTTP-status mapping |
| `zipPreflight.ts` | Inspects the upload's ZIP central directory (`yauzl`) — entry sizes and count — *before* ExcelJS ever opens the file, since ExcelJS's buffer-based API decompresses everything up front with no hook to check size first |
| `previewStore.ts` | The single pending-import guard and its short-lived confirmation token |

Only one import can be in flight at a time (server-process-global, not
per-database) — a second upload while one is pending gets `409`, and an
unconfirmed preview's token expires after 5 minutes, releasing the guard
and deleting the retained file.
