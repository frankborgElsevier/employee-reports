# Spec 006: Consolidated Critique (v1)

## Overview

**Critiques received from:** main-agent (Opus, deep code/workbook verification), codex (gpt-5.6-terra), claude-haiku.
**Critiques missing:** none — all three adapters completed.

## Executive Summary

All three critiques agree the spec's factual claims (reference-file numbers, FR/AR citations, function/file names) check out, and that the FR-3.1 token classifier is correct as written. The main-agent critique is by far the most rigorous — it actually re-derived the 14-position classification against the live workbook and traced the isolation algorithm through concrete fixtures — and surfaces five genuine implementation blockers the other two adapters only gestured at (positionRegionBreakdown's shape, visibleRows' signature, compRatio's payload position, the pivot table's markup/CSS, and the fact that this spec's checklist calls existing-test edits "extensions" when they're actually breaking changes). All three independently flagged: the token-classifier's edge cases (bare "Senior" with no numeral), the compa-ratio-cell-type validation gap, and citation-qualification hygiene.

## Consolidated Findings & Resolution

### Blockers (all applied)

| # | Finding | Resolution |
| - | - | - |
| B1 | `visibleRows`'s new parameter (name, position, required/optional) was never fixed; 5 existing test call sites depend on it | Fixed signature: `visibleRows(employees, selectedPositions, selectedManagerIds, rootManagerIds)`, 4th param required. Existing 3-arg test calls must be edited, stated explicitly. |
| B2 | `positionRegionBreakdown`'s return shape was undefined | Added a literal example object (bands/rows/totals) to AR-3.1. |
| B3 | `compRatio`'s payload key position, and the two arrays in `employee-details.html` that must both change, were unstated | FR-2.3/FR-2.4 now name the exact insertion point and both arrays (`COLUMNS`, `renderRow`'s `values`). |
| B4 | New pivot table has no markup or CSS spec, and reusing `.card.*` classes on a `<th>` would be wrong (they carry card box-model, not header styling) | Added explicit column headers/band-header-row/totals-row-label text to FR-3.4, and a new AR-3.4 for dedicated header CSS (background-color only, not `.card`). |
| B5 | Spec presented existing-test edits as "extensions"; `test/server/employeeDetails.test.ts`'s exact-eight-key assertion and spec 004 FR-4.1's own "eight-key" wording become false | Testing Strategy checklist item now names the specific assertions that must be *edited*, not extended alongside. |

### Isolation-algorithm findings (applied)

- **C1** (codex/main-agent): the single most common interaction — unchecking exactly one manager — had no Verify line. Added, with the arithmetic (30 visible, 13 hidden).
- **C2** (main-agent): FR-1.2's original Verify held isolation mode *off* (all root managers checked) while its own Risk note claimed it proved the isolated case. Rewrote the fixture to actually exercise isolation-on with a nested manager unchecked, per the main-agent's suggested combination (A checked/B unchecked/X unchecked → A, B visible; C, X, Y hidden), and to show the contrast with isolation-off explicitly.
- **C3** (main-agent): the visibility rule was phrased ambiguously between "seed traversal from checked roots" and "seed from all roots, then suppress" — they coincide only incidentally today. Restated as a traversal-seed rule directly.
- **C4** (main-agent): `isolateUnselectedRoots` reads backwards (says the opposite of what it does). Renamed to `requireRootSelection`.
- **C5** (main-agent): reusing the generic zero-rows message for all-managers-unchecked was a silent decision. Stated as an explicit choice.
- **C6** (main-agent): FR-1.1's single-manager Verify never stated the row count (9). Added.

### Classifier findings (mostly applied)

- **C7** (codex/main-agent): empty tokens from leading/trailing separators weren't addressed. Added "drop empty pieces" to the tokenization rule.
- **C8** (main-agent): a bare "Senior Software Engineer" (no numeral) falls to Other — the single most likely real-world title to be missed, understated in the original Risk note (which only covered wording variants). Named explicitly in Assumptions & Risks.
- **C9** (main-agent): Senior 1/2 are job-family-agnostic while Software Engineer 1/2 are name-specific — asymmetric and previously unexplained. Stated as deliberate in FR-3.1.
- **C10** (main-agent): Lead's match-priority (rule 2, outranks Principal/Senior) doesn't match its render position (between Principal and Senior Principal) with no stated rationale. Added a sentence distinguishing match-priority order from display order.
- **C11** (main-agent): unclear whether the band constant holds labels, keys, or both. Stated: the same string serves as both.
- **Unicode/regex precision** (codex): stated the tokenization is ASCII alphanumeric vs. non-alphanumeric — accepted as the practical scope given the reference data; not deepened further, since this project's existing `localeCompare`-based sorting already accepts locale edge cases without special-casing.

### FR-3.3/FR-3.4/D1/D2 findings (applied)

- **C12** (main-agent): FR-3.3's "zero visible employees in every bucket" clause was vacuous (unreachable given `countryBucket`'s green default and FR-3.1's derive-from-visible-set design) and, worse, this is exactly *why* the grand-total-agrees-with-headcount claim holds — restated as such rather than deleted with no explanation.
- **D1** (main-agent): the all-bands-empty state (reachable after spec 005's external-manager checkbox is unchecked) had no rendering rule. Specified: header + a zeroed totals row, no extra message.
- **D2** (main-agent): `positionRegionBreakdown`'s input contract didn't exclude external-manager entries (`position: null`), which would throw inside `classifyPositionBand` and crash the whole page via the existing catch-all. Stated as an explicit precondition, mirroring the existing `isExternal` filter `renderTotals` already applies before calling `totals()`.

### Feature 2 findings (applied)

- **D3** (main-agent, independently flagged by codex): a present-but-non-numeric compa-ratio cell (formula, error, text) was unaddressed, and the reference file has zero such cells so no derived test would catch a wrong default. Decided explicitly: reject the import, matching the type-check precedent `Direct Supervisor Name` (the other optional column) already sets, rather than silently degrading to `null`.
- **D4** (codex): no plausibility ceiling beyond finite/non-negative — stated as an accepted, unverified stance, matching this project's existing precedent for other unverified assumptions.
- **D5** (main-agent): the raw-ratio-vs-percentage-display divergence from WorkDay's own cell format was undocumented and would read as a bug to a reviewer comparing screens. One sentence added.
- **D6** (main-agent): the "salary row exists, `comp_ratio` NULL" state was verified only at the DB layer, not through the API or table. Added Verify cases to FR-2.3 and FR-2.4.
- **D7** (main-agent): that mixed state needs a synthetic fixture, since all 43 reference rows carry a comp ratio. Stated explicitly, matching spec 004's own precedent for scenarios the reference file can't produce.
- **D8** (main-agent): `validateSalaryRecord` (where FR-2.2's check actually has to live) wasn't named; the "any existing 5-arg caller now writes NULL" consequence wasn't stated as intended. Both added to AR-2.2.

### Citation/reference hygiene (applied)

- **C13**: qualified every previously-bare `FR-x.y`/`AR-x.y` cross-reference that collided with spec 006's own numbering (spec 004 FR-2.5, FR-3.2, FR-3.3; spec 002 FR-1.5; spec 003 FR-2.1, AR-1.2, AR-2.3).
- **C14**: added spec 005's AR-2.4 (superseded "no changes to `visibleIds`" claim) and FR-2.6 (the `isExternal` filter this spec's Feature 3 reuses at the same call site) to the Related Specs row's Affected Requirements.
- **C15**: corrected the AR-2.1 migration citation to match how `connection.ts` itself cites the pattern (AR-2.1/ADR-001 pairing), rather than citing spec 005 AR-2.1 alone.
- **C16**: fixed two Out-of-Scope column names to their exact headers (`Base Pay Range (1 FTE)`, `Total Target Cash Range (1 FTE)`).

### Performance (applied)

- **E1** (main-agent): AR-1.1's "e.g." phrasing left the root-manager precompute optional; read literally, the suggested approach triples `buildTree` calls per refresh. Made the precompute-once-at-page-load mandatory.
- **E2** (main-agent/codex): `positionRegionBreakdown` is `O(n + p log p)` (it sorts within bands), not "a single pass." Corrected.

### Security (applied)

- Added: a compa ratio is more directly cross-comparable (position-in-range, currency-independent) than raw salary, making peer comparison easier — noted as a one-line addition to the security framing rather than asserting strict equivalence to existing salary exposure.
- Added: the new pivot table's `position` strings and band/header labels must go through `element(...)`/`textContent`, matching spec 003 AR-1.4 — previously unstated for this new table.

### Checklist honesty pass (applied)

- Fixed "8 explicit exclusions" → 9 (miscount).
- Fixed "seven named seniority bands" → eight (including Other) in Assumptions.
- Removed/resolved the FR-1.2 Risk bullet that claimed a fixture proved something it didn't (C2 fixes the fixture itself, so the risk no longer applies).
- Rewrote Testing Strategy, Architecture & Interfaces, Error Handling, Performance, and Security checklist items to reflect the above, so each `[x]` is honestly supported by the body text it claims to summarize.
- Noted (Architecture & Interfaces) that this spec touches no `specs/docs/` living-doc file directly, though several describe behavior it changes — flagged for implementation-time update, matching spec 005's own precedent.

## Rejected

- **Deriving level bands from WorkDay's `Management Level` column instead of token rules** (would require new import work the user's answered clarifying question already declined).
- **Adding an un-numbered "Senior" fallback tier for C8's bare-"Senior" case** — out of scope creep beyond the seven bands the user named; documented as a known risk instead.
- **Providing the multi-level test fixture as literal code in the spec** — rejected per this project's established WHAT-not-HOW convention (spec 004's critique history explicitly rejected the same class of request: "a non-normative implementation sketch... this project's spec-writing convention is WHAT-not-HOW"). The fixture is now fully described in prose (ids, relationships, checkbox states, expected visible set) instead.
- **Exact regex literal for tokenization** — described precisely enough in prose (split on non-alphanumeric runs, lowercase, drop empty pieces) without pinning a specific `RegExp` object, consistent with how this project's other specs describe string-matching rules (e.g. spec 003 AR-1.2's country-bucket mapping) without regex literals.
- **A dedicated empty-state message for the all-bands-empty pivot table (D1)** — the zeroed totals row already communicates the state; a redundant message would be inconsistent with FR-2.6's existing "removed, not shown as zero" philosophy, which this spec's D1 resolution already extends to its logical limit.

## Summary of Required Changes

1. Fix `visibleRows`'s signature and rename the isolation flag (B1, C3, C4, E1).
2. Specify `positionRegionBreakdown`'s literal return shape and its external-manager-exclusion precondition (B2, D2).
3. Fix `compRatio`'s payload position and the two `employee-details.html` arrays that must move together (B3).
4. Specify the pivot table's headers, band-row markup, totals-row label, and dedicated (non-`.card`) header CSS (B4, new AR-3.4).
5. Correct the Testing Strategy checklist item to disclose required test edits, not "extensions" (B5).
6. Add the missing Verify lines: FR-1.1's common one-manager-unchecked case, FR-1.2's actually-isolated nested case, FR-2.3/FR-2.4's mixed-null-comp-ratio state, FR-3.3's empty-table state.
7. Decide and state: non-numeric present compa-ratio cell rejects the import (D3).
8. Fix all citation qualification issues, the migration citation, and the two Out-of-Scope column names (C13–C16).
9. Correct Performance/Security/Assumptions checklist wording and counts throughout.
