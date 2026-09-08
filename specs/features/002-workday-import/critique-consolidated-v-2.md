# Spec 002 (WorkDay Import Screen): Consolidated Critique (v2)

## Overview

**Critiques received from:** main-agent, codex (gpt-5.6-terra), claude (haiku)
**Critiques missing:** none — all three adapters returned findings.

This round critiques the spec *after* v1's fixes (scope-bounded
soft-inactivation replacing hard-delete, the two spec 001 prerequisites,
duplicate-ID/malformed-file/negative-bonus handling, upload hardening). The
verdict from all three independent reviewers: **v1's core safety mechanism
— "scope roots" detected via `getDescendants` — does not actually work**,
for reasons that go deeper than wording. This is a more serious finding
than anything in round 1, because it means the fix for the original
data-loss bug is itself broken in a related way.

## Executive Summary

Three reviewers, working independently, converged on the same structural
flaw: FR-2.2/FR-2.3's "scope root" mechanism infers a team's boundary from
the *current global manager hierarchy*, but that hierarchy can't actually
represent team boundaries reliably — an external supervisor id that already
exists in the database from a *previous* import (a different team, or the
same team re-scoped) makes `getDescendants(rootId)` walk into employees this
import has no business touching. A second, independently significant issue:
`reassignManager` (spec 001) throws when given a manager id that doesn't
exist, and FR-2.2's description of leaving `manager_id = NULL` "rather than
an error" doesn't explain how that's actually achieved without ever calling
`reassignManager` with the unresolvable id — as written, calling it with the
external id would throw, not silently succeed. A third new finding, from
codex: **AR-3.1/AR-5.2's spec 001 changes have no migration plan** — spec
001's schema is created via `CREATE TABLE IF NOT EXISTS`, which cannot alter
an already-existing table, and spec 001 is a *closed, implemented* spec, not
a blank slate.

## Consolidated Requirements Feedback

### The "scope root" mechanism doesn't work (main-agent + codex + claude — all three, independently)

**Issue:** Three separate, convergent explanations of the same underlying
problem:
- **Codex:** an external supervisor id absent from *this* file may already
  exist in the database from a *different* previously-imported team (or
  from this same team's own earlier import). `getDescendants(rootId)` then
  walks the *global* hierarchy from that id and can soft-inactivate
  employees who belong to that other team, not this one. Codex also notes
  the inverse failure: a *transfer* or *changed supervisor* can make a
  currently-employed person unreachable from any of this import's detected
  roots, so they're never reconciled at all — silently stale forever.
- **Claude:** questioned what `getDescendants` does when a scope root's
  identity is unclear, correctly sensing the mechanism doesn't have a solid
  foundation, even without fully deriving why.
- **Main-agent (rederiving independently):** an external id like Frank
  Borg's is never actually written as anyone's `manager_id` (it can't be —
  `employees.manager_id` has a foreign-key constraint to `employees.id`,
  and the external id was never inserted as a row), so every employee under
  him has `manager_id = NULL`, not `manager_id = '00000270149'`. Calling
  `getDescendants('00000270149')` — "find employees whose `manager_id`
  equals this string" — therefore returns **nothing**, every time. The
  mechanism as specified cannot find the very team it's meant to bound.
**Agreement:** Total, across three independent reviewers using three
different lines of reasoning. This is as strong a signal as this process
produces.
**Recommendation:** This needs a genuine redesign, not a wording fix. Two
directions, in order of preference:
1. **(Codex's suggestion, structurally correct for true multi-team support)**
   Persist an explicit, literal scope/ownership marker per employee —
   e.g. a new `employees` column recording which import established or
   last confirmed them (the detected external id, or an explicit team
   identifier) — and reconcile only employees carrying *that* marker,
   never inferred from the live manager graph. This is a **third**
   prerequisite change to spec 001, on top of AR-3.1 and AR-5.2.
2. **(Simpler, if multi-team import isn't actually needed soon)** Drop the
   scope-root mechanism entirely and go back to "scope = every currently
   active employee" (`getAllEmployees()`), soft-inactivating any active
   employee absent from the file — but add an explicit Constraint stating
   this spec assumes the database holds exactly one manager's team at a
   time, and that importing a second, different team is out of scope until
   a real scoping mechanism (direction 1) is designed. This is far simpler
   to implement correctly and honestly documents the limitation instead of
   shipping a mechanism that looks like it solves multi-team safety but
   doesn't.

### `reassignManager` throws on an unresolvable id — FR-2.2 doesn't say how this is avoided (claude, confirmed against code)

**Issue:** Spec 001's `reassignManager` calls `assertEmployeeExists(db,
managerId)` whenever `managerId !== null`, throwing `NotFoundError` if that
id isn't in the `employees` table — confirmed directly in
[mutations.ts](/Users/borgf/Documents/employee_reports/src/db/mutations.ts:77).
FR-2.2 says an unresolvable `Direct Supervisor ID` results in `manager_id =
NULL` "rather than an error," but never states that the import layer must
check whether the supervisor id resolves to an existing employee *before*
deciding what to pass to `reassignManager` — calling
`reassignManager(employeeId, "00000270149")` directly, as a literal reading
of FR-2.2 suggests, would throw immediately.
**Recommendation:** State explicitly: the importer checks (via
`getEmployeeById`) whether `Direct Supervisor ID` resolves to an existing
employee *before* calling `reassignManager`; if it doesn't, the importer
calls `reassignManager(employeeId, null)` — never passing the unresolved id
itself as the target.

### Spec 001's schema-change prerequisites have no migration path (codex)

**Issue:** AR-3.1 and AR-5.2 both say spec 001 must be updated, but spec
001's `initDatabase` runs `CREATE TABLE IF NOT EXISTS`
([schema.ts](/Users/borgf/Documents/employee_reports/src/db/schema.ts:1)) —
which does nothing to an already-existing table with the old
`rating_year` column. Spec 001 is marked `CLOSED - IMPLEMENTED`, not a
blank slate; "the prerequisite is spec 001's problem" (as the current
Change Log frames it) isn't sufficient, because spec 001's own migration
story (`CREATE TABLE IF NOT EXISTS` only, explicitly deferring any real
migration framework) doesn't cover a breaking column change to an existing
table.
**Recommendation:** When spec 001 is updated for AR-3.1/AR-5.2 (and the new
scope-ownership column, if direction 1 above is chosen), it needs an
explicit statement of what happens to a pre-existing `employees.sqlite`
with the old schema — at minimum, an explicit "incompatible database"
startup check that fails loudly rather than silently misbehaving, since a
full migration framework is out of scope for spec 001 by its own design.

## Additional Requirements Identified

- **Soft-inactivation overwrites the real departure date on repeated
  absence** (main-agent + claude, independently): FR-2.3 doesn't check
  whether an employee is already inactive before writing a new `end_date`.
  Every subsequent import an absent employee is (still) missing from
  re-runs the soft-inactivate step and bumps their `end_date` forward to
  that import's date. Fix: only write `end_date` when it's currently
  `NULL` (active → inactive transition only; never touch an already-inactive
  record).
- **Blank `Direct Supervisor ID` vs. a non-matching one** (main-agent):
  FR-2.2 should state that a blank cell leaves `manager_id = NULL` without
  being recorded as a scope root (there's no real id to bound descendants
  from), distinct from a non-blank value that just isn't a row in this file.
- **Decompression-bomb risk in AR-4.5's size limit** (codex): a 25 MB
  *compressed* `.xlsx` limit doesn't bound ExcelJS's in-memory decompressed
  size, since `.xlsx` is a ZIP container. Needs an uncompressed-size or
  ZIP-entry-count limit too, not just the compressed file size Multer sees.
- **Origin check silently allows a missing `Origin` header** (codex):
  AR-4.3's check only rejects a *present, mismatched* Origin — a request
  with no Origin header at all currently passes. Tighten to require Origin
  to be present and matching.
- **Import timestamp should be captured once, not read multiple times**
  (codex): FR-1.5's `effectiveYear` and FR-2.3's inactivation date should
  derive from one UTC instant captured at the start of the import, so a
  run spanning a UTC-midnight boundary doesn't write mismatched dates.
- **Cell-type and row-edge-case rules are still underspecified** (codex +
  claude): non-numeric/non-string cells in text fields, empty rows, rich
  text/formula/error cells, and whether ExcelJS's numeric `cell.value`
  actually preserves leading zeros for identifiers (codex specifically
  flags this may already be lost by the time `cell.value` is read — may
  need `cell.text` instead) all need explicit rules.
- **Empty (zero-row) file handling is undefined** (codex): a
  header-valid file with zero data rows currently "succeeds" and changes
  nothing — worth deciding explicitly whether that's acceptable or should
  be rejected as a safety measure (an accidentally-empty export is exactly
  the kind of file that, combined with a working scope mechanism, would
  otherwise mass-inactivate an entire team).
- **HTTP status contract is missing** (codex): define status codes for no
  file, wrong field name, Multer limit exceeded (`413`), malformed workbook,
  validation failure (`400`), unexpected error (`500`), alongside the
  existing `409` for concurrent imports.
- **"Added/updated/inactivated" counting doesn't define the already-inactive
  case** (codex, ties to the overwrite bug above): once fixed to skip
  already-inactive employees, this resolves naturally — but should be
  stated.
- **Duplicate scope roots aren't addressed** (claude): if the same external
  supervisor id is implied by multiple rows, state it's deduplicated to one
  root (only relevant if direction 2's simpler scope-less design isn't
  adopted).

## Ambiguities Requiring Clarification

- Which redesign direction to take for the scope mechanism (see above) —
  this determines whether a third spec 001 prerequisite (an explicit
  ownership column) is needed, or whether a documented single-team
  limitation is acceptable for now.
- Whether spec 001's eventual schema update should include a hard
  "incompatible database" guard, given it has no migration framework.

## Summary of Required Changes

1. **Redesign Feature 2's scope mechanism** — either add an explicit,
   persisted scope/ownership marker (new spec 001 prerequisite), or drop
   scope-inference entirely in favor of "all active employees" plus a
   documented single-team-at-a-time constraint. Blocking.
2. **Fix FR-2.2's manager-reassignment sequencing** — check
   `getEmployeeById` before calling `reassignManager`; never pass an
   unresolved id to it. Blocking (as currently written, it throws).
3. **Add a migration/compatibility statement** to accompany AR-3.1/AR-5.2's
   spec 001 changes, since `CREATE TABLE IF NOT EXISTS` cannot alter an
   existing table and spec 001 is already implemented.
4. **Fix the soft-inactivation overwrite bug** — only transition
   active → inactive; never rewrite an already-set `end_date`.
5. Clarify blank vs. non-matching `Direct Supervisor ID` handling.
6. Bound decompressed workbook size, not just compressed file size
   (AR-4.5); tighten the Origin check to require a matching header, not
   just reject mismatches.
7. Capture one import timestamp for both `effectiveYear` and inactivation
   dates.
8. Define cell-type/row-edge-case rules (blank rows, non-numeric text
   fields, ExcelJS `cell.value` vs. `cell.text` for identifiers) and an
   explicit HTTP status contract.
9. Decide and state explicit behavior for a zero-row file.
10. Correct the Rollout & Migration checklist item from `[N/A]` — it isn't
    N/A once a closed, implemented spec's schema is being changed.
