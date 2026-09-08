# Spec 009: Team Management and Headcount Team Breakdown

> **Status: CLOSED - DEFERRED** - Closed on 2026-09-07.
> Reason: Saved-team work is intentionally paused. Its Headcount Team breakdown
> conflicts with Spec 010's requirement to remove that UI; future saved-team
> work requires a new, explicit product decision.
> Archived to: `specs/features/archive/009-team-management/`

## Overview

Introduce saved teams as first-class data. A user can create a team on a new
Teams page either by selecting a line manager, whose current reporting
hierarchy supplies membership automatically, or by explicitly selecting one or
more engineers for a custom team. The Headcount page will replace its current
location-and-role `Team breakdown` with a summary of these saved teams.

## Goals

- Let users create a team without changing WorkDay reporting lines.
- Keep line-manager team membership current after a reimport or manager
  reassignment.
- Support cross-functional custom teams with explicit, many-to-many engineer
  membership.
- Make Headcount show saved teams rather than the current derived
  location/role report.

---

## Feature 1: Create a Team

**Who & why:** A manager needs a way to describe both their normal reporting
organisation and cross-functional working groups. Today the application can
only infer an org-chart subtree from WorkDay data, so there is no durable way
to name, save, or display either kind of team.

### Functional Requirements

#### FR-1.1: Provide a dedicated Teams page and navigation

Add a `Teams` page at `/teams.html`, served by the existing static middleware.
Every existing browser screen (`index.html`, `headcount.html`,
`employee-details.html`, and `contractors.html`) and the new page must contain
the shared navigation links Import, Headcount, Employee Details, Contractors,
and Teams. Only the current page's link has `aria-current="page"`.

The Teams page has the title `Create team`, a live status region, one team-type
radio group, the fields defined below, and one `Save team` submit button. The
form is unavailable while its dropdown options are loading and presents a
fixed reload message if those options cannot be loaded. After a successful
options response, only the currently selected mode's required controls and
submit action are disabled when that mode has no eligible choices; switching to
an eligible mode remains possible.

**Verify:** Requesting `/teams.html` returns HTML. Each of the five screens
contains a Teams link; on `/teams.html` it is the only navigation link marked
current. A failed options request does not permit submission and says `Could
not load team options. Reload the page to try again.`

#### FR-1.2: Start with a By Line Manager form

The initially selected radio option is labelled `By Line Manager`. In this
mode the page shows a required `Team name` text field and a required `Manager`
dropdown, then the shared `Save team` button. It hides all custom-member
controls.

The Manager dropdown contains active imported employees who currently have at
least one active direct report, ordered by name and then employee ID. Its
visible labels disambiguate duplicate names with the employee ID. Contractors
and external-manager placeholders must never appear as manager choices.

**Verify:** With active manager Ana (two direct reports), active individual
contributor Ben, a contractor, and an external-manager placeholder, only Ana
appears in the Manager dropdown. Selecting Custom hides the dropdown; selecting
By Line Manager again restores it and retains its loaded options.

When there are no eligible managers, this mode disables its dropdown and save
action and says `No eligible line managers are available. Import a manager with
at least one active direct report to create this kind of team.`

#### FR-1.3: Provide a dynamic Custom member form

The `Custom` radio option replaces the Manager dropdown with a required
`Engineers` section. It initially contains one engineer dropdown and a `+`
control that appends another dropdown row. Each row after the first has a
remove control; the first row remains so the required section is never empty.
The shared `Team name` field and `Save team` button remain visible.

Every engineer dropdown contains active imported employees only, ordered by
name and then employee ID, with duplicate names disambiguated by ID.
Contractors and external-manager placeholders are excluded. The user may
choose the same engineer in different custom teams, but selecting the same
engineer more than once within one submission is invalid.

**Verify:** In Custom mode a user can add two rows, remove the second, and
submit the remaining selected engineer. A duplicate selection produces the
validation message from FR-2.5 and makes no saved team.

When there are no eligible engineers, this mode disables its dropdown and save
action and says `No active imported engineers are available. Import an active
engineer to create a custom team.`

#### FR-1.4: Make creation clear and durable

The user must enter a non-blank team name after trimming, up to 120 characters.
Team names must be unique case-insensitively after trimming. The database, not
the browser, is the authority for this uniqueness rule. The page submits only
the fields belonging to the currently selected radio mode. On success it clears
the name, returns to the default By Line Manager mode with one empty custom row
ready for a future selection, and announces `Team {name} created.`

Creation is deliberately the only team-management action in scope: users
cannot edit, archive, delete, or alter memberships of an existing team in this
feature.

**Verify:** A successful save returns the created team, displays its name in
the success message through `textContent`, and a second save of the same name
with different case is rejected without changing stored data. A successful
options response with no managers and at least one engineer disables only By
Line Manager mode and permits a Custom save.

### ASCII Design

```text
+---------------------------------------------------------------+
| Import | Headcount | Employee Details | Contractors | Teams    |
+---------------------------------------------------------------+
| Create team                                                   |
|                                                               |
| Team type:  (*) By Line Manager    ( ) Custom                 |
|                                                               |
| Team name                                                      |
| [ Engineering ______________________________________________ ] |
|                                                               |
| Manager                                                        |
| [ Alex Morgan ____________________________________________ v ] |
|                                                               |
|                                      [ Save team ]             |
+---------------------------------------------------------------+

+---------------------------------------------------------------+
| Create team                                                   |
|                                                               |
| Team type:  ( ) By Line Manager    (*) Custom                 |
|                                                               |
| Team name                                                      |
| [ Platform Delivery ________________________________________ ] |
|                                                               |
| Engineers                                                      |
| [ Jamie Lee ______________________________________________ v ] |
| [ Morgan Chen ____________________________________________ v ] [Remove] |
| [+] Add engineer                                               |
|                                                               |
|                                      [ Save team ]             |
+---------------------------------------------------------------+
```

### Architectural Requirements

#### AR-1.1: Follow the existing plain-browser form pattern

`public/teams.html` must remain plain HTML with a browser-loaded ES module;
there is no framework or build step. Extract request construction and response
shape guards to a DOM-free `public/teamLogic.js`, following
`public/contractorLogic.js` and the Browser Screens Convention. DOM wiring
must create elements and insert all team, manager, and engineer names through
`textContent`; it must not interpolate server data with `innerHTML`.

#### AR-1.2: Expose creation options separately from contractor options

Add a read-only `GET /api/team-form-options` response with
`{ managers, engineers }`. Both collections expose only `{ id, name }`; they
are ordered name then ID and validate in `teamLogic.js` before populating the
form. This endpoint must not reuse `/api/contractor-form-options`, whose
manager set intentionally includes external placeholders and whose positions
are irrelevant here.

---

## Feature 2: Persist and Resolve Teams

**Who & why:** A saved team must survive page reloads and future WorkDay
imports, but a line-manager team must still reflect the current hierarchy.
Persisting a copied list for both types would make manager teams stale whenever
reporting lines change.

### Functional Requirements

#### FR-2.1: Persist two team definitions

Save every team with an opaque generated ID, its display name, and exactly one
of these modes:

- A `line_manager` team stores one selected active imported manager and no
  manually stored members.
- A `custom` team stores no manager and one or more explicitly selected active
  imported engineers.

A manager may back at most one `line_manager` team. A custom team may include
any selected engineer, including someone who manages other people, and the
same engineer may be a member of multiple custom teams.

**Verify:** Creating a manager team stores its manager reference without any
custom-member rows; creating a custom team stores each selected engineer once.
A second manager team for the same manager fails atomically.

#### FR-2.2: Resolve manager membership from the current hierarchy

A line-manager team's current members are all active people below its selected
manager at any depth of the `manager_id` hierarchy, excluding the selected
manager themself. This includes active contractors with a reporting-line link;
it excludes external-manager placeholders because they are not employee rows.
Membership is computed whenever teams are read; it is never copied into the
custom-membership table.

A reimport, manager reassignment, contractor creation, or active/inactive
change therefore changes the resolved manager-team headcount immediately. No
team write is made as a side effect of importing WorkDay data.

**Verify:** Given Ana → Ben → Cleo, Ana's manager team resolves Ben and Cleo.
After Cleo is reassigned outside Ana's branch, it resolves only Ben; after Ben
is inactivated, it resolves no active people below Ana. The stored team row is
unchanged throughout.

#### FR-2.3: Keep custom membership independent of the import

Custom memberships remain stored against employee IDs when a member becomes
inactive, but resolved current membership and every displayed headcount include
active people only. If a later import reactivates that same employee ID, the
existing custom membership becomes visible again. A new team cannot be created
with an inactive, unknown, contractor, or external-placeholder engineer.

**Verify:** A custom team containing Ben has headcount 1; after Ben is made
inactive it has headcount 0 without deleting the membership; after reactivation
it returns to 1. A request containing an unknown or inactive employee ID fails
and adds no rows.

#### FR-2.4: Protect saved team references from physical employee deletion

An employee referenced as a saved line-manager team owner or custom-team member
cannot be physically deleted. The existing `deleteEmployee()` operation must
reject that deletion with a conflict before it removes any data, leaving every
team definition and membership intact. This does not affect normal WorkDay
soft-inactivation, whose active-membership behavior is defined in FR-2.2 and
FR-2.3.

**Verify:** An attempted deletion of a selected manager and an attempted
deletion of a custom member each fail; re-reading saved teams proves their rows
and current/inactive membership records are unchanged.

#### FR-2.5: Validate create requests and report safe errors

`POST /api/teams` accepts only a JSON discriminated union:

```text
{ type: "line_manager", name: string, managerId: string }
{ type: "custom", name: string, employeeIds: string[] }
```

It requires the same-origin check used by other state-changing routes. It
returns `201 { team }` after a complete successful write, `400` with a fixed,
actionable validation message for malformed or invalid input, `403` for a
rejected Origin, and `500 { error: "Could not create team." }` for unexpected
failures. In particular, duplicate custom members return `Each engineer may
only be selected once.`, and all other domain validation failures return an
appropriate fixed client-safe message without database details.

**Verify:** A valid same-origin request returns 201; malformed JSON, a missing
mode field, an invalid manager, a duplicate member, a duplicate team name, and
a cross-origin request respectively have their specified non-success outcome.
For each failure, the database contains no partially written team or member
rows.

### Architectural Requirements

#### AR-2.1: Use a normalized SQLite model and transaction-bound mutations

Extend `src/db/schema.ts` with a `teams` table and a `team_members` join table.
The schema constrains a team to either the line-manager or custom form, gives
line-manager teams a unique manager reference, and makes `(team_id,
employee_id)` unique. It stores names after trimming and enforces their
case-insensitive uniqueness with SQLite's `NOCASE` collation. The manager and
member employee foreign keys use `ON DELETE RESTRICT` to support FR-2.4.
`team_members` is meaningful only for custom teams; application-level mutation
validation must enforce that relationship as SQLite cannot express a
cross-table type check directly.

Add typed Team input/result contracts, query functions, and one transactional
create mutation through the existing `src/db/index.ts` boundary. Follow the
current `ValidationError`, `ConflictError`, and `runInTransaction` patterns;
do not expose `getConnection()` to callers. New tables are created on fresh
and existing databases via the idempotent schema script, with foreign keys
enabled. No migration changes to the existing `employees` table are required.

#### AR-2.2: Keep team reads independent from Headcount's existing payload

Add `GET /api/teams`, returning saved teams in stable name-then-ID order. Its
response has this exact shape:

```text
{
  teams: [{
    id: string,
    name: string,
    type: "line_manager" | "custom",
    manager: { id: string, name: string } | null,
    headcount: number
  }]
}
```

`manager` is non-null for a `line_manager` team and null for a `custom` team.
`headcount` is the current active membership defined in FR-2.2 or FR-2.3. This
is a summary endpoint; it does not return member rosters. A saved manager
remains present in this response with their stored name even if they have since
become inactive; only the derived headcount is limited to active people.

Do not add team fields to `GET /api/headcount`; its established seven-field
entry contract and existing org-chart/filter behavior remain unchanged.
`GET /api/teams` is read-only and follows the app's fixed generic-error/no-CORS
convention for roster reads.

---

## Feature 3: Replace Headcount's Team Breakdown

**Who & why:** A Headcount viewer needs the saved teams they created, with a
current count, instead of a second presentation of location and role totals.
The reporting-line checkbox filter and saved-team definitions answer different
questions and must not silently change one another.

### Functional Requirements

#### FR-3.1: Show saved team summaries on Headcount

Replace the existing location/role/count `Team breakdown` table with a saved
team table headed `Team breakdown`. Its columns are `Team`, `Type`,
`Membership`, and `Headcount`. `Type` displays `By Line Manager` or `Custom`.
For a line-manager row, Membership displays `All reports to {manager name}`;
for a custom row it displays `Selected engineers`. The Headcount value is the
current active membership from `GET /api/teams`.

Rows use the stable server order. When no saved teams exist, render
`No saved teams yet.` followed by a safe link labelled `Create a team` to
`/teams.html`, rather than the prior zero-row location/role table.

**Verify:** One manager team named Engineering (manager Ana, two current
reports) and one custom team named Platform (one selected active engineer)
render two rows with headcounts 2 and 1. With no saved teams, no Location,
Role, or Count header appears and the create-team link does.

#### FR-3.2: Keep saved-team summaries independent of chart filters

Load the existing `/api/headcount` and new `/api/teams` data independently.
The existing `Show teams` checkboxes continue to filter only the org chart,
headline, and position-by-region matrix. They do not filter, reorder, or
recalculate saved-team rows. Rename that filter legend to `Show reporting
teams` to distinguish its temporary chart scope from saved teams.

If team data cannot load, leave the successfully loaded Headcount chart and
its existing derived metrics intact, and show `Could not load saved teams.
Reload the page to try again.` in the Team breakdown area. A Headcount data
load failure retains its existing full-page failure behavior.

**Verify:** Deselecting a reporting manager changes the org chart/headline
but not saved-team headcounts. A failed `/api/teams` request does not clear a
successfully rendered Headcount chart or totals.

### ASCII Design

```text
Headcount Dashboard

Total people: 42
[ existing position-by-region matrix ]

Team breakdown
+---------------------+-----------------+------------------------+-----------+
| Team                | Type            | Membership             | Headcount |
+---------------------+-----------------+------------------------+-----------+
| Engineering         | By Line Manager | All reports to Ana Li  |         9 |
| Platform Delivery   | Custom          | Selected engineers     |         5 |
+---------------------+-----------------+------------------------+-----------+

[ Show reporting teams: ☑ Ana Li  ☑ Priya Shah ]
[ existing organisation chart ]
```

### Architectural Requirements

#### AR-3.1: Remove the superseded client-only location/role breakdown

Remove `locationRoleBreakdown()` from `public/chart-logic.js`, its import and
rendering in `public/headcount.html`, and its unit tests. Preserve
`positionRegionBreakdown()`, `totals()`, `buildTree()`, `managerList()`, and
`visibleIds()` unchanged except for the filter legend text required by
FR-3.2. Update the previously closed Spec 008 implementation-facing tests and
living documentation through this feature; do not rewrite its historical spec
or implementation record.

#### AR-3.2: Preserve safe, testable browser behavior

Keep `headcount.html`'s DOM rendering thin and use its existing safe element
helper for every API value. Add pure response-shape validation for the teams
summary, either in `teamLogic.js` or a dedicated DOM-free module, and test it
with Node's built-in test runner. The page must handle one endpoint succeeding
while the other fails as specified in FR-3.2.

---

## Data Requirements

| Data | Fields | Use |
| --- | --- | --- |
| `teams` | `id`, `name`, `type`, `manager_id` | Team identity and manager-derived rule |
| `team_members` | `team_id`, `employee_id` | Explicit memberships for custom teams only |
| `employees` | `id`, `name`, `worker_type`, `end_date`, `manager_id` | Form options and active membership resolution |

## Integration Points

| Path | Change |
| --- | --- |
| `src/db/schema.ts`, `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts`, `src/db/index.ts` | Add normalized team storage, typed read/write APIs, validation, and live membership resolution. |
| `src/server/app.ts` | Add options, create, and saved-team summary routes without altering `/api/headcount`. |
| `public/teams.html`, `public/teamLogic.js` | New creation screen and DOM-free client validation/request helpers. |
| `public/headcount.html`, `public/chart-logic.js` | Replace the location/role Team breakdown with saved-team summaries; retain the org chart and matrix. |
| `test/db/teams.test.ts`, `test/server/teams.test.ts`, `test/teams/teamLogic.test.ts` | Cover persistence, name uniqueness, hierarchy changes, deletion protection, endpoint/error contracts, empty-option modes, and client helpers. |
| `test/server/headcount.test.ts`, `test/dashboard/chartLogic.test.ts` | Remove superseded breakdown expectations; cover new page/navigation and Headcount summary behavior. |
| `specs/docs/standards/data-schema.md`, `specs/docs/standards/headcount-http-api.md`, `specs/docs/conventions/browser-screens.md`, `specs/docs/domains/headcount-dashboard/index.md` | Update living contracts and navigation/screen documentation. |

## Related Specs

| Spec | Relationship | Affected requirements |
| --- | --- | --- |
| [Spec 003: Headcount Dashboard](../003-headcount-dashboard/spec.md) | **Extends** — adds persisted team data to Headcount without changing its core hierarchy payload. | FR-3.1, FR-3.2, AR-3.2 |
| [Spec 005: Headcount Manager Context](../005-headcount-manager-context/spec.md) | **References** — retains real manager hierarchy and excludes external placeholders from create options. | FR-1.2, FR-2.2 |
| [Spec 007: Contractor Management](../007-contractor-management/spec.md) | **References** — manager teams include active contractor reports but custom selection remains imported engineers only. | FR-1.3, FR-2.2 |
| [Spec 008: Headcount Team Breakdown and Performance Filters](../008-headcount-team-and-performance-filters/spec.md) | **Replaces** — supersedes only Feature 1's location/role Team breakdown; performance filters remain intact. | FR-3.1, AR-3.1 |

## Constraints

- The app remains local and single-user, using SQLite, Express, plain HTML,
  and browser-loaded vanilla JavaScript; no framework or new dependency is
  introduced.
- A team is a current-state grouping. This feature does not retain historical
  snapshots of membership or reporting lines.
- A line-manager team includes the selected manager's active reporting subtree,
  not the manager themself; a custom team selects active imported employees
  only.
- Existing WorkDay import/reconciliation remains the authority for employees
  and reporting lines. It must not create, rename, or delete teams.

## Out of Scope

- Editing, deleting, archiving, or bulk importing teams.
- Assigning external-manager placeholders as a saved-team manager.
- Selecting contractors manually for a custom team.
- Filtering the Headcount org chart by a saved custom team.
- Historical team membership, audit history, role-based access control, or
  multi-user collaboration.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — FR-1.1 through FR-3.2 define page,
  persistence, membership, replacement, and failure behavior with Verify
  conditions; Out of Scope defines exclusions.
- [x] **Testing strategy** — Integration Points names DB, server, browser-logic,
  and regression suites; each FR includes an observable verification.
- [x] **Existing patterns** — AR-1.1/AR-2.1/AR-3.2 cite the plain-browser,
  typed DAL, transaction, and safe DOM conventions in the existing codebase.
- [x] **Dependencies** — Constraints explicitly preserve the current stack and
  introduce no libraries.
- [x] **Architecture & interfaces** — AR-1.2, AR-2.1, and AR-2.2 define the
  model, endpoint boundaries, exact payloads, and preserved Headcount contract.
- [x] **Error handling & failure modes** — FR-1.1, FR-2.4, FR-2.5, and FR-3.2 cover
  option-load, validation, origin, unexpected-write, and partial-load cases.
- [x] **Security review** — FR-2.5 requires same-origin validation and safe
  client errors; AR-1.1/AR-3.2 require `textContent` for untrusted values.
- [x] **Performance impact** — AR-2.2 limits Headcount to team summary data;
  live resolution uses the established hierarchy query and current active
  roster, appropriate for this local single-user application.
- [x] **Rollout & migration** — AR-2.1 creates additive tables without
  changing existing employee data; no backfill is needed and rollback is the
  reversible removal of the new code while retained team rows remain unused.
- [x] **Assumptions & risks** — Constraints pin subtree, contractor, and
  current-state semantics; name uniqueness and inactive custom-membership
  behavior are specified in FR-1.4 and FR-2.3; FR-2.4 protects referential
  integrity.

---

## Change Log

### Update from critique-consolidated-v-1.md

**Applied:**

- Added successful empty-options states that disable only the unavailable team
  type and explain how to become eligible.
- Made team-name normalization and database-enforced case-insensitive
  uniqueness explicit.
- Added physical employee-deletion protection for team manager and member
  references.
- Pinned the complete `GET /api/teams` summary response contract.

**Rejected:**

- None.

**Reorganized:**

- Added employee-deletion behavior as FR-2.4 and moved request validation to
  FR-2.5 so persistence and lifecycle requirements stay together.
