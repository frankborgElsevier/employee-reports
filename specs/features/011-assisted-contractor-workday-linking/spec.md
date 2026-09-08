# Spec 011: Assisted Contractor WorkDay Linking

> **Status: DRAFT** — follow-on to closed Spec 010.

## Overview

A contractor's manually selected line manager determines where they appear in
Headcount. It is independent of whether the contractor has been linked to a
row in a WorkDay workbook. The current experience treats every contractor
without an optional WorkDay worker ID as needing review, which incorrectly
suggests that the contractor's Headcount placement is broken and asks users to
know an opaque WorkDay ID.

This feature separates those concepts. A contractor with no WorkDay link is
validly **manually managed**, must remain visible beneath their selected line
manager in Headcount, and must not create an import-review warning. When a
user imports a workbook, the preview offers explainable candidate rows for
unlinked contractors. The user may explicitly link a candidate before they
confirm the import; the system then consumes that row as the contractor within
the same atomic import. It never auto-links on name, title, country, or a
similarity score.

## Goals

- Stop presenting a blank optional WorkDay ID as an error or review task.
- Preserve line-manager relationships and the existing Headcount hierarchy
  independently of WorkDay-link state.
- Help a user choose a WorkDay worker without knowing or typing its ID.
- Keep Spec 010's exact-ID, no-duplicate identity invariant.
- Make previewed counts and confirmed results agree, including selected links.

## Non-goals

- Automatically linking a contractor from matching names, positions, countries,
  managers, or fuzzy similarity.
- Deleting an imported employee, salary, rating, or manager-history record in
  order to link a contractor.
- Changing contractor-controlled identity details, worker type, or line
  manager from a workbook.
- Restoring the removed Headcount Team breakdown or changing any Headcount
  totals, filters, or organisation-chart layout.

## Product Decisions

- **Line-manager placement and WorkDay identity are separate.** A contractor
  with a saved line manager is correctly placed in Headcount whether or not it
  has a WorkDay link.
- A blank WorkDay ID means **Not linked to WorkDay**, not `Needs review`.
  It is informational and never contributes to the import action count.
- An existing non-blank WorkDay ID that is absent from the latest *confirmed*
  workbook means **Link needs attention**. This is the only contractor state
  that contributes to the post-import action count.
- An existing non-blank ID found in the latest confirmed workbook means
  **Linked in latest import**. A link is still exact and case-sensitive after
  trimming; suggestions do not alter that matching rule.
- The assisted flow is available while a workbook preview is pending, before
  confirmation. The user selects a candidate and confirms the import; the
  selected ID is saved and its workbook row is consumed in one transaction.
- Candidate recommendations are assistance only. The user must explicitly
  choose a candidate for each contractor; skipped contractors remain manually
  managed. No candidate is selected by default.
- A user-confirmed candidate may **claim** an existing imported record with
  the same WorkDay ID during confirmation. The imported record is retained as
  a hidden, superseded historical identity, never deleted or left active; the
  contractor becomes the sole active representation and consumes future rows.
  This narrowly supersedes Spec 010's cross-worker collision rule only for the
  selected candidate in this atomic workflow. Ordinary manual ID edits still
  reject every imported-employee collision.

## Feature 1: Make contractor link health truthful

**Who & why:** A report owner maintains contractor reporting lines manually.
They need confidence that a contractor who appears under the right manager on
Headcount is not being reported as broken merely because they lack a WorkDay
identifier.

### Functional requirements

#### FR-1.1: Separate link states from manager placement

The Contractor API and page expose a contractor's WorkDay-link health using
these labels:

| Stored WorkDay ID | Latest confirmed import | Display status | Import action count |
| --- | --- | --- | --- |
| blank | any / none | `Not linked to WorkDay` | no |
| non-blank | matching row found | `Linked in latest import` | no |
| non-blank | matching row absent | `Link needs attention` | yes |

The page separately renders the contractor's selected `Line manager`. The
Headcount API and organisation chart continue to derive placement only from
the stored manager relationship. No WorkDay-link status may move, hide,
demote, or otherwise change a contractor's Headcount card.

**Verify:** A contractor with no WorkDay ID and manager Luis remains beneath
Luis in Headcount and reads `Not linked to WorkDay` on Contractors. It does
not appear in the import action count. A contractor whose previously saved ID
is omitted from a later confirmed file reads `Link needs attention` while its
line manager and Headcount placement remain unchanged.

#### FR-1.2: Count only stale saved links as attention

Preview and confirmed-import results return the existing
`contractorsNeedingReview` field for compatibility, but its meaning changes:
it is the number of active contractors with a non-blank saved WorkDay ID that
would not match the relevant workbook. Blank IDs are excluded.

The Import screen renders the action only when this count is greater than zero:
`N contractor link(s) need attention. [Review contractor links]`. It does not
render an action for contractors that are simply unlinked. A successful import
with zero stale links renders no contractor warning or link.

**Verify:** Four manager-linked contractors with blank IDs and a successful
fresh import produce `contractorsNeedingReview: 0` and no contractor CTA. If
one contractor has saved ID `WD-4` and the workbook omits `WD-4`, preview and
confirmation each report one item and the result links safely to
`/contractors.html`.

#### FR-1.3: Replace raw-ID-first editing with guided language

The Contractors page explains that linking to WorkDay is optional and does not
affect a contractor's line manager or Headcount placement. For an unlinked or
attention-needed contractor it provides a clear `Link to WorkDay from an
import preview` affordance and tells the user to start a fresh import to see
candidates. It may retain a secondary `Enter WorkDay ID manually` disclosure
for an exceptional, known-ID case, but raw-ID entry is not the primary task and
must retain existing trimming, collision, and atomic manager-update safeguards.

The add form describes the ID as optional and must not call a new contractor
`Needs review` merely because the field is blank.

**Verify:** A new contractor with an empty ID is successfully created with
status `Not linked to WorkDay`; the screen says that their selected line manager
controls Headcount placement. A manual-ID validation failure preserves the
form values and uses the existing safe, actionable error wording.

### ASCII screen designs

#### Contractors — valid manually managed contractor

```
+-----------------------------------------------------------------------+
| Import    Headcount    Employee Details    Contractors                |
+-----------------------------------------------------------------------+

Florin Hangan                         Contractor
Position: Engineer     Country: Romania
Line manager: Luis Cunha                         <- Headcount placement

WorkDay link: Not linked to WorkDay              <- informational
Linking is optional. It does not change this contractor's line manager.

[ Link to WorkDay from an import preview ]  [ Enter WorkDay ID manually ]
```

#### Import result — no false warning

```
Import complete

Added: 12     Updated: 38     Inactivated: 1

[ View Headcount ]

No contractor review message is shown for contractors that are not linked to
WorkDay.
```

#### Import result — a saved link is stale

```
Import complete

Added: 12     Updated: 38     Inactivated: 1

1 contractor link needs attention.  [ Review contractor links ]
[ View Headcount ]
```

## Feature 2: Assist explicit WorkDay linking during import preview

**Who & why:** A report owner has a fresh WorkDay export but does not know its
internal worker IDs. They need the application to surface plausible rows,
while retaining final control because the consequence is identity linkage.

### Functional requirements

#### FR-2.1: Offer bounded, explainable candidates in the preview

On a successful preview, the Import page asks whether the user wants to link
any active contractor that is currently unlinked or whose saved link is absent
from the preview workbook. For each such contractor, it may show only rows
with the same normalized name (trimmed, case-insensitive, collapsed internal
whitespace). Each candidate displays its WorkDay worker ID, name, position,
and country, plus factual signals such as `same name`, `same country`, and
`same position`.

Candidates are ordered deterministically: more exact supporting signals first,
then normalized name, then WorkDay worker ID. The UI must make it clear that
similarity is a suggestion, not a match. If none exist, it says `No suggested
WorkDay records in this file`; it does not ask the user to invent an ID.

The candidate payload is limited to fields needed to identify and compare the
person (ID, name, position, country, and signals). It must not expose salary,
compensation ratio, bonus, ratings, or manager data.

**Verify:** A contractor named `Sam Taylor`, country `UK`, position `Engineer`
is shown workbook rows named `sam   taylor`, with clear country/position
signals. A similarly located `Alex Morgan` is not offered. No candidate is
preselected, and a contractor with no name match is shown a safe empty state.

#### FR-2.2: Require explicit selection and confirmation

For each contractor, the user may select at most one candidate or choose
`Keep unlinked`. A selected row becomes a **pending link selection** only; it
does not write a contractor ID, change contractor status, or alter employees
until the user clicks the existing `Confirm import` button.

The confirmation UI summarizes each proposed mapping as contractor name,
candidate name, and WorkDay ID, with an explicit statement that the selected
spreadsheet row will stay a contractor rather than be added as an employee.
The user may return to the preview and change or clear selections before
confirmation.

**Verify:** Selecting `WD-104` for Sam and abandoning the preview leaves Sam
unchanged. Selecting and confirming it persists `WD-104` on Sam, consumes the
`WD-104` row, and does not create imported employee `WD-104`.

#### FR-2.3: Preserve preview/confirm equivalence and integrity

The preview's counts, stale-link count, and candidate selections represent the
same retained workbook that will be confirmed. Changes to selections must
recalculate the preview counts before the user confirms, so the displayed
summary equals the eventual result unless the server reports a validation
failure.

At confirmation, the server re-parses the retained file and rejects the whole
operation without writes if any selection is malformed, expired, duplicated,
not present in that file, not eligible for that active contractor, or already
claimed by another contractor. A token is single-use as today. A failed or
expired preview neither changes contractor fields nor creates an employee
record.

When the selected ID already belongs to an imported employee, the confirmation
summary calls this out and requires the same explicit `Confirm import` action:
the existing imported identity will be retained as superseded history and no
longer appear as an active employee. It must never be deleted, and the
contractor's manually controlled fields and line manager remain authoritative.

**Verify:** A tampered worker ID, a duplicated candidate selected for two
contractors, a selection for an inactive/unknown contractor, and an expired
token all fail safely with no partial link or import changes. Selecting a
candidate whose prior imported identity exists retains that history as
superseded, removes it from active Headcount and Employee Details, and leaves
only the contractor active. Two simultaneous confirms still permit exactly one
successful commit.

### ASCII screen design

#### Import preview — explicit candidate selection

```
Preview ready

Will add: 11     update: 38     inactivate: 1
Contractor links needing attention: 0

Optional: link contractors to rows in this workbook
These are suggestions only. Review and choose a record before it is linked.

Florin Hangan — Not linked to WorkDay
  Line manager: Luis Cunha (unchanged)

  ( ) Keep unlinked
  ( ) Florin Hangan | Engineer | Romania | WorkDay ID WD-104
      Signals: same name, same country, same position

Sathish Ravi — Not linked to WorkDay
  No suggested WorkDay records in this file. [Keep unlinked]

  [ Update preview ]   [ Confirm import ]
```

#### Confirming a selected link

```
Confirm import

The following spreadsheet rows will remain contractors:
  Florin Hangan  <---  Florin Hangan (WorkDay ID WD-104)

Their line managers and contractor details will not change.
If an earlier import created WD-104 as an employee, it will be retained as
superseded history and will no longer appear as an active employee.

[ Back to preview ]   [ Confirm import ]
```

### Architectural requirements

#### AR-2.1: Extend the retained preview as the source of truth

Extend the pending-preview store to retain validated selected mappings and a
revision alongside its current file path and captured timestamp. A preview
selection update uses the existing retained token, validates it against the
retained workbook, computes a fresh rolled-back reconciliation, and returns
the revised counts and candidate projection. The browser must use that revised
token state, never calculate links or counts independently.

The pending upload remains process-local, one-at-a-time, single-use, and is
deleted after a successful confirmation, failed parsing, cancellation, or
expiry. Candidate data must not be persisted after this lifecycle.

#### AR-2.2: Apply mappings and reconciliation in one transaction

Refactor the import reconciliation boundary as needed so a caller can validate
and assign the selected contractor WorkDay IDs before contractor matching and
employee upsert run inside one database transaction. The selected rows are
therefore present in the exact contractor-ID map before reconciliation decides
which rows to consume.

Reuse the existing unique contractor-ID checks. Retain the imported-employee
collision check for every ordinary contractor create/update. In the selected
candidate path only, atomically supersede the same-ID imported employee before
the contractor claims the link. The transaction must roll back selected
mappings, supersession state, contractor latest-match statuses, employee
changes, salary/rating changes, and external-manager changes together when any
stage fails. Preview continues to use the same transaction path and rolls all
writes back.

#### AR-2.3: Compatible and narrow HTTP contracts

`POST /api/preview` retains its current success/failure shape and adds an
optional, typed contractor-link suggestion projection. Add an origin-checked
JSON endpoint for changing selections on a still-pending preview token, and
extend `POST /api/confirm` only as required to identify the selected preview
revision. Do not trust browser-provided candidate metadata or calculated
counts: the server derives candidates, validates contractor IDs and WorkDay
IDs, and recalculates the result from the retained workbook.

The server returns only fixed safe errors for malformed, stale, expired, or
conflicting selection requests. It must not reveal arbitrary worker records by
accepting a user-supplied search or ID lookup.

#### AR-2.4: Retain a superseded imported identity safely

Add an additive, non-destructive marker on imported employee records that have
been explicitly superseded by a contractor, including the owning contractor
ID. Fresh and existing databases receive an idempotent migration. Superseded
records remain available only to internal historical data access so existing
salary, rating, and referential history is not deleted; they are excluded from
active employee queries, Headcount, Employee Details, manager options, and
normal `getEmployeeById` supervisor resolution.

During all later imports, a workbook row whose ID belongs to a contractor
continues to be consumed and must not reactivate its superseded employee
record. Reassign the current workbook's reports for that row using the existing
contractor/unresolved-supervisor fallback, never to the superseded employee.
Clearing the contractor link leaves the superseded historical identity hidden;
reactivation or a different merge is a future explicit recovery workflow.

#### AR-2.5: Model status without conflating it with link presence

Retain the existing optional `workday_worker_id` and latest-match persistence,
but change the contractor projection to an explicit link-status value capable
of representing `not_linked`, `linked`, and `needs_attention`. Derive the
status from the optional ID plus latest confirmed-match result; do not add a
manager-dependent state. Migrate existing local data non-destructively and
preserve the current ID uniqueness index.

## Dependencies and affected areas

| Area | Relationship | Requirements |
| --- | --- | --- |
| [Spec 010](../010-contractor-reimport-and-headcount-simplification/spec.md) | **Modifies narrowly** — replaces its blank-ID review semantics and raw-ID-first experience; retains exact matching and normal no-conversion behavior, with a user-confirmed supersession exception. | FR-1.1–FR-1.3, AR-2.2–AR-2.5 |
| WorkDay preview/confirm | **Extends** — preview token lifecycle owns suggestions and explicit selections. | FR-2.1–FR-2.3, AR-2.1–AR-2.3 |
| Contractor Management | **Extends** — shows truthful link status and guided entry point while retaining manager editing. | FR-1.1–FR-1.3 |
| Headcount | **Regression dependency** — contractor placement remains manager-driven; removed Team breakdown remains absent. | FR-1.1 |

## Expected implementation touchpoints

| Path | Change |
| --- | --- |
| `src/import/reconcile.ts` | Separate unlinked from stale linked contractors; accept validated pending link mappings within the shared transaction. |
| `src/server/previewStore.ts` | Retain validated mapping selections and revision during the existing token lifetime. |
| `src/server/app.ts` | Add candidate/selection contracts, safe validation, and explicit contractor link-status projection. |
| `src/db/schema.ts`, `src/db/connection.ts`, `src/db/mutations.ts`, `src/db/types.ts`, `src/db/queries.ts` | Add superseded imported-identity persistence, transactional claims, and typed status while retaining normal collision rules. |
| `public/index.html`, `public/contractors.html`, `public/contractorLogic.js` | Render the preview picker, truthful language, and safe response validation. |
| `test/import/reconcile.test.ts`, `test/server/app.test.ts`, `test/server/contractors.test.ts`, `test/db/contractors.test.ts`, `test/contractors/contractorLogic.test.ts` | Cover state semantics, selection lifecycle, atomicity, collisions, and browser payload validation. |
| `specs/docs/domains/contractor-management/index.md`, `specs/docs/domains/workday-import/index.md`, `specs/docs/standards/import-http-api.md`, `specs/docs/standards/data-schema.md`, `specs/docs/spec-index.md` | Update living documentation and provenance when implementation lands. |

## Acceptance scenarios

1. **No false review:** Given four active contractors with blank WorkDay IDs
   and selected line managers, when a workbook is previewed and confirmed,
   then all remain placed beneath those managers, the contractor count is zero,
   and no review CTA appears.
2. **Stale saved link:** Given a contractor stored with `WD-9`, when the latest
   confirmed workbook omits `WD-9`, then the contractor is `needs_attention`,
   the result count is one, and their Headcount placement does not change.
3. **Explicit assistance:** Given an unlinked contractor and a normalized-name
   candidate in a pending preview, when the user chooses that candidate and
   confirms, then the ID is stored, its row is consumed as the contractor, and
   no imported employee with that ID is created.
4. **Skip is valid:** Given a suggested candidate, when the user keeps the
   contractor unlinked and confirms, then no ID is saved, that decision does
   not count as review, and the remaining workbook row follows normal employee
   import behavior.
5. **Atomic failure:** Given a malformed, stale, duplicate, or expired selected
   mapping, when confirmation is attempted, then no contractor link, employee,
   history, or status change persists.
6. **Existing duplicate claim:** Given a prior import already created active or
   inactive employee `WD-9` for an unlinked contractor, when the user selects
   `WD-9` in a later preview and confirms, then that employee is retained as
   superseded history, is absent from active Headcount and Employee Details,
   and the contractor becomes the single active identity for `WD-9`.
7. **Supervisor safety after claim:** Given current-workbook rows that name a
   claimed contractor ID as supervisor, when the import confirms, then those
   reports use the existing unresolved-supervisor/external-manager fallback and
   never link to the superseded employee record.
8. **No silent recovery:** Given a contractor whose claimed WorkDay ID is later
   cleared, then the superseded employee remains hidden and inactive; the
   application does not silently revive a second active person.

## Changelog

- 2026-09-07: Initial draft created from post-implementation user feedback on
  Spec 010. Chose preview-time explicit linking and non-destructive identity
  claims to preserve identity integrity for already-imported candidates.
