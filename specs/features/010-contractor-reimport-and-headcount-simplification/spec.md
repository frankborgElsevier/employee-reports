# Spec 010: Contractor Re-import Reconciliation and Headcount Simplification

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-09-07.
> Implementation summary: `specs/features/010-contractor-reimport-and-headcount-simplification/implementation-summary.md`
> Implementation review: `specs/features/010-contractor-reimport-and-headcount-simplification/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

WorkDay re-imports must preserve manually managed contractors while recognizing
contractors that are now represented by a workbook row. The import keeps the
spreadsheet authoritative for imported employees and never changes a
contractor's engagement type or manually selected line manager. It reports
contractors needing attention through a Contractor Management page rather than
silently deleting, converting, or guessing at identities.

This spec also removes the Headcount page's location-and-role Team breakdown.
The headline total, position-by-region matrix, reporting-team filters, and
organisation chart remain.

## Goals

- Preserve every contractor through previewed and confirmed WorkDay imports.
- Match only on an explicit, exact WorkDay worker ID; never infer a match from
  name, role, or country.
- Give the user an efficient post-import path to review unmatched contractors
  and set their line managers.
- Remove the now-unwanted Team breakdown without changing other Headcount
  calculations or filters.

## Product Decisions

- A contractor remains a contractor when their WorkDay worker ID appears in a
  workbook. Matching proves current presence; it never converts the person to
  an imported employee.
- Contractor-controlled fields remain contractor-controlled: name, position,
  country, worker type, and line manager are not overwritten by an import.
  WorkDay compensation, ratings, and imported reporting lines remain
  unavailable for contractors.
- A user supplies the optional WorkDay worker ID manually. Exact match is
  case-sensitive after trimming; blank values mean no match is attempted.
- A contractor cannot claim a WorkDay worker ID already used as an imported
  employee ID, including an inactive employee. Identity conflicts require an
  explicit future conversion workflow; they are never reconciled implicitly.
- A confirmed import shows a **Review contractors** link only when one or more
  active contractors were not matched. It does not force navigation away from
  the import result.
- The Contractors page becomes a management page. It retains the ability to
  add a contractor and adds a list for reviewing each existing contractor and
  changing their line manager.

## Feature 1: Reconcile contractors safely during import

**Who & why:** The local report owner re-imports a fresh WorkDay export to
refresh the employee roster but must not lose people maintained outside that
export. They need the application to recognize known contractors safely and
make the exceptions visible enough to resolve.

### Functional Requirements

#### FR-1.1: Preserve contractors in every import mode

Workbook preview and confirmation continue to upsert and soft-inactivate only
imported employees. Every active contractor remains active and retains its
contractor ID, worker type, manual name, position, country, and manually
selected manager whether it matches a workbook row or not. An import must not
delete, inactivate, convert, or create salary/rating records for a contractor.

**Verify:** Previewing and confirming a workbook with no contractor rows leaves
an existing contractor record unchanged and active; its salary and rating
history remain absent.

#### FR-1.2: Match only an explicit WorkDay worker ID

An active contractor with a non-blank stored WorkDay worker ID matches exactly
one workbook row when that value equals the row's `Employee ID` after the
contractor value has been trimmed. Name, position, country, supervisor, and
any partial textual similarity must not create a match. The system rejects a
new or edited contractor WorkDay worker ID if another contractor already owns
that exact value or if the value is the ID of any stored imported employee,
active or inactive.

When a contractor matches, the workbook row is consumed by that contractor:
it must not also upsert a separate imported employee, affect employee import
counts, or collide with the contractor's generated `contractor:<UUID>` ID.
The contractor retains all contractor-controlled fields in accordance with the
Product Decisions.

A consumed contractor row never becomes an imported employee manager. When an
imported employee names that WorkDay worker ID as their supervisor, the employee
uses the existing unresolved-supervisor behavior: it is not assigned to the
contractor; an external-manager relationship is used only when the workbook
supplies a usable supervisor name, otherwise no manager relationship is set.

**Verify:** A contractor with WorkDay worker ID `E-12` matches only a workbook
row with employee ID `E-12`; a similarly named contractor without that ID does
not match, and no duplicate employee is created for `E-12`. An employee whose
workbook supervisor ID is `E-12` is linked to the named external-manager
placeholder, never to the contractor. Attempting to assign `E-12` to a
contractor when an imported employee `E-12` already exists is rejected.

#### FR-1.3: Identify contractors needing review after a confirmed import

For each preview, calculate the number of active contractors that would not
match the submitted workbook, including contractors with no WorkDay worker ID.
For a confirmed import, persist the corresponding match outcome so the
Contractors page can distinguish **Matched in latest import** from **Needs
review**. A subsequent confirmed import recomputes this state for all active
contractors atomically, clearing a prior matched state when a contractor is no
longer matched. An unconfirmed preview, failed confirmation, or expired token
must not alter it. A contractor created after an import starts as **Needs
review** and does not change that prior import's result.

The normal employee counts remain `{ added, updated, inactivated }`; contractor
review count is a separate value and contractors never inflate those counts.

**Verify:** A preview of a workbook that omits one of two active contractors
reports one contractor needing review without changing stored status; confirming
it marks that contractor as needing review and the matched contractor as
matched.

#### FR-1.4: Give unmatched contractors an import-result action

After a successful confirmed import, the Import page continues to show the
employee reconciliation summary and Headcount link. When the confirmed outcome
has one or more contractors needing review, it additionally shows the count and
a safe link labelled `Review contractors` to `/contractors.html`. When none
need review, that message and link are omitted.

**Verify:** Confirming an import with two unmatched contractors renders `2
contractors need review.` and a Review contractors link; a later fully matched
import renders neither.

### Architectural Requirements

#### AR-1.1: Keep reconciliation atomic and reusable

Extend `src/import/reconcile.ts`'s existing `reconcile(rows, { commit }, now)`
transactional preview/commit path rather than introduce a separate contractor
import workflow. Both employee reconciliation and contractor match-state
updates occur in the same transaction, so any parsing, validation, or database
failure rolls back all changes and an intentional preview rolls them all back.

#### AR-1.2: Additive contractor linkage and status migration

Extend the `employees` schema and typed data-access projections with nullable,
contractor-only WorkDay worker-ID and latest-match-status fields. Fresh
databases define them in `src/db/schema.ts`; existing local databases receive
idempotent, non-destructive `PRAGMA table_info`-guarded migrations in
`src/db/connection.ts`, following the existing worker-type and external-manager
migration pattern. Enforce uniqueness for non-null contractor WorkDay worker
IDs in SQLite, including after a restart.

#### AR-1.3: Extend the existing preview and confirm contracts compatibly

`POST /api/preview` and `POST /api/confirm` retain their existing token,
origin, and employee-count contracts. Their successful payloads add a typed
`contractorsNeedingReview` non-negative integer derived from the same
reconciliation run; all existing consumers that only read `counts` continue to
work. `public/index.html` must validate this new field before using it and
continue to render untrusted text with DOM properties rather than `innerHTML`.

---

## Feature 2: Manage contractor identity and line-manager details

**Who & why:** A report owner needs one place to see which contractors were
recognized in the latest import and to correct the details that cannot safely
be inferred from it. This avoids a lost contractor becoming an invisible root
card with an accidental or stale manager.

### Functional Requirements

#### FR-2.1: Provide a contractor management list

The Contractors page keeps the existing Add contractor form and displays all
active contractors below it, ordered by name then contractor ID. Each row shows
name, position, country, optional WorkDay worker ID, latest import status, and
current line manager. Status wording is `Matched in latest import` when the
contractor matched the most recently confirmed import; otherwise it is `Needs
review`. A newly created contractor is `Needs review` until a confirmed import
matches it.

**Verify:** With one matched and one unmatched active contractor, the page
shows both records and their distinct status labels without displaying inactive
employees or external-manager placeholders as contractor records.

#### FR-2.2: Capture and update an exact WorkDay worker ID

The Add contractor form includes an optional `WorkDay worker ID` field. Each
existing contractor row exposes the same editable field. Empty input clears an
existing ID; non-empty input is trimmed and must be unique among contractors.
The page explains that this ID is the only automatic import matching key.

The ID must also not equal any imported employee ID, including an inactive
employee. The user must resolve that identity conflict outside this flow;
clearing the ID remains permitted.

On a validation failure, preserve the submitted field values and display a
safe, actionable error. The server remains the authority for trimming and
uniqueness.

**Verify:** A user can add an ID to an unmatched contractor and see it persist;
attempting to assign the same trimmed ID to a second contractor is rejected
without changing either record, as is assigning an existing active or inactive
employee ID.

#### FR-2.3: Set each contractor's line manager

Each contractor row has an editable `Line manager` selector and a Save action.
It begins with `No manager` and otherwise offers the same current-manager set
as the existing contractor form: active imported employee managers with active
direct reports and currently referenced external managers. Contractors,
individual contributors, inactive employees, and unreferenced external
managers are not selectable.

Saving changes only the selected contractor's WorkDay worker ID and line
manager; it does not overwrite any other contractor fields. Revalidate manager
eligibility at save time. If an option has become invalid because the roster
changed, reject the update, preserve the entered choice, and instruct the user
to reload the manager options.

**Verify:** Selecting an eligible manager updates only that contractor's
manager relationship; a concurrent import that makes the manager ineligible
causes the update to fail without any partial field changes.

#### FR-2.4: Expose safe list and update APIs

Add a read-only endpoint that returns active contractors with an explicit
projection of their identity, WorkDay worker ID, current manager descriptor or
null, and match status. Add one origin-checked JSON update endpoint addressed
by generated contractor ID. Its required whole-row body contains only
`workdayWorkerId` (a string; an empty value clears it) and `manager` (`null` or
the existing typed manager descriptor). The server validates both fields and
applies both or neither in one transaction. Absent, unknown, non-contractor,
malformed, contractor-duplicate-ID, imported-employee-ID, or invalid-manager
targets return fixed safe errors and make no change.

The existing creation and form-options endpoints remain supported. Their
responses/options extend only as needed to expose the optional WorkDay worker
ID and the same manager descriptor; no endpoint exposes compensation, rating,
or internal database errors.

**Verify:** A read request returns only active contractor projections; a
contractor-duplicate or imported-employee WorkDay worker ID paired with a
changed manager is rejected without changing either field, and malformed or
cross-origin update requests return their documented error and leave the target
unchanged.

### ASCII Screen Designs

These are content and layout guides, not pixel-perfect designs. They reuse the
existing single-column, plain-HTML application style.

#### Import — successful confirmation with review needed

```text
+------------------------------------------------------------------------+
| Import    Headcount    Employee Details    Contractors                 |
+------------------------------------------------------------------------+

Import WorkDay Report

Import complete: 4 added, 31 updated, 1 inactivated.
2 contractors need review.  [ Review contractors ]
[ View the Headcount dashboard ]
```

`Review contractors` is present only when the count is greater than zero. It
is a user-chosen next step; confirmation never redirects automatically.

#### Contractors — management state

```text
+------------------------------------------------------------------------+
| Import    Headcount    Employee Details    Contractors                 |
+------------------------------------------------------------------------+

Contractors
Add people who do not appear in WorkDay. A WorkDay worker ID enables exact
matching when they later appear in an import.

[ existing Add contractor form, including optional WorkDay worker ID ]

Existing contractors

+----------------+-------------------+---------------------------+
| Sam Taylor     | Needs review      | WorkDay worker ID [____]  |
| Senior Eng.    | Not in latest     | Line manager [No manager v]|
| India          | import            | [ Save ]                  |
+----------------+-------------------+---------------------------+
| Jo Morgan      | Matched in latest | WorkDay worker ID [E-104] |
| Eng. Manager   | import            | Line manager [Ana Li    v]|
| United Kingdom |                   | [ Save ]                  |
+----------------+-------------------+---------------------------+
```

Status is text, never colour alone. A failed save leaves the row's chosen
value visible and shows its fixed error beside the row or in the page's live
status region. The drawing is a content guide, not a required fixed-width
table: a narrow viewport may stack each contractor's labelled fields while
retaining its individual Save action.

---

## Feature 3: Remove the Headcount Team breakdown

**Who & why:** The report owner no longer wants a second, location-and-role
view beneath the primary Headcount metrics. Removing it makes the dashboard
focus on the total, position-by-region matrix, and organisation chart.

### Functional Requirements

#### FR-3.1: Omit the Team breakdown UI

The Headcount page no longer renders the `Team breakdown` heading, Location,
Role, Count table, or its totals row. It continues to render the Total people
headline, position-by-region matrix, Show teams controls, and organisation
chart exactly as before, including the current filter behavior.

**Verify:** A loaded Headcount page contains no `Team breakdown`, `Location`,
or `Role` table heading while its total, matrix, filters, and chart still
render from the same employee payload.

### Architectural Requirements

#### AR-3.1: Retire the now-unused client-only aggregation

Remove `locationRoleBreakdown` from `public/chart-logic.js`, its import and
rendering from `public/headcount.html`, and its dedicated tests in
`test/dashboard/chartLogic.test.ts`. Update the served-page assertion in
`test/server/headcount.test.ts`. Do not change the `/api/headcount` response
or the other chart-logic exports.

---

## Data Requirements

- Contractor WorkDay worker IDs are optional, trimmed strings stored separately
  from generated contractor IDs and unique across non-null contractor values.
- A non-empty contractor WorkDay worker ID cannot equal the primary ID of any
  imported employee, active or inactive. This cross-worker-type rule is
  validated by the transactional database mutation for both creation and update;
  it complements, rather than replaces, the contractor-only SQLite uniqueness
  constraint.
- Latest-match status reflects the most recently *confirmed* import only;
  every successful confirmation atomically recomputes it for all active
  contractors, while previews, failed confirms, and expired tokens never alter
  it.
- A matched workbook row is excluded from imported-employee salary, rating,
  and inactive-employee processing because it represents a contractor, not an
  employee record. A reference to that row as an imported employee's supervisor
  follows the existing unresolved-supervisor fallback and never creates a
  contractor manager relationship.
- Any migration must preserve existing contractor records. Existing contractors
  start with no WorkDay worker ID and `Needs review` status.

## Integration Points

| Area | Required change |
| --- | --- |
| `src/import/reconcile.ts` | Calculate exact contractor matches and persist results only inside the existing committed transaction. |
| `src/db/schema.ts`, `src/db/connection.ts`, `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts` | Add the contractor-only linkage/status migration, projections, list/update operations, and invariant validation. |
| `src/server/app.ts` | Extend preview/confirm payloads and add safe contractor list/update routes using existing error and origin-check patterns. |
| `public/index.html`, `public/contractors.html`, `public/contractorLogic.js` | Render review CTA, management list, and DOM-independent request/response validation helpers. |
| `public/headcount.html`, `public/chart-logic.js` | Remove the derived Team breakdown only. |
| `test/import/`, `test/db/`, `test/server/`, `test/contractors/`, `test/dashboard/` | Cover matching, rollback, migrations, APIs, management UI helpers, and removed breakdown behavior. |

## Related Specs

| Spec | Relationship | Affected Requirements |
| --- | --- | --- |
| [Spec 002: WorkDay Import Screen](../002-workday-import/spec.md) | **Modifies** — extends its preview/confirm reconciliation result with contractor match review while preserving the employee import flow. | FR-1.1–FR-1.4, AR-1.1–AR-1.3 |
| [Spec 007: Manual Contractor Management](../007-contractor-management/spec.md) | **Extends** — turns the add-only contractor screen into contractor management and adds explicit import matching. | FR-2.1–FR-2.4 |
| [Spec 008: Headcount Team Breakdown and Performance Filters](../008-headcount-team-and-performance-filters/spec.md) | **Replaces** — supersedes Feature 1's location/role Team breakdown; its performance-filter feature remains unaffected. | FR-3.1, AR-3.1 |
| [Spec 009: Team Management and Headcount Team Breakdown](../archive/009-team-management/spec.md) | **References** — deferred and archived; it has no live requirements. Future saved-team work needs a new product decision. | FR-3.1, AR-3.1 |

## Constraints

- Keep the local, single-user security model: state-changing routes use the
  existing same-origin guard and return fixed safe validation errors.
- Use the existing Node.js/TypeScript, SQLite, Express, plain HTML, vanilla
  JavaScript, and `node:test` patterns; no new dependency is needed.
- Maintain import atomicity and the existing one-pending-import lifecycle.
- Never rely on fuzzy matching or unattended worker-type conversion.
- Preserve the existing rule that a contractor cannot be a line manager.
- Spec 009's conflicting saved-team proposal is deferred and archived. Do not
  reintroduce a Headcount Team breakdown without a new product decision.

## Out of Scope

- Automatic conversion between contractor and employee worker types.
- Fuzzy matching, email matching, or matching on name/position/country.
- Importing contractor compensation, ratings, or WorkDay reporting lines.
- Editing or deleting contractor name, position, country, or engagement type.
- Saved-team creation, management, or a replacement Team breakdown.
- Bulk contractor editing, authentication, and multi-user permissions.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — FR-1.1–FR-3.1 define the import,
  management, and removal outcomes with verifiable conditions.
- [x] **Testing strategy** — Every functional requirement has a Verify line;
  Integration Points identifies the established test suites.
- [x] **Existing patterns** — AR-1.1–AR-1.3 and AR-3.1 cite the existing
  reconciliation, additive-migration, endpoint, and browser-module patterns.
- [x] **Dependencies** — Constraints specify no new dependency; the current
  SQLite/Express/vanilla-JS stack is sufficient.
- [x] **Architecture & interfaces** — AR-1.1–AR-1.3, FR-2.4, Data
  Requirements, and Integration Points define database, API, and UI impacts.
- [x] **Error handling & failure modes** — FR-1.3, FR-2.2–FR-2.4, and AR-1.1
  cover preview rollback, invalid matching keys/managers, stale options, and
  malformed/cross-origin requests; FR-1.2 covers consumed-row supervisor
  fallback and cross-worker-type identity rejection.
- [x] **Security review** — Constraints and FR-2.4 retain same-origin writes,
  safe errors, explicit projections, and no `innerHTML` for untrusted values.
- [x] **Performance impact** — Exact matching is bounded by the existing
  local import roster and performed inside its one transaction; it introduces
  no remote call or new per-page bulk request.
- [x] **Rollout & migration** — AR-1.2 and Data Requirements require an
  idempotent additive migration that preserves existing contractors.
- [x] **Assumptions & risks** — Product Decisions and Constraints make the
  stable-ID dependency, no-fuzzy-match rule, and no-conversion boundary
  explicit.

---

## Change Log

### Update from critique-consolidated-v-1.md

**Applied:**

- Defined the existing unresolved-supervisor fallback for a workbook row
  consumed as a contractor, preserving the no-contractor-manager invariant.
- Defined atomic whole-row contractor updates with required WorkDay worker-ID
  and manager values.
- Made whole-roster contractor match-status recomputation explicit for each
  successful confirmation.
- Added a responsive-layout interpretation for the Contractor ASCII design.
- Made resolving Spec 009 Feature 3 a pre-implementation constraint.

**Rejected:**

- Directly changing Spec 009 — this update was scoped to Spec 010. Its
  lifecycle must be handled by a separate spec-maintenance command.

**Reorganized:**

- Integrated each clarification into the affected requirement, Data
  Requirements, or Constraints rather than adding a separate feedback section.

### Update from critique-consolidated-v-2.md

**Applied:**

- Rejected a contractor WorkDay worker ID that equals any active or inactive
  imported employee ID.
- Required the creation and update mutations to enforce that cross-worker-type
  identity rule transactionally, alongside contractor-only uniqueness.
- Added creation and update regression coverage expectations.

**Rejected:**

- None.

**Reorganized:**

- Integrated the identity-conflict rule into Product Decisions, matching,
  editing, API, data, and test requirements so it has one consistent meaning.
