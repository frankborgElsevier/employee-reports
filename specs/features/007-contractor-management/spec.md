# Spec 007: Manual Contractor Management

> **Status: REOPENED - CHANGE REQUESTED** - Manager eligibility update added on 2026-09-04.
> Prior implementation summary: `specs/features/007-contractor-management/implementation-summary.md`
> Prior implementation review: `specs/features/007-contractor-management/implementation-review.md`

## Summary

Add a small Contractors screen where a user can manually create a contractor
who is absent from WorkDay. Contractors persist independently of WorkDay
imports, appear as clearly labelled purple cards in the Headcount Dashboard,
and appear in Employee Details with only the fields available for them.

## Problem

The application currently treats the WorkDay import as the only source of
people on either data screen. Contractors therefore cannot be represented in
the reporting chart or employee list, and adding one by pretending they came
from WorkDay would make later imports inactivate them. Contractors also lack
the compensation and performance data supplied by WorkDay, so Employee Details
must represent those unavailable values honestly.

## Goals

- Let a user add a contractor through the browser without a WorkDay row.
- Keep a manually entered contractor across every WorkDay preview and import.
- Show contractors in the Headcount Dashboard's org chart with an unambiguous,
  accessible visual distinction from employees.
- Show contractors in Employee Details with their identity and position data,
  clearly identified as contractors and without fabricated WorkDay data.

## Non-goals

- Editing, ending, deleting, or bulk-uploading contractors.
- Contractor salary, bonus, compa ratio, performance ratings, or historical
  records.
- Making a contractor a line manager or allowing a contractor to report to
  another contractor.
- Changing WorkDay file parsing or adding contractors to WorkDay import counts.
- Authentication or multi-user permissions; this retains the local,
  single-user model.

## Product Decisions

- The new screen is **Contractors** at `/contractors.html`; its only v1 action
  is an **Add contractor** form.
- Required fields are name, position, and country. The user may optionally
  select one current manager as the contractor's line manager; leaving it blank
  makes the contractor a root card. A current manager is either an active
  imported employee with an active direct report or an external-manager record
  referenced by an active worker. This includes a manager such as Frank Borg
  who is not present in the spreadsheet.
- The system generates an id in the reserved `contractor:<UUID>` namespace.
  The user is not asked to invent an ID that could collide with a WorkDay
  worker id.
- Contractors are shown in the Headcount Dashboard and included in its total
  and position breakdown, because this screen represents the organisation a
  manager can see. The UI must call this out as **Total people** rather than
  silently treating contractor count as employee headcount.
- **Lavender/purple** is the new contractor card colour: background `#e8def8`
  with text `#1a1a1a` (well above WCAG AA contrast for normal text). Every such
  card also displays the text `Contractor`; colour is never the sole signal.

## Implementation Status

| Slice | Status | Tech Plan | Tests | Completed Date | Notes |
|---|---|---|---|---|---|
| Phase A - Data model and API | complete |  | DB, import, and server tests | 2026-09-03 | Additive worker-type migration and import isolation covered. |
| Phase B - Contractor entry screen | complete |  | Browser-logic and server tests | 2026-09-03 | Manual creation form and routes shipped. |
| Phase C - Dashboard and Employee Details presentation | complete |  | Dashboard, Employee Details, and server tests | 2026-09-03 | Combined roster presentation shipped. |
| Phase D - Current-manager selection | complete |  | DB, server, and browser-logic tests | 2026-09-04 | Restricts choices and supports referenced external managers. |

## ASCII Screen Designs

These are layout and content guides, not pixel-perfect visual designs. They
reuse the existing simple, wide single-column page style and shared navigation.

### Contractors — initial state

```
+------------------------------------------------------------------------+
| Import    Headcount    Employee Details    Contractors                 |
|                                           ^ current page               |
+------------------------------------------------------------------------+

Contractors

Add people who do not appear in WorkDay. They appear on Headcount and in
Employee Details; WorkDay-only values are shown as unavailable.

  Name *
  [_______________________________________________________________]

  Position *
  [ Select a position                                       v    ]
    Options: distinct active roster positions, alphabetical

  Country *
  [_______________________________________________________________]

  Line manager (optional)
  [ No manager                                               v    ]
    Options: people currently managing an active team, including external managers

  [ Add contractor ]

  * Required fields
```

The manager select begins with `No manager`, followed by current managers
ordered by name then id. Imported employee and external-manager choices are
visibly distinguished. Individual contributors, inactive employees,
contractors, and unreferenced external-manager records are not selectable.

### Contractors — success and validation states

```
Success
-------
  Contractor "Sam Taylor" added. View Headcount.

Validation failure
------------------
  Country is required.

  Country *
  [_______________________________________________________________]
```

Success clears the form but preserves manager options. Validation and server
failures leave all entered values intact; network/server failures use the fixed
message `Could not add contractor. Try again.` rather than exposing internals.

### Headcount — contractor in a team

```
+------------------------------------------------------------------------+
| Import    Headcount    Employee Details    Contractors                 |
+------------------------------------------------------------------------+

Headcount Dashboard

Blue — UK & US     Red — India     Green — all other countries
Purple — contractors

Total people: 4

Position                      Blue   Red   Green   Purple   Total
-------------------------------------------------------------------
Senior Software Engineer II     1      0      0       1       2
Engineering Manager             1      0      0       0       1
Principal Engineer              0      1      0       0       1
Totals                          2      1      0       1       4

Show teams
  [x] Alex Morgan

[ blue ] Alex Morgan                         [TeamSize: 3]
         Engineering Manager
         United Kingdom
  |
  +-- [ blue ] Priya Shah
  |            Senior Software Engineer II
  |            United Kingdom
  |
  +-- [ purple ] Sam Taylor                  Contractor
               Senior Software Engineer II
               India
```

`[ purple ]` means a lavender `#e8def8` card in the implemented UI, not a
literal text token. Purple indicates contractor status rather than country;
Sam's country remains visible as text. Deselecting Alex Morgan hides Priya and
Sam together. A root contractor renders as a top-level purple card.

### Employee Details — partial contractor record

```
Employee Details

Position filters                 Manager filters
[x] Engineering Manager          [x] Alex Morgan
[x] Principal Engineer
[x] Senior Software Engineer II

Employee ID        | Name         | Worker type | Position                    | Base Salary | ...
------------------------------------------------------------------------------------------------
E-100              | Alex Morgan  | Employee    | Engineering Manager         | £...        |
E-101              | Priya Shah  | Employee    | Senior Software Engineer II | £...        |
contractor:<UUID>  | Sam Taylor  | Contractor  | Senior Software Engineer II | —           |

Sam appears in position filtering and, when assigned, follows the selected
employee manager's visibility. Salary, bonus, comp ratio, and rating cells are
`—`: they have no WorkDay-sourced value.
```

## Scope And Proposed Approach

### Phase A: Data model and API

Add `worker_type TEXT NOT NULL DEFAULT 'employee' CHECK (worker_type IN
('employee', 'contractor'))` to `employees`. Existing and imported rows are
always `employee`; contractor rows are created only by the new manual flow.
This is intentionally an additive migration: fresh databases receive the
column in `SCHEMA_SQL`; existing databases receive it through an idempotent,
`PRAGMA table_info(employees)`-guarded `ALTER TABLE`. Existing rows read as
`employee` through the default.

The data access layer must make worker type explicit rather than relying on a
caller to remember a SQL predicate:

- `getAllEmployees({ includeInactive?, workerType? })` gains a `workerType`
  option with `employee`, `contractor`, and `all` values; its default is
  `employee`, preserving current import and employee-only callers. Headcount
  and Employee Details explicitly request `all`.
- `Employee` and its SQL mapping carry `workerType`. External-manager
  placeholders remain their existing distinct `isExternal` entries, not
  contractor rows.
- Introduce one transactional `createContractor({ name, position, country,
  manager })` mutation. It trims and rejects blank required strings, generates
  `contractor:<UUID>`, verifies that a supplied manager is a current imported
  or external manager, writes `worker_type = 'contractor'`, and assigns the
  matching relationship in the same transaction. The manager value is `null`
  or `{ kind: 'employee' | 'external', id }`, avoiding an ambiguous raw id.
  A failure writes no contractor.
- `reassignManager()` remains the only mutation that writes `manager_id` and
  rejects a non-null manager whose `worker_type` is not `employee`. This makes
  the v1 rule “contractors cannot be managers” true for every caller, not only
  the new form route.

Add two same-origin JSON endpoints:

| Endpoint | Behaviour |
|---|---|
| `GET /api/contractor-form-options` | Returns current managers as `{ id, name, kind }`, ordered by name then id, and `positions` as distinct active-roster position strings in alphabetical order. `kind` is `employee` or `external`, allowing the browser to distinguish an imported manager from a referenced external manager. |
| `POST /api/contractors` | Origin-checked JSON body `{ name, position, country, manager }`, where `manager` is `null` or `{ kind: 'employee' | 'external', id }`. Returns `201 { contractor }` on success. It returns the fixed `400` JSON error `{ error: "Request body must be valid JSON." }` for syntactically invalid JSON, `{ error: "Enter a name, position, and country." }` for an invalid body or blank required fields, and `{ error: "Choose a current manager as the line manager." }` for an invalid manager; none writes a contractor. |

Both routes use explicit payload projection. The create response and the
Headcount response identify a contractor with `isContractor: true`; imported
employees and external-manager placeholders have `isContractor: false`.
`isExternal` remains, so the browser cannot confuse an unknown external
manager with a manually managed contractor.

**Import invariant:** `reconcile()` only considers imported employees when it
calculates existing ids and soft-inactivates people absent from a workbook. It
must never update, inactivate, overwrite, or count a contractor. Thus an
import preview remains rollback-only for contractor rows, and a confirmed
import leaves them untouched.

The contractor route uses a route-local JSON parser wrapper. Its parse-error
callback returns the first fixed `400` response above and does not pass the
parser's message or stack to the browser; all other errors continue to the
route's normal error handling. This is required because Express's default JSON
parser failure response does not meet this API contract.

### Phase B: Contractor entry screen

Add `public/contractors.html` and add a Contractors link to every static-page
navigation bar, with `aria-current="page"` on this new page only.

The page contains:

- A heading, `Contractors`, and a short explanation that these people are
  manually entered and do not come from WorkDay.
- A standard labelled form with a required Name text input, Position dropdown
  populated from active-roster positions, Country text input; an optional Line
  manager select with a `No manager` option; and an
  Add contractor submit button. The select lists only current managers and
  labels external choices as external.
- A loading/failure state for manager options. The submit control remains
  unavailable until options load successfully, preventing an unvalidated
  manager selection.
- On a successful create, an accessible confirmation naming the contractor,
  the form resets to its initial state, and the manager options remain loaded.
  On a `400` error, the entered values remain in place and the returned safe
  message is displayed. On a network/server failure, show a fixed retry
  message and preserve entered values.

As with existing browser pages, use vanilla HTML and ES modules; untrusted
text reaches the DOM only via `textContent` or property assignment. Put any
non-DOM payload/form validation in an importable public logic module so it can
be unit-tested without a browser harness.

### Phase C: Dashboard and Employee Details presentation

Extend `GET /api/headcount` to include active contractors in the flat payload.
They participate in the existing iterative tree building and filtering:

- A contractor with a selected imported or external manager appears beneath
  that manager. Deselecting the manager hides the contractor with the rest of
  that team.
- An unassigned contractor is a root and follows the dashboard's existing
  root visibility rule.
- Contractors cannot be managers in v1, so they never add a manager checkbox.
- If a contractor's former manager later becomes inactive after a WorkDay
  import, the contractor remains active and renders as a root rather than
  disappearing. No automatic reassignment occurs.

Render an `isContractor` entry as `.card.contractor` with lavender background
`#e8def8`, its normal name/position/country text, and a visible `Contractor`
label. Add `Purple — contractors` to the legend. The card's purple type takes
precedence over its country bucket; the displayed country still communicates
location.

Update the totals heading from `Total headcount` to `Total people` and include
contractors in that total. Extend the position-by-region matrix with a fixed
fourth data column, `Purple — contractors`, before `Total`. Employee rows keep
their existing blue/red/green country classification; contractor rows count in
purple irrespective of country. The totals row and `Total people` must always
agree. This preserves both distinctions: country for employees and engagement
type for contractors.

#### Employee Details

`GET /api/employee-details` explicitly requests the combined active roster and
adds `workerType` to every entry. The Employee Details table adds a Worker type
column: imported records display `Employee`, and manual records display
`Contractor`.

Contractors display their generated id, name, position, worker type, and their
existing manager relationship. They participate in position filtering and, when
assigned, the existing manager-tree visibility rules. They never appear as a
manager checkbox because the data-layer invariant forbids contractors from
being managers.

For a contractor, `currency`, `baseSalary`, `bonus`, `compRatio`, and all
three ratings keys are `null`; the browser renders each as `—`. The server must
not query salary or rating history for a contractor. Imported employees retain
their current payload and display behaviour. `isValidPayload`, its tests, and
the table's sortable-column configuration must be extended for the required
`workerType` field.

## Acceptance Criteria

- Given a running app with people, a user can open Contractors from navigation
  and create a contractor with required name, position, and country, with or
  without a current imported or external manager.
- A successful create persists exactly one active contractor and returns `201`;
  blank required fields or an inactive, unknown, individual-contributor,
  contractor, or unreferenced-external manager produce `400` and persist
  nothing.
- A syntactically invalid JSON request receives exactly `400 { error: "Request
  body must be valid JSON." }`; valid JSON with blank/missing required fields
  receives exactly `400 { error: "Enter a name, position, and country." }`; an
  invalid manager receives exactly `400 { error: "Choose a current manager as
  the line manager." }`.
- The app generates contractor IDs; no visible form field permits choosing one.
- After any successful WorkDay import, every previously active contractor
  remains active with their manual name, position, country, and manager link
  unchanged. Import result counts do not include contractors.
- Headcount renders a contractor exactly once, nested beneath their imported or
  external manager when assigned or as a root when unassigned. Their card has purple `#e8def8`
  background, a visible `Contractor` label, and normal country text; the legend
  explains purple.
- Manager filtering hides and restores a managed contractor with their
  manager's subtree. Contractors add no manager filter controls.
- Headcount's Total people and position matrix include contractors, with all
  contractor counts in the Purple column and the matrix grand total equal to
  Total people after every filter update.
- `GET /api/employee-details` returns every active contractor with
  `workerType: "contractor"`, their id/name/position/manager relationship, and
  `null` for every salary, comp ratio, and rating field. Employee Details shows
  that row, its `Contractor` type, and `—` for each unavailable field.
- Contractors appear in Employee Details position filtering and follow their
  assigned manager's visibility, but never occur in manager filters.
- No WorkDay-imported employee or external-manager placeholder changes visual
  treatment or existing behaviour except for the renamed total heading and the
  extra, zero-valued Purple column, and the Employee Details Worker type
  column.

## Testing

- **Unit/integration tests:** Cover worker-type migration; contractor creation
  validation, generated-id uniqueness, manager eligibility and transaction
  rollback; employee-only versus combined-roster queries; reconciliation that
  leaves contractors unchanged; both new API routes; manager-option filtering
  and internal/external manager assignment; Headcount's new explicit payload
  field; malformed-JSON fixed response; and Employee Details' contractor
  payload, filtering, sorting, and unavailable-value rendering.
  Extend `chart-logic` tests to prove tree visibility and updated four-bucket
  totals.
- **CLI tests:** Not applicable. The app ships no CLI for contractor creation;
  this change exposes only browser/API routes.
- **Playwright tests:** Not applicable because this repository has no browser
  test harness. Add deterministic public-logic and server tests as above.
  Perform a secondary manual browser check of successful submission, server
  validation feedback, navigation, legend, and the headcount/Employee Details
  split.

## Risks And Tradeoffs

- Changing `getAllEmployees()` semantics can accidentally include contractors
  in import reconciliation. Centralising worker-type filtering in the data
  layer and testing both default and combined reads is the mitigation.
- Contractor country remains useful context but does not determine card colour;
  the purple engagement-type colour intentionally wins. The country text and
  legend prevent this from obscuring location information.
- V1 has no lifecycle action. A typo or a completed contract requires direct
  database intervention until a follow-up edit/end/delete feature is scoped.

## Open Questions For Product Review

1. Is an optional manager sufficient for the first release, or must every
   contractor be assigned to an imported employee?
2. Is the lavender/purple contractor treatment acceptable, or does your team
   have an established contractor colour to use instead?
3. Should the next iteration include edit/end/delete controls, particularly
   for contractors who leave the organisation?

## Spec Completeness Checklist

- [x] Scope and acceptance criteria
- [x] Testing strategy, including non-applicable CLI and Playwright coverage
- [x] Existing patterns and affected interfaces
- [x] Error handling and malformed-request contract
- [x] Security controls and local-access limitation
- [x] Additive schema migration and import-persistence plan
- [x] Assumptions and outstanding product questions

---

## Change Log

### Update from manual feedback (2026-09-03)

**Applied:**

- Contractors now appear in Employee Details with a Worker type column and
  `—` for WorkDay-only salary, comp-ratio, and rating fields.
- Confirmed contractors are included in Headcount's `Total people` and purple
  position-matrix column.
- Added explicit worker-type query options, a `contractor:<UUID>` ID namespace,
  and a data-layer employee-only manager invariant.
- Added fixed malformed-JSON, invalid-body, and invalid-manager API responses,
  with a route-local parser-error requirement.
- Updated the ASCII Employee Details wireframe and automated testing scope.

**Rejected:**

- None.

**Reorganized:**

- Consolidated Headcount and Employee Details requirements into Phase C so the
  combined-roster contract is defined once.

### Update from manual feedback (2026-09-04)

**Applied:**

- Restricted contractor manager choices to people currently managing an active
  team, rather than every active imported employee.
- Added referenced external managers, including a non-spreadsheet manager such
  as Frank Borg, as selectable choices.
- Made manager selection typed as imported employee or external manager so raw
  ids cannot be ambiguous.
- Changed Position to a required dropdown populated with the active roster's
  distinct position values.

**Rejected:**

- None.

**Reorganized:**

- Merged manager eligibility, API contract, form behavior, and Headcount
  nesting rules around the single concept of a current manager.
