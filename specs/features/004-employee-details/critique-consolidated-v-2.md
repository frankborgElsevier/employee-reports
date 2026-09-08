# Spec 004: Consolidated Critique (v2)

## Overview

**Critiques received from:** main-agent (Claude, full codebase cross-check
of every v1 fix), codex (`gpt-5.6-terra`, read-only sandbox), claude
(`haiku` adapter, `--print` non-interactive).
**Critiques missing:** none — all three completed successfully.

This is a re-review after v1's consolidated feedback was applied via
`/spec-update`. All three adapters were asked to verify the v1 fixes landed
correctly and completely, and to surface anything new the edits introduced
or missed — not to re-litigate settled points.

## Executive Summary

All eleven v1 fixes are present and, with one exception, complete and
internally consistent — confirmed independently by all three adapters, and
verified by main-agent directly against the source (`byNameThenId`'s actual
implementation, `visibleIds()`'s root-always-visible logic, the
`RATING_PERIOD_ORDER_SQL` mapping order, the Out of Scope recount). The one
incomplete v1 fix — FR-4.4's malformed-payload branch got prose but no
matching Verify case — was independently caught by **both** main-agent and
codex, making it the clearest, highest-confidence finding this round. The
rest are smaller, mostly-new gaps: a missing Verify case for the new AR-4.4
cache header, a DOM-identifier-safety gap in the attribute-value XSS fix, an
untested tie-break rule, and a few minor cross-referencing/traceability
gaps. One raised concern (a suspected `byNameThenId`-reuse contradiction) was
checked and does not hold — noted below so it isn't mistakenly acted on.

## Consolidated Requirements Feedback

### FR-4.4: The malformed-payload fix is half-applied — prose only, no Verify case

**Issue:** v1's critique flagged three missing Verify cases together
(empty-database response, salary all-or-nothing nullability,
malformed-payload handling). The update added the first two to FR-4.1's
Verify line, but for the third only extended FR-4.4's *prose* ("a
malformed-but-parseable body is treated identically to a network/parse
error") — no Verify case exercises a `200` response with a syntactically
valid but incomplete body (e.g. missing `ratings`). FR-4.4's Verify line
still only exercises the `500` branch.
**Agreement:** Caught independently by main-agent and codex — the strongest
consensus finding this round.
**Recommendation:** Add a second Verify case to FR-4.4 for a `200` response
whose body omits `ratings` (or a `ratings` sub-key), asserting the identical
load-failure rendering as the `500` case.

### AR-4.4: `Cache-Control: no-store` has no acceptance test

**Issue:** AR-4.4 requires the header on *every* response but has no
Verify line and isn't mentioned in the Testing Strategy checklist item — so
the Security Review checklist item currently overclaims completeness for
this requirement specifically. (codex)
**Recommendation:** Add a Verify line to AR-4.4 (or fold into FR-4.1/FR-4.4's
existing Verify) asserting the header is present on both the `200` and the
`500` response, and note it in the Testing Strategy checklist item.

### AR-1.1: Two distinct, complementary gaps in the attribute-value XSS fix

**Issue 1 (main-agent):** AR-1.1's text-node enumeration (`name`,
`position`, `currency`, `ratingValue`) omits `id`, even though FR-1.2 —
unlike spec 003 — renders `id` as an ordinary visible table cell, not only
as a checkbox attribute. Spec 001 leaves `id`'s character format completely
unconstrained (Constraints: "not defined"), so it's exactly as untrusted as
`name`/`position` once it's cell text, by AR-1.1's own stated reasoning.

**Issue 2 (codex):** Separately, the attribute-value half of the fix
implies building checkbox `id`/`for` pairs directly from raw `position`
text. Unlike spec 003's numeric employee ids (safe as DOM id tokens),
`position` is arbitrary imported text that can contain spaces or other
characters unsuited to a bare DOM identifier. This needs a generated,
screen-local unique DOM id (e.g. an index or stable prefix), with the raw
position reserved for the checkbox's `value`/label text (via `textContent`)
used for filtering — not the identifier itself.

**Agreement:** Both are real, independently discovered, and don't overlap —
one is a missing entry in a list, the other is an identifier-construction
detail the same AR needs to rule out.
**Recommendation:** Add `id` to AR-1.1's text-node list; add a sentence
requiring generated DOM ids for position checkboxes rather than the raw
position string itself.

### AR-3.1: The tie-break rule has no worked Verify example

**Issue:** AR-3.1 (new in v1) states every sort — not just initial load —
breaks ties by `name` then `id`. Unlike every other rule fixed alongside it
in the same v1 pass, no Verify line anywhere actually exercises two tied
rows and confirms the tie-break order. (main-agent)
**Recommendation:** Add a tie-break case to FR-3.1's or FR-3.2's Verify
line — e.g. two rows tied on the sorted column (or both `null` per FR-3.3)
resolving in `name`-then-`id` order.

**Related, but not confirmed as a real issue — noted so it isn't
mistakenly acted on:** claude's critique separately suggested AR-3.1
contradicts AR-2.1 because `chart-logic.js`'s `byNameThenId` isn't exported,
implying the spec can't "reuse" it. Main-agent checked this directly: AR-3.1
cites `byNameThenId` only as a *design precedent to match* (same comparator
style), not as an import — AR-2.1's actual reused-imports list
(`buildTree`/`managerList`/`visibleIds`) never includes it, and the spec
doesn't claim otherwise. No contradiction exists; no change needed.

### FR-4.1: Missing the "don't pass the raw `Employee` object through" caution

**Issue:** `Employee` (`src/db/types.ts`) carries `country` and `endDate`,
neither of which belongs in this payload. Spec 003's analogous FR-3.1
explicitly warns against naively spreading the raw object for this exact
reason; spec 004's FR-4.1 has no equivalent sentence, even though its
handler is just as capable of the same mistake. (main-agent)
**Recommendation:** Add a clause to FR-4.1 mirroring spec 003 FR-3.1's
caution.

### Related Specs: FR-4.2 missing from the spec 003 "Depends on" row

**Issue:** FR-4.2's own prose cites spec 003 AR-3.1's precedent directly,
but FR-4.2 isn't listed in the Related Specs table's spec-003 "Depends on"
row's Affected Requirements. (main-agent)
**Recommendation:** Add FR-4.2 to that row.

## Additional Requirements Identified

- **aria-sort invariant** (codex): FR-3.1 should state explicitly that
  exactly one sortable header carries `aria-sort="ascending"` or
  `"descending"` at a time, and every other sortable header omits it (or
  uses `"none"`), plus define the visible (non-`aria`) direction indicator
  so the rule is checkable.
- **FR-3.2 → FR-3.3 cross-reference** (claude): FR-3.2 should explicitly
  state that a missing `baseSalary`/`bonus` value follows FR-3.3's
  missing-last rule rather than being numerically sorted as a bare `null`,
  closing a small but real ambiguity between the two FRs.
- **FR-1.2 column order** (claude): FR-1.2 doesn't state the left-to-right
  column order; the eight-column order is only implied by FR-4.1's payload
  key order and the Verify line's listing. Worth stating explicitly since a
  reasonable implementer could order columns differently (e.g. grouping
  salary before ratings, which the payload order already does — the point
  is to make the rendering order a requirement, not an inference).
- **Sort non-persistence** (claude): Out of Scope already excludes
  persisting filter/sort state across reloads, but doesn't state what
  happens instead — add one line confirming each load resets to the FR-3.1
  default (`name` ascending) regardless of the previous session's sort.

## Ambiguities Requiring Clarification

- **FR-4.2's "no new file under `src/db/`" structural check** (claude): it's
  unclear whether a presentation-layer helper (e.g. a small function that
  performs the rating-period-to-key mapping, living outside `src/db/`) is
  permitted, or whether FR-4.2 intends the handler to call the three query
  functions with no intermediate helper at all. The current wording likely
  already permits a non-`src/db/` helper (the constraint is scoped to "no
  new file under `src/db/`," not "no helper functions anywhere"), but a
  one-clause clarification would remove the doubt.

## Findings Considered and Not Carried Forward

- **A non-normative "implementation sketch" with function signatures for
  `public/employeeDetailsLogic.js`** (claude): rejected. This project's own
  spec-writing convention is WHAT-not-HOW, and spec 003's equivalent AR-2.3
  for `chart-logic.js` carries exactly the same level of specificity (module
  responsibility and data-in/data-out contract, no code). Adding a code
  sketch here would be inconsistent with that precedent, not a gap relative
  to it.
- **AR-4.4 miscategorized as "Architectural" instead of "Security"**
  (claude): rejected. The spec's existing structure already files
  security-flavored rules as Architectural Requirements throughout (AR-1.1's
  XSS rule, AR-4.1's no-CSRF-guard reasoning, AR-4.3's no-internal-detail
  rule) — AR-4.4 following the same pattern is consistent, not a new
  organizational problem.
- **FR-2.1's forward reference to AR-3.1 (defined later in the document)**
  (claude): rejected as a required restructure. Forward references already
  exist elsewhere in this document's ordinary style; reordering Features 2
  and 3 to avoid one forward reference would cost more clarity (breaking the
  Feature-1-through-4 narrative progression) than it buys.
- **Performance risk lacking an action threshold** (claude): already
  present — the Constraints section's N+1-queries bullet already states the
  fix-when-triggered action ("if a future import brings headcount to a scale
  where this becomes noticeable, batch these calls..."). No change needed;
  claude's critique appears not to have registered this existing text.

## Summary of Required Changes

1. Add a Verify case to FR-4.4 for the malformed-but-parseable-body branch
   (highest priority — independently caught by two adapters).
2. Add a Verify line for AR-4.4's `Cache-Control: no-store` header, covering
   both the `200` and `500` paths.
3. Add `id` to AR-1.1's text-node enumeration.
4. Add a sentence to AR-1.1 requiring generated, screen-local DOM ids for
   position checkboxes rather than the raw `position` string as the
   identifier itself.
5. Add a tie-break-specific Verify example to FR-3.1 or FR-3.2.
6. Add a "not the raw `Employee` object passed through" caution to FR-4.1,
   mirroring spec 003 FR-3.1.
7. Add FR-4.2 to the spec 003 "Depends on" row's Affected Requirements in
   Related Specs.
8. State the `aria-sort` single-active-header invariant and a visible
   direction indicator requirement in FR-3.1.
9. Cross-reference FR-3.3 from FR-3.2 for numeric-column missing-value
   handling.
10. State FR-1.2's column display order explicitly.
11. State that sort order resets to the FR-3.1 default on every page load
    (no persistence), as a one-line addition near the existing
    non-persistence Out of Scope item.
12. Optionally clarify FR-4.2's "no new file under `src/db/`" wording to
    remove doubt about presentation-layer helper functions outside that
    directory.
