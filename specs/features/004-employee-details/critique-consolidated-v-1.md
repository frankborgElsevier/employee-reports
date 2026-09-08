# Spec 004: Consolidated Critique (v1)

## Overview

**Critiques received from:** main-agent (Claude, full codebase cross-check),
codex (`gpt-5.6-terra`, read-only sandbox), claude (`haiku` adapter, `--print`
non-interactive).
**Critiques missing:** none — all three adapters completed successfully.

## Executive Summary

All three critiques independently verified the spec's codebase claims
(`src/db/queries.ts`, `src/db/types.ts`, `public/chart-logic.js`,
`src/server/app.ts`, spec 001/003) and found no factually false claim. The
spec is well-grounded in the real codebase and reuses existing, tested logic
(`buildTree`/`managerList`/`visibleIds`) correctly. The real issues cluster
into: one definite internal contradiction (payload key count), one
mismatched-terminology issue ("end-of-year" ratings), one dropped
inherited-convention rule (attribute-value XSS), several under-specified
comparator/tie-break/mapping rules, one accessibility gap, one impossible
example, and one overconfident performance claim. None require a redesign —
all are spec-text fixes.

## Consolidated Requirements Feedback

### FR-4.1: Payload key count is wrong

**Issue:** FR-4.1 defines the payload as `{ id, name, position, managerId,
currency, baseSalary, bonus, ratings }` — eight top-level keys — but its own
Verify line and the Testing Strategy checklist item both say "exactly the
seven top-level keys." (codex)
**Agreement:** Unanimous once flagged — this is a factual count error, not
an interpretation difference.
**Recommendation:** Fix the Verify line and checklist wording to say eight.

### Overview/FR-1.2: "Last three end-of-year ratings" mismatches the data model

**Issue:** The Overview and FR-1.2 borrow the roadmap's "end-of-year ratings"
phrasing, but spec 001's schema stores three relative, undated labels
(`"Most Recent"`, `"Prior Rating"`, `"Two Year Prior Rating"`) with no year or
date anywhere. "End-of-year" implies a calendar anchor the data doesn't have.
(codex)
**Agreement:** Confirmed against `src/db/types.ts` and spec 001 FR-3.1 —
no divergence.
**Recommendation:** Reword to "last three rating periods" or similar,
dropping "end-of-year" language inherited uncritically from the roadmap.

### FR-4.2: The `rating_period` → payload-key mapping is never stated

**Issue:** `getLastRatings` returns an array that *omits* absent periods
(spec 001 FR-3.2), but FR-4.1's payload needs three independently-nullable,
named keys (`mostRecent`/`priorRating`/`twoYearPriorRating`). Turning one
into the other requires an explicit `rating_period` string → camelCase key
mapping that FR-4.1/FR-4.2 never states — the one real data-shaping step the
endpoint performs, understated by FR-4.2's "composes existing functions...
no new SQL" framing. (main-agent, echoed independently by claude's "ambiguous
rating period mapping" and "no explicit... mapping" findings)
**Agreement:** All three raised a version of this; strongest, most detailed
version is main-agent's.
**Recommendation:** Add a sentence to FR-4.2 requiring this mapping
explicitly, filling absent periods with `null`.

### AR-1.1: XSS rule silently drops the attribute-value half of the project's own convention

**Issue:** AR-1.1 covers text nodes (`textContent`) but not attribute values,
even though it explicitly frames itself as extending spec 003 AR-1.4 "to
`currency` and `ratingValue`." Spec 003 AR-1.4 and
`specs/docs/conventions/browser-screens.md` both require attribute values
(`setAttribute`, never template-string-built) as part of the *same* rule.
This matters concretely: FR-2.1/FR-2.2's checkboxes need to turn free-text
`position` and `name` (via `managerList()`'s `Name (id)` labels) into
checkbox attributes. (main-agent)
**Agreement:** Not raised by the other two adapters, but verified directly
against the convention doc and spec 003's shipped AR-1.4 — this is a real,
checkable omission, not a matter of opinion.
**Recommendation:** Restate the attribute-value rule in AR-1.1 explicitly,
the way spec 003 did, rather than relying on the reader to consult the
convention doc separately.

### FR-3.1/FR-3.2/FR-2.1: Sort comparator and tie-break rules are underspecified

**Issue:** Three distinct gaps, all raised by at least two adapters:
1. "Lexicographic"/"alphabetical" never states whether string comparison
   uses `localeCompare` (used by `chart-logic.js`'s own `byNameThenId`) or a
   plain binary/`<` compare (used by SQLite's default collation in
   `getAllEmployees`'s `ORDER BY id ASC`) — these can diverge on case and
   locale for `name`/`position`/`currency`/rating-value columns.
   (main-agent, codex)
2. FR-3.1 defines a tie-break (`id` ascending) only for the *initial* load
   sort. No tie-break is defined once the user clicks a header and ties
   occur on the clicked column. (main-agent, claude, codex)
3. Sorting rating-value columns alphabetically doesn't reflect rating
   *quality* (the scale is unknown per spec 001), which is fine given
   FR-3.3's missing-last rule already serves the "who's overdue a review"
   use case, but the spec doesn't say so. (main-agent)
**Agreement:** Strong — the comparator and tie-break gaps were each raised
independently by at least two of the three adapters.
**Recommendation:** Pick one comparator (recommend `localeCompare`, for
consistency with the `chart-logic.js` code being reused for the manager
filter on the same screen) and state it once; add "name ascending, then id
ascending" as the universal tie-break for every user-initiated sort, not
just the initial load; add a one-line note that within-group rating-column
order is presentation-only, not a quality ranking.

### FR-3.1: Sortable headers aren't required to be keyboard-operable

**Issue:** FR-3.1 requires `aria-sort` and cites "the WAI-ARIA
table-sorting pattern" by name, but that pattern expects a keyboard-operable
control (typically a `<button>` inside the `<th>`) — a bare click handler on
a `<th>` satisfies every stated Verify line while being unusable via
keyboard. Spec 003 has an explicit Constraints entry scoping out full
keyboard/screen-reader auditing; spec 004 has no equivalent, so it's unclear
whether the gap here is deliberate. (main-agent, codex — independently and
in near-identical terms)
**Agreement:** Unanimous between the two adapters that raised it.
**Recommendation:** Either require a keyboard-operable sort control
(consistent with the pattern FR-3.1 already cites) or add an explicit
accessibility-scope Constraint mirroring spec 003's, so the omission reads
as a decision rather than an oversight.

### FR-2.5: The "manager-only zero results" example is impossible as written

**Issue:** FR-2.5's Verify line implies unchecking every manager checkbox
alone can leave zero visible rows, but `visibleIds()` (reused unchanged,
FR-2.3) always keeps roots visible — a non-empty valid hierarchy always has
at least one root (spec 003 FR-1.4's invariant, inherited here). Reaching
zero rows requires the position filter too. (codex)
**Recommendation:** Correct FR-2.5's example so it combines both filters
(or explicitly filters out every position) rather than implying the manager
filter alone can zero out the table.

### AR-2.1: "Superset shape" wording slightly overstates what `Employee` carries

**Issue:** AR-2.1 says employee-details objects are "a superset" of the
`{id, managerId, name}` shape `chart-logic.js` expects, carrying "additional
position/salary/rating fields" — but salary and rating data isn't on the
`Employee` type at all; it's merged in by the endpoint from three separate
query calls (`getAllEmployees`, `getCurrentSalary`, `getLastRatings`).
(claude)
**Recommendation:** Minor wording fix — state that the endpoint merges three
data sources into one payload object, which happens to be a superset for
`chart-logic.js`'s purposes; the current phrasing is not wrong about
`chart-logic.js`'s tolerance, just imprecise about where the extra fields
come from.

### FR-4.2/Constraints: The "low milliseconds" performance claim overstates certainty

**Issue:** Constraints asserts the N+1 query pattern "keeps even hundreds of
extra single-row lookups in the low milliseconds," stated with more
confidence than the spec's own Assumptions & Risks section, which calls the
identical claim "not... measured against real data volume beyond the ~43-row
reference file." Separately, `getCurrentSalary`/`getLastRatings` call
`getConnection().prepare(...)` fresh on every invocation rather than caching
a prepared statement, adding `2N` parse-and-plan operations spec 004 is the
first spec to actually trigger in a loop. Codex additionally notes no
benchmark or threshold is defined for when the N+1 pattern would need
batching, at spec 002's stated 5,000-employee ceiling. (main-agent, codex)
**Agreement:** Both adapters flagged this; main-agent's framing (internal
tension between Constraints and Risks wording) and codex's framing (no
defined threshold) are complementary, not conflicting.
**Recommendation:** Soften the Constraints wording to match the Risks
section's hedging, mention the per-call statement-preparation cost, and
either add a rough threshold/action ("if headcount reaches N, batch these
calls") or downgrade the Performance checklist item to `[ ]`/unverified,
matching spec 001's own honest precedent for the identical "real volume
unknown" situation.

### AR-4.1/Constraints: Sensitive-data exposure could use a caching note

**Issue:** Unlike the headcount endpoint, this one serves salary and rating
data unauthenticated. The accepted-risk framing is already honest and
consistent with spec 002/003's precedent, but codex suggests adding
`Cache-Control: no-store` so compensation/rating responses aren't retained by
a browser or intermediate proxy cache, and flagging that binding to
`127.0.0.1` + no CORS doesn't protect against other local users/processes on
a shared machine. (codex)
**Recommendation:** Low-cost addition — add a one-line AR requiring
`Cache-Control: no-store` on this response; note the shared-machine caveat in
Constraints alongside the existing accepted-risk statement.

## Additional Requirements Identified

- FR-4.1 should get an explicit endpoint-level Verify case for the
  empty-database `{ employees: [] }` response, not just prose — mirrors an
  identical, pre-existing gap in spec 003 FR-3.1, so not a new problem, but
  worth closing while this endpoint is being written anyway. (main-agent)
- FR-4.4 (fetch failure) should explicitly cover a syntactically-valid but
  malformed payload (missing `ratings`, wrong types) as the same load-failure
  path, not just non-`200`/network/parse errors. (codex)
- Verify lines for FR-4.1/FR-1.3 should add explicit cases for: an employee
  with no salary row (all three salary fields null), an employee with only a
  `"Most Recent"` rating (other two null), and confirmation that `managerId`
  is actually present in the response (currently asserted only implicitly).
  (claude)

## Ambiguities Requiring Clarification

- Whether a `salary_history` row can ever have some but not all of
  `currency`/`baseSalary`/`bonus` present (claude raised this; per spec 001's
  schema, `currency` and `base_salary` are `NOT NULL` and `bonus` defaults to
  `0`, so a row is genuinely all-or-nothing already — this is more a
  "worth a one-line citation of that schema guarantee" than an open
  question).
- FR-4.2's Verify line ("the route handler calls only functions already
  exported from `src/db/index.ts`") is a code-structure assertion, not a
  behavioral one, and can't be automated as a `node:test` case the way every
  other FR's Verify line can — worth flagging since the checklist implies
  uniform automated coverage. (main-agent)

## Summary of Required Changes

1. Fix FR-4.1's Verify line and the checklist to say **eight** top-level
   payload keys, not seven.
2. Reword "last three end-of-year ratings" (Overview, FR-1.2) to avoid
   implying a calendar anchor the schema doesn't have.
3. Add the explicit `rating_period` → camelCase-key mapping requirement to
   FR-4.2, including the absent-period-fills-with-`null` rule.
4. Restate AR-1.1's attribute-value XSS rule explicitly (text nodes *and*
   attribute values), matching spec 003 AR-1.4 and the project's
   `browser-screens.md` convention.
5. Specify the sort comparator (`localeCompare`, for consistency with reused
   `chart-logic.js` code) once, and add a universal tie-break
   (name-then-id) for every user-initiated sort, not just the initial load.
6. Require keyboard-operable sortable headers, or add an explicit
   accessibility-scope Constraint mirroring spec 003's if that's
   intentionally out of scope.
7. Fix FR-2.5's example so it doesn't imply the manager filter alone can
   zero out the table.
8. Clarify AR-2.1's wording: the payload merges three query sources; it
   happens to be a superset of what `chart-logic.js` needs.
9. Soften the Constraints performance claim to match the Risks section's
   existing hedging, note the per-call statement-preparation cost, and add
   a rough action threshold or downgrade the checklist item to unverified.
10. Add `Cache-Control: no-store` to the endpoint's response and note the
    shared-machine caveat alongside the existing accepted-risk statement.
11. Add the endpoint-level empty-database Verify case, the malformed-payload
    failure-path statement, and the missing-salary/partial-rating Verify
    cases listed under Additional Requirements Identified.
