# Spec Review: 008-headcount-team-and-performance-filters

## Overview

Spec 008 adds a filter-aware, raw Location/Role/Count Team breakdown to
Headcount and adds performance outcome plus rating-recency filters to
Employee Details. The updated canonical-rating mapping resolves the previous
default-filter blocker while preserving the raw WorkDay rating text in the
table and API.

## Approach Summary

- Add a pure `locationRoleBreakdown(visibleEmployees)` export and render the
  resulting table from the existing visible, non-external worker set.
- Retain the current position-by-region matrix, chart, manager filtering, and
  Headcount API; the new breakdown is additive.
- Add fixed category/period metadata, canonicalize known source and legacy
  rating strings in browser logic, and use a pure performance matcher from an
  expanded `visibleRows()` signature.
- Permit missing historic ratings, require at least one matching selected
  period, and reject any populated selected-period mismatch.

The source workbook was verified to use the four requested categories. The
closed alias mapping is a proportionate compatibility layer for the existing
test vocabulary and is well justified.

## Risks

| Risk | Likelihood | Impact | Spec coverage |
| --- | --- | --- | --- |
| A future WorkDay rating label is not in the closed mapping and does not match a selected category. | Medium | Medium | Addressed: it stays visible as raw text, maps to `null`, and has a required test. |
| A populated historic rating excludes a worker despite a matching recent rating. | Medium | Medium | Addressed explicitly in FR-2.2; this is the confirmed selected-period policy. |
| The additional Headcount table could drift from the headline/matrix after future edits. | Low | Medium | Addressed by AR-1.1’s shared visible-real-worker input and pure aggregation. |
| The retained matrix plus the new table can be visually dense at narrow widths. | Medium | Low | Addressed by manual responsive verification; no data or behavioral risk. |

### Security

No new input surface, endpoint, external command, persistence, or sensitive
data exposure is introduced. Existing server-derived text continues through
the established `textContent` rendering path; authorization behavior remains
the application's existing local, single-user model.

## Complexity Hotspots

1. **Period matching — adequately specified.** The pure helper must correctly
   combine OR within a checklist, AND across checklists, allowed historic
   nulls, any populated mismatch, and the at-least-one-match rule. The spec
   provides concrete cases for each.
2. **Rating canonicalisation — adequately specified.** AR-2.1 fixes the
   mapping table, unknown-value outcome, and display/persistence boundary.
   Unit tests must cover every mapping row and unknown input.
3. **Headcount aggregation — adequately specified.** The code follows the
   existing `chart-logic.js` pure-function pattern; callers filter external
   placeholders first and tests cover contractors, ordering, zeros, and
   total equality.

## Completeness Checklist Audit

| Item | Status | Notes |
| --- | --- | --- |
| Scope & acceptance criteria | PASS | Atomic requirements and worked outcomes cover both pages. |
| Testing strategy | PASS | Covers mapping, nulls, selections, aggregation, and existing call-site updates. |
| Existing patterns compared | PASS | Reuses the browser pure-logic/thin-wiring split. |
| Dependencies justified | PASS | No dependencies added. |
| Architecture & interfaces | PASS | Exports, return shape, and expanded function signature are explicit. |
| Error handling & failure modes | PASS | Unknown mappings, empty selections, and zero breakdowns are handled. |
| Security review | PASS | No new surface and safe DOM rendering is retained. |
| Performance impact | PASS | Linear client-side aggregation/filtering at the existing scale. |
| Rollout & migration | N/A | No persistence/API change. |
| Assumptions & risks | PASS | Source vocabulary, aliases, and unknown-value behavior are explicit. |

## Verdict

**READY** — the canonical mapping resolves the prior contradiction, and the
spec now gives an implementer sufficient behavioral and test guidance without
requiring an import, schema, or API change. The ASCII mockup should show the
retained position-by-region table in a later visual polish pass, but its
omission is not an implementation blocker.

## Suggested Next Steps

Proceed with `/spec-implement 008-headcount-team-and-performance-filters`.
