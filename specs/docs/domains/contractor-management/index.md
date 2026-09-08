# Contractor Management

The Contractors screen (`/contractors.html`) manages people who do not appear
in a WorkDay export. Contractors are manual records: an import cannot create,
overwrite, inactivate, match, review, or consume them.

## Workflow

The page has an add form and an active-contractor table, ordered by contractor
name then generated ID. The table shows name, position, country, line manager,
and `Edit`, `Set line manager`, and `Delete` actions. An empty roster has an
explicit empty state.

Adding or editing collects only name, position, and country. `Set line
manager` offers `No manager` or an eligible imported employee. A manager is
shown by name; duplicate names gain position and country context. The UI never
shows or asks for a WorkDay ID or another opaque identifier. If two eligible
managers still have the same human-readable context, neither is selectable;
the page directs the user to import corrected people data instead of guessing.

The browser retains the selected opaque manager reference only to submit the
chosen option. The server rechecks eligibility and unambiguous identity at
write time. A previously saved manager that has since become ineligible remains
visible as a disabled current value; it cannot be cleared accidentally or
selected again. Deletion
requires confirmation, permanently removes only the active contractor, and
cascades only that contractor's owned history.

## Data and Import Boundary

Contractors are `employees` rows with `worker_type = 'contractor'`, a generated
`contractor:<UUID>` ID, manual name/position/country, and an optional
`manager_id` pointing only to an imported employee. They have no WorkDay ID,
match state, or import-review state. External-manager placeholders cannot be
contractor managers. Migration clears legacy contractor external-manager links
to `No manager` while preserving the placeholder records and imported employee
relationships.

The workbook's Employee ID and Direct Supervisor ID remain imported-employee
identity and reporting data. The import owns those relationships and never
uses them to modify contractors.

Contractors appear in both reporting screens: Headcount renders their
lavender/purple card and Employee Details shows worker type `Contractor` with
unavailable imported compensation and ratings represented as `—`.

## Code Layout

| Path | Purpose |
| --- | --- |
| `public/contractors.html` | Add form, table, action dialogs, and DOM wiring |
| `public/contractorLogic.js` | Testable request/response and manager-label helpers |
| `src/server/app.ts` | Form options plus create, detail, manager, and delete routes |
| `src/db/mutations.ts` | Atomic lifecycle operations and manager eligibility validation |
| `test/db/contractors.test.ts` | Manager eligibility, removal, and migration coverage |
| `test/import/reconcile.test.ts` | Contractor preservation through preview and confirmed imports |
| `test/server/contractors.test.ts` | HTTP lifecycle contract |

## Related Spec

Implemented and closed on 2026-09-07 by [spec 012-contractor-lifecycle-table-and-manager-resolution](../../../features/012-contractor-lifecycle-table-and-manager-resolution/spec.md),
which supersedes contractor WorkDay-link behavior from specs 010 and 011.
