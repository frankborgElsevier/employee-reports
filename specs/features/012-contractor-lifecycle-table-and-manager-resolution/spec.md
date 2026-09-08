# Spec 012: Contractor Lifecycle Table and Manager Resolution

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-09-07.
> Implementation summary: `specs/features/012-contractor-lifecycle-table-and-manager-resolution/implementation-summary.md`
> Implementation review: `specs/features/012-contractor-lifecycle-table-and-manager-resolution/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

Contractors currently remain active indefinitely and appear as individual edit cards. Report owners need a compact table of every active contractor, with safe actions to edit contractor details, choose a line manager, or remove a contractor who is no longer needed.

Contractors do not have a WorkDay ID. WorkDay IDs identify imported employees, including possible line managers, and are maintained by the normal workbook import. A user selects a line manager by name; the application saves the corresponding imported-employee relationship without requiring the user to view, copy, or enter an ID.

## Goals

- Replace the active-contractor card list with an accessible management table.
- Support editing a contractor, setting or changing their line manager, and permanently deleting a contractor.
- Remove contractor-owned WorkDay IDs, link status, matching, and review work from the contractor experience and import reconciliation.
- Make line-manager selection name-led and unambiguous without displaying or accepting IDs.

## Product Decisions

- "All contractors" means every **active** contractor. Imported employees, inactive records, and external-manager placeholders are not contractor rows.
- A contractor has only its generated contractor ID. It never has a WorkDay ID, WorkDay-link status, or WorkDay matching/review state.
- The normal WorkDay import keeps each imported employee's workbook `Employee ID` and resolves their imported reporting relationship from `Direct Supervisor ID`. These are internal application relationships.
- The Contractors page asks the user to select a manager by name, not enter a manager employee ID. The saved relationship targets the selected imported employee record; its WorkDay ID remains internal.
- The manager picker displays only human-readable information: name and, for duplicate names, available context such as position and country. It never displays a WorkDay ID or other opaque identifier. If context cannot distinguish two managers, the application treats that choice as unresolved and does not guess or allow a selection between those records.
- "Two managers with team same name" is interpreted as two selectable managers with the same displayed person name. The app has no durable team-name field, so team-name equality is not an identity rule. A future stable team field requires a separate product decision.
- The no-ID display rule applies to the Contractors page and its APIs. Existing employee-identity display outside this feature, including Employee Details, is unchanged.
- A contractor's line manager must be an imported employee. During migration, any contractor assigned to an external-manager placeholder is set to `No manager`; the external-manager record and all imported employee relationships remain untouched. The table tells the user to choose an imported line manager.
- Deletion is explicit, confirmed, and permanent. It is not soft-inactivation and has no restore/recycle-bin flow.

## Feature 1: Manage active contractors in a table

**Who & why:** A report owner needs to review many manually managed people at once and make safe corrections without scanning repeated cards. They need each row to show the contractor's details, current reporting placement, and clear actions.

### Functional Requirements

#### FR-1.1: Render every active contractor in a stable table

The Contractors page retains the add-contractor form and replaces the card list with one accessible table of active contractors, ordered by name then generated contractor ID. The table has columns for contractor name, position, country, line manager (or `No manager`), and Actions. It renders a clear empty state when no active contractors exist and never renders imported employees, inactive records, external-manager placeholders, WorkDay-link status, or a contractor WorkDay ID.

**Verify:** Given three active contractors and one imported employee, the page shows exactly three rows in name/ID order with the required columns and actions; the imported employee and every WorkDay-link field are absent.

#### FR-1.2: Add and edit only manual contractor details

The add form and each row's `Edit` action collect only the contractor's name, position, country, and optional line-manager selection. There is no WorkDay-ID input, link-status label, or instruction to find a WorkDay ID. Edit opens an accessible inline state or focused dialog populated with current values and provides Save and Cancel.

Save trims and validates required text fields, preserves the generated contractor ID and existing manager unless changed, and updates edited values atomically. Cancel and validation/network failures leave persisted data unchanged, retain entered values, and show an actionable message.

**Verify:** A user creates and edits Sam without seeing or entering any WorkDay ID. Editing Sam's position changes only that position; cancelling or submitting a blank name leaves the stored contractor unchanged.

#### FR-1.3: Set a line manager by name without entering an ID

Each row provides `Set line manager` with `No manager` plus current eligible imported-manager options. Selecting an option changes Headcount placement only after explicit Save; cancelling leaves placement unchanged. The browser must not render a free-text manager-ID input, editable hidden manager-ID field, instruction to locate an ID, or an error asking the user to provide one.

Options use the manager name by default. The application groups duplicate normalized names and adds human-readable context to those choices. If context does not make a group unique, it does not display an ID or permit a selection between those records; it explains that the manager cannot be identified from the imported people data. The browser submits the opaque reference for an eligible selected option; the server revalidates it and persists the relationship. It must not silently choose a same-named manager when an option becomes stale, ineligible, or ambiguous.

For an unresolved duplicate, the table preserves the contractor's current manager and provides the actionable message: `Two imported managers cannot be distinguished by the available name, position, and country. Import corrected people data, then choose the manager.` A contractor with no existing manager remains `No manager`. No action in this flow asks for or displays an ID.

**Verify:** A user assigns Sam to Alex Morgan through a name-led option and does not see or type an ID. Two eligible Alex Morgans with different positions or countries receive that human-readable context. Two otherwise indistinguishable Alex Morgans cannot be selected, display no ID, and leave Sam's existing manager unchanged. A stale selection changes neither Sam's manager nor any other field.

#### FR-1.4: Delete a contractor deliberately and safely

Each row provides a `Delete` action. It presents a confirmation naming the contractor and stating that removal is permanent and removes the contractor from Contractors, Headcount, and Employee Details. Cancel returns to the unchanged table. On confirmation, the server deletes only the addressed active contractor in one transaction and the browser refreshes the row only after a successful response.

Unknown, non-contractor, inactive, and already-deleted targets return a safe response. The action must not delete imported employees, manager records, or unrelated history. A failed request leaves the row visible with a safe retry message.

**Verify:** Confirming deletion removes Sam from all active-person screens while another contractor and imported employee remain. Cancelling, repeating the request, and targeting an imported employee leave other records unchanged.

### ASCII screen design

```
Contractors
Add people who do not appear in WorkDay. Select their line manager by name;
the application keeps the manager's WorkDay identity automatically.

| Contractor | Position | Country | Line manager | Actions |
|------------|----------|---------|--------------|---------|
| Sam Taylor | Engineer | India   | Alex Morgan  | Edit · Set line manager · Delete |
| Jo Chen    | Analyst  | UK      | No manager   | Edit · Set line manager · Delete |

Set line manager — Sam Taylor
  ( ) No manager
  ( ) Alex Morgan — Engineering Manager, United Kingdom
  ( ) Alex Morgan — Product Manager, United Kingdom
  [Cancel] [Save line manager]
```

## Feature 2: Keep manager identity import-owned

**Who & why:** A report owner refreshes the workforce from WorkDay but should not have to understand opaque employee IDs to maintain contractor placement. They need the application to keep imported manager identity reliable while presenting only human-readable choices.

### Functional Requirements

#### FR-2.1: Retain imported employee and manager IDs without prompting users

For each imported employee row, the normal workbook import continues to use `Employee ID` as the imported employee identity and `Direct Supervisor ID` to resolve that employee's manager. A resolvable supervisor ID assigns the imported relationship; an unresolved ID follows the existing external-manager fallback only when a usable supervisor name exists. The import UI does not ask the user to type, confirm, or repair a line-manager employee ID merely because it processed a manager relationship.

Contractors remain manually managed and cannot become managers. Importing a workbook never creates, restores, updates, matches, reviews, or consumes a contractor based on a WorkDay ID.

**Verify:** Importing a workbook with a resolvable `Direct Supervisor ID` assigns imported reports to their manager without user ID entry. An import with an active contractor changes neither that contractor nor its selected manager.

#### FR-2.2: Expose manager choices with minimal disambiguation metadata

The manager-options API returns typed, server-derived options for current eligible imported managers. Each has an opaque selected reference used only to submit the user's chosen option, a display name, and the minimum human-readable context needed to label duplicate names. The server determines duplicate-name groups and never labels or offers an opaque identifier as display data. An indistinguishable duplicate group is marked unavailable for selection rather than resolved by an ID.

The existing eligibility rule remains: an imported manager is active and has an active direct report. A previously saved but no-longer-current imported manager is shown on a contractor row as historical current placement, but is not a new selectable choice until eligibility returns. External-manager placeholders are not returned as choices; migration clears their existing contractor assignments as specified in Product Decisions.

**Verify:** Unique manager names and options that differ by position or country produce only human-readable labels. Two equal-name, equal-context managers are unavailable for selection and no UI element exposes either manager's ID.

#### FR-2.3: Remove contractor-owned WorkDay linkage completely

Remove the contractor WorkDay worker-ID field, its create/edit/list API fields, corresponding browser controls and validators, contractor link statuses, contractor review counts, exact contractor-row consumption, and the contractor-specific unique index. Fresh databases define `employees` without `workday_worker_id` or `latest_import_matched`.

For an existing local database, one idempotent transaction rebuilds `employees` to that fresh shape, copying each employee's ID, manual fields, worker type, active state, and employee-manager relationship. It clears every contractor `external_manager_id` so those contractors become `No manager`, then recreates the normal employee-manager index and validates foreign keys before committing. The migration removes the obsolete contractor WorkDay-ID and match-state values; it does not transfer them to a manager field or use them to infer a manager.

The normal imported employee ID and supervisor relationship remain unchanged. The migration does not remove or alter imported employees, salary, ratings, manager relationships, external managers, or contractor manual data.

**Verify:** A migrated database with contractors previously holding `workday_worker_id` values and external-manager assignments opens successfully. The former ID values no longer exist or influence an import; affected contractors show `No manager`; imported employees, their manager relationships, salary/rating history, and external-manager records remain unchanged. An import row with the same ID as a legacy contractor value follows normal employee reconciliation.

#### FR-2.4: Keep actions atomic and representation-safe

The server exposes origin-checked JSON mutations for manual-detail edits, line-manager changes, and deletion. Each mutation has a narrow documented body, revalidates the active contractor and manager eligibility at write time, and commits all fields for that action or none. Responses use explicit contractor projections and fixed safe errors; they must not leak database errors, compensation/performance data, or arbitrary employee records.

The page uses DOM-safe rendering. Each action prevents duplicate submission and retains local form state after an error.

**Verify:** A malformed, cross-origin, stale, or duplicate action leaves the contractor unchanged and returns a documented safe error. A double delete has one successful removal and one not-found response, never a different target.

### Architectural Requirements

#### AR-2.1: Simplify contractor data boundaries

Update `src/db/schema.ts`, `src/db/connection.ts`, `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts`, and `src/db/index.ts` to remove contractor-specific WorkDay fields and mutations while retaining generated contractor IDs and employee-manager relationships. The existing-database migration rebuilds `employees` inside one transaction, recreates its retained index, and runs a foreign-key integrity check before commit. Do not add a duplicate manager-ID field; the current manager relationship remains the sole source of contractor placement.

#### AR-2.2: Preserve the import authority boundary

`src/import/reconcile.ts` remains the sole authority for imported employees and their supervisor relationships. Remove contractor matching/status logic from that path. The reconciliation result and import UI no longer return or render `contractorsNeedingReview`. Never derive a manager from fuzzy name, team, title, country, or similarly inferred data.

#### AR-2.3: Keep API and UI changes independently testable

Update `src/server/app.ts` to remove contractor WorkDay-ID payloads and add narrow mutations for detail edits, line-manager updates, and deletion. Update `public/contractorLogic.js` and `public/contractors.html` for the table and name-led manager picker. Cover database migration/mutations, APIs, DOM-independent browser logic, and import regressions in existing contractor and import test areas.

## Data Requirements

- Contractors store generated identity, manual name, position, country, and an optional manager relationship only.
- Imported employees retain their workbook `Employee ID`; imported reporting relationships retain the workbook `Direct Supervisor ID` resolution.
- No contractor `workday_worker_id`, link state, match state, review count, or user-entered manager employee-ID field remains.
- No persistent team-name model is required for disambiguation.
- A contractor cannot retain an external-manager assignment after migration; it becomes `No manager` until the user selects an imported manager.
- Contractor deletion removes only the contractor and its cascade-owned history, if any; it does not delete imported employees or manager records.

## Integration Points

| Area | Relationship | Requirements |
| --- | --- | --- |
| [Spec 011: Assisted Contractor WorkDay Linking](../011-assisted-contractor-workday-linking/spec.md) | **Replaces** — removes its contractor-owned WorkDay link, candidate selection, supersession, and review concepts. | FR-2.3, AR-2.2 |
| [Spec 010: Contractor Re-import Reconciliation and Headcount Simplification](../010-contractor-reimport-and-headcount-simplification/spec.md) | **Modifies** — removes its contractor WorkDay-ID/review requirements while retaining manual manager placement and contractor preservation. | FR-1.1–FR-2.4 |
| WorkDay Import | **Modifies** — retains imported employee/supervisor IDs and removes contractor-specific reconciliation output. | FR-2.1–FR-2.3, AR-2.2 |
| Headcount and Employee Details | **Regression dependency** — deleted contractors disappear; retained contractors remain placed through their selected manager. | FR-1.3–FR-1.4 |

## Expected Implementation Touchpoints

| Path | Change |
| --- | --- |
| `public/contractors.html` | Replace cards with a table; remove contractor WorkDay-ID controls and add edit, manager, and delete interactions. |
| `public/contractorLogic.js` | Remove WorkDay-ID validation; define table requests, safe responses, and manager-label construction. |
| `src/server/app.ts` | Remove contractor WorkDay-ID/list/review contracts; add narrow edit, manager, and delete routes. |
| `src/db/schema.ts`, `src/db/connection.ts`, `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts`, `src/db/index.ts` | Remove contractor link persistence and implement migration, detail edits, manager changes, and deletion. |
| `src/import/reconcile.ts`, `src/import/types.ts`, `public/index.html` | Remove contractor matching, status, and review-count behaviour while retaining employee supervisor reconciliation. |
| `public/employee-details.html`, `public/employeeDetailsLogic.js` | No feature change; retain existing imported-employee identity display outside the Contractors experience. |
| `test/contractors/contractorLogic.test.ts`, `test/server/contractors.test.ts`, `test/db/contractors.test.ts`, `test/import/reconcile.test.ts`, `test/server/app.test.ts` | Cover removal, migration, manager disambiguation, table lifecycle actions, and import regression. |

## Constraints

- The application remains a local, single-user Node.js/TypeScript, SQLite, Express, and vanilla-JavaScript application.
- No new client framework or third-party dependency is needed.
- Contractor and manager references are opaque internal values. The browser may retain a selected manager reference solely to submit the selected option, but the UI never displays it as an ID.
- Contractors cannot be line managers.
- Existing local databases must migrate without losing contractor manual or imported employee data.

## Out of Scope

- Contractor-owned WorkDay IDs, matching, review status, candidate selection, or imported-identity claiming.
- A new spreadsheet format or bulk contractor create/update/delete import.
- User-entered line-manager employee IDs.
- Displaying a WorkDay or other opaque identifier in the contractor UI, even to resolve duplicate manager names.
- Removing imported employee IDs from Employee Details or any UI outside the Contractors experience.
- Fuzzy automatic manager matching from a name, team, title, country, or other text.
- Changing imported employee details, salary, ratings, or reporting lines from the contractor page.
- Restoring a deleted contractor or adding a recycle bin.
- A persistent team model solely for name disambiguation.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — FR-1.1–FR-2.4 define the table, manager selection, deletion, and removal of contractor IDs.
- [x] **Testing strategy** — AR-2.3 and Expected Implementation Touchpoints cover migration, database, API, browser logic, and import regression tests.
- [x] **Existing patterns** — AR-2.1–AR-2.3 reuse the current SQLite, reconciliation, Express, and vanilla-DOM boundaries.
- [x] **Dependencies** — Specs 010 and 011 and the WorkDay import changes are explicitly related above; no new library is needed.
- [x] **Architecture & interfaces** — AR-2.1–AR-2.3 define data ownership, removed contracts, retained identity, and narrow mutations.
- [x] **Error handling & failure modes** — FR-1.2–FR-1.4 and FR-2.4 cover cancellation, validation, stale selections, failed deletion, and duplicates.
- [x] **Security review** — FR-2.4 requires origin checking, input validation, fixed safe errors, explicit projections, and DOM-safe rendering.
- [x] **Performance impact** — The table uses the local active-contractor list; the change removes reconciliation work rather than adding a high-volume path.
- [x] **Rollout & migration** — FR-2.3 and AR-2.1 define one idempotent, transactional table rebuild, its preserved data, and its intentional external-manager reset.
- [x] **Assumptions & risks** — Product Decisions records the Contractors-only UI rule, lack of a durable team model, external-manager outcome, and safe duplicate-name recovery.

## Changelog

- 2026-09-07: Initial draft created for contractor lifecycle management and manager-ID-free support.

---

## Change Log

### Update from manual user correction

**Applied:**

- Removed every contractor-owned WorkDay-ID, matching, link-status, review, candidate-selection, and identity-claim requirement.
- Changed table actions to Edit, Set line manager, and Delete.
- Specified that WorkDay IDs remain import-owned employee identities and are never displayed in the UI.
- Added removal/migration requirements for existing contractor WorkDay-link data and import API/UI contracts.

**Rejected:**

- Treating a team name as a manager identity key, because the current data model has no durable team field and it would make selection unreliable.

**Reorganized:**

- Replaced the contractor-linking feature with a simpler import-owned manager-identity feature and renumbered requirements.

### Update from UI-ID removal decision

**Applied:**

- Removed the remaining read-only WorkDay-ID disambiguator from manager choices.
- Required all manager labels and user-facing controls to stay human-readable and ID-free.
- Defined exact duplicate human labels as an unresolved, non-selectable state rather than a reason to display an ID or guess.

**Rejected:**

- Using a WorkDay ID in the UI as a fallback disambiguator, because IDs are never needed from a UI perspective.

**Reorganized:**

- Consolidated the no-ID rule into Product Decisions, manager-selection requirements, API requirements, constraints, and scope boundaries.

### Update from Spec 012 review

**Applied:**

- Defined the transactional existing-database migration: rebuild `employees`, remove obsolete contractor-link columns, recreate retained indexes, and verify foreign keys.
- Defined existing contractor external-manager assignments as `No manager` after migration; external-manager data itself is preserved.
- Scoped the no-ID display rule to the Contractors experience; Employee Details remains unchanged.
- Added a user-facing recovery message for exact duplicate human manager labels.

**Rejected:**

- A UI fallback to an opaque ID or automatic manager guess for exact duplicate names, because both violate the stated no-ID and safe-selection rules.

**Reorganized:**

- Integrated migration, legacy manager, UI-scope, and duplicate-recovery decisions into their affected requirements rather than adding a separate exception section.
