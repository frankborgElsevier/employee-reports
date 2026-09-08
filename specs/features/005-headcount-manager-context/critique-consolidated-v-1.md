# Spec 005: Consolidated Critique (v1)

## Overview

**Critiques received from:** main-agent (Sonnet 5, this session), Codex (`gpt-5.6-terra`, read-only, repo-aware), Claude (`haiku`, non-interactive, repo-aware)
**Critiques missing:** none — both external adapters ran successfully.

**Note on process:** unlike a typical v1 critique cycle, the spec has already been revised in place to fix every issue below, rather than left for a separate `/spec-update` pass. The blocking issue (below) was a concrete, unambiguous design flaw — not a judgment call needing user input — so fixing it before presenting the spec avoided handing over a document known to be broken. If you want a fresh, independent look at the *revised* spec, re-run `/spec-write --critique-only specs/features/005-headcount-manager-context/spec.md -v 2`.

## Executive Summary

Both external critics independently found the same blocking flaw: the original spec claimed an employee's `managerId` would "point to" the new external-manager entry, but `employees.manager_id` has an `ON DELETE RESTRICT` foreign key to `employees(id)`, and reconciliation already nulls it out for any unresolved reference — there was no way for that link to exist under the stated design. Both critics also independently flagged that the tie-break logic (FR-2.3, now FR-2.2) implied information the reconciler doesn't have unless it aggregates the whole import batch first, that the visual "external" marker wasn't concretely specified, and that the `totals()`/`isExternal` filter wasn't pinned down. All of these have been fixed in the spec now on disk.

## Consolidated Requirements Feedback

### Data model / linkage (blocking — fixed)

**Issue:** Reports of an external manager cannot carry that manager's id in `manager_id` (FK constraint), and the spec never said where else that link would live.
**Agreement:** Codex and Claude both flagged this independently, with near-identical reasoning (both cited `reconcile.ts:62` and the FK on `manager_id`).
**Divergence:** none.
**Recommendation (applied):** added a new nullable `employees.external_manager_id` column with its own FK to the new `external_managers` table. `manager_id` is never touched for an unresolved reference — exactly as today. The two links are unified into one `managerId` field only at the `/api/headcount` read boundary, so the client-side tree code (`buildTree`/`isRoot`/`visibleIds`) needs no changes, which was the spec's original intent.

### Aggregation before write (fixed)

**Issue:** FR-2.3 (now FR-2.2)'s tie-break ("most frequent name") requires seeing every row for a given unresolved id before picking a winner, but the spec described a per-row write loop with no aggregation step.
**Agreement:** both critics raised this.
**Recommendation (applied):** reconciliation now runs an explicit aggregation pass (group by unresolved id, pick winner, write exactly one `external_managers` row per id) *before* the existing per-row manager-reassignment loop, with the write order stated explicitly to satisfy `PRAGMA foreign_keys = ON`.

### Visual marker and null-field rendering (fixed)

**Issue:** "a dashed border, e.g." was not a testable requirement, and it wasn't stated whether `position`/`country` render as empty elements or are omitted for an external card.
**Recommendation (applied):** specified a concrete `card external` CSS class plus a fixed visible text label (`(not in imported data)`) so the state is conveyed as text, not color/border alone (consistent with spec 003's existing FR-1.7 rule) — and stated `renderCard` omits the position/country lines entirely rather than rendering them empty.

### `totals()` / `isExternal` filter (fixed)

**Issue:** FR-2.6 said totals must exclude external entries but didn't say where the filter lives.
**Recommendation (applied):** the filter is applied by `headcount.html` at the call site, before invoking `totals()`; `totals()` itself is unchanged.

### Import file references and optional-header mechanics (fixed)

**Issue (Codex):** the spec named `mapping.ts` as the row-mapping site; row mapping actually happens in `parseWorkbook.ts` (`mapping.ts` only holds constants). Optional-column detection and duplicate-header handling for the new column were unspecified.
**Recommendation (applied):** corrected file references throughout; specified that the existing `headerToColumn` map already provides optional-column detection, and generalized the existing duplicate-header rejection to cover this one optional header.

### Scope/ambiguity clarifications (fixed)

- TeamSize now explicitly always reflects the full roster from the page's single `/api/headcount` load, never the checkbox-filtered subset (Claude + reasoning from FR-1.1's original silence).
- `managerList()`'s "unaffected" language was ambiguous against the fact that an external manager, once present, will naturally appear as a checkbox option; reworded to distinguish "ordering rule unchanged" from "content correctly gains the new option."
- Self-healing behavior specified for the case where a previously-external manager is later imported as a real employee (their reports' external link clears and `manager_id` is reassigned normally on that import).
- A defensive de-dup guard added to the `/api/headcount` merge in case an external id ever coincides with a real employee id (should not happen in steady state given self-healing, but stated explicitly rather than left implicit).
- `teamSizes`' contract was undefined (which parameters, computed how often); pinned down as a fourth field returned by the existing `buildTree` call, computed once per call, O(n).

## Additional Requirements Identified

- FR-2.1 now explicitly requires whitespace-only supervisor-name cells to be treated as blank (`null`), reusing the existing `isBlankCell` pattern already applied to `Direct Supervisor ID`.
- FR-2.2's tie-break is now fully deterministic: case-sensitive `localeCompare` on the trimmed full string, both for "most frequent" and for the tie-break itself.
- Checklist's Rollout & migration item now explicitly calls out the need for an `ALTER TABLE employees ADD COLUMN external_manager_id ...` step (idempotency-guarded) alongside the existing `CREATE TABLE IF NOT EXISTS` schema application, and the FK write-ordering constraint under `PRAGMA foreign_keys = ON`.

## Ambiguities Requiring Clarification

None outstanding — every ambiguity raised by either external critic has a corresponding fix in the spec now on disk. One item is a deliberate, stated non-goal rather than an open question: an employee whose manager reference resolves to a real but currently-*inactive* employee is **not** fixed by this spec (their reports still render as disconnected roots) — this is called out explicitly in Out of Scope as a distinct, pre-existing gap from the "never-imported" case this spec addresses.

## Summary of Required Changes

All changes below are already applied to `spec.md`:

1. Added `employees.external_manager_id` column + `external_managers` table; unified into a single `managerId` field only at the API boundary.
2. Split reconciliation into an aggregation pass (name tie-break, one write per id) followed by the per-row link, in FK-safe order.
3. Corrected file references from `mapping.ts` to `parseWorkbook.ts` for row-mapping logic; specified optional-column detection and duplicate-header handling.
4. Specified the external-card visual marker (CSS class + text label) and null-field rendering (omitted, not empty).
5. Specified where the `isExternal` filter for `totals()` lives.
6. Specified `teamSizes`' exact contract (a `buildTree` return field).
7. Specified deterministic `/api/headcount` array ordering (real employees first in existing id order, external managers appended, sorted by id) and a defensive collision guard.
8. Specified self-healing behavior when an external manager is later imported as a real employee.
9. Clarified TeamSize's data-freshness scope, `managerList()`'s emergent inclusion of external managers, and the tie-break's exact comparison rule.
10. Called out the inactive-manager gap as explicit, deliberate Out of Scope rather than leaving it unaddressed.
