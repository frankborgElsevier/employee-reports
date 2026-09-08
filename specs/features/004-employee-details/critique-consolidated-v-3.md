# Spec 004: Consolidated Critique (v3)

## Overview

**Critiques received from:** main-agent (Claude, full codebase cross-check
of every v2 fix), codex (`gpt-5.6-terra`, read-only sandbox), claude
(`haiku` adapter, `--print` non-interactive).
**Critiques missing:** none — all three completed successfully.

All three adapters were explicitly told to say plainly if nothing further
was worth changing rather than manufacture nitpicks, given this is the
third review pass.

## Executive Summary

All ten v2 fixes landed completely and correctly — confirmed independently
by all three adapters, with main-agent and codex each verifying directly
against the source (`src/db/queries.ts`, `chart-logic.js`,
`src/server/app.ts`, specs 001/003). **Two of three adapters converge on a
clear verdict: this spec has reached diminishing returns and is genuinely
implementation-ready.** The one substantive new finding (codex) is a real
but narrow testability gap — the new malformed-payload Verify case
describes client-rendering behavior this project's test setup (no browser
harness) can't actually automate the way the Testing Strategy checklist
implies, unlike the genuinely server-testable cases it's currently grouped
with. Main-agent found two additional non-blocking polish items. The third
adapter (claude-haiku) found nothing to fix, but its "ready" verdict is
weakened by one factual error in its own reasoning (see below) — its
overall conclusion still agrees with the other two.

## Consolidated Requirements Feedback

### AR-2.3 / FR-4.4: The malformed-payload Verify case isn't actually automatable as scoped

**Issue:** This project has no browser test harness — `test/server/` tests
raw HTTP responses via `withTestServer`, and `node:test` coverage for
client-side behavior is limited to whatever lives in a DOM-independent,
plain-importable module (AR-2.3's existing pattern, established by spec 003
AR-2.3 for `chart-logic.js`). FR-4.4's new malformed-payload Verify case
("the page displays the identical load-failure message...") describes
*client rendering behavior* — the same category of thing spec 003's own
checklist already concedes relies on "manual checking," not automated
tests. But the v2 update's Testing Strategy checklist bullet lists the
malformed-`200`-body case in the same sentence as the genuinely
server-testable cases (empty-database response, `500` body), implying
`test/server/` covers it too. It cannot: no test in that directory executes
client JS or observes DOM state. (codex)
**Agreement:** Sole finding on this point, but well-reasoned and verified
against this project's actual, repeatedly-established testing convention
(no browser harness; DOM-independent modules are the only automatable
client-side surface).
**Recommendation:** Require the payload-shape validation itself (checking
for a missing `ratings` key or sub-key) to live as a pure function in
`public/employeeDetailsLogic.js` (extending AR-2.3's existing scope, the
same way filtering/sorting logic already does), so *that* logic gets real
`node:test` coverage. Correct the Testing Strategy checklist wording to
state plainly that the validation function is unit-tested, while the
"page displays X" wiring-level behavior is manually verified — consistent
with, not a new exception to, how every other client-rendering Verify line
in this document (FR-1.4, FR-2.5, and FR-4.4's pre-existing `500` case) has
always been covered. This also quietly fixes an equivalent, pre-existing
overclaim in the `500` case's checklist entry, without needing to touch
that Verify line's content.

### FR-3.2/FR-3.3: The v2 cross-reference fix only closes the ambiguity for 2 of 5 placeholder-capable columns

**Issue:** FR-3.3's own trigger text ("no current salary, or no rating for
that period") already covers `currency` and all three rating-period
columns, not only `baseSalary`/`bonus` — "no current salary" is exactly the
condition under which `currency` also renders the FR-1.3 placeholder. The
v2 fix added an explicit carve-out sentence only to FR-3.2's
`baseSalary`/`bonus` clause; the preceding sentence covering
`id`/`name`/`position`/`currency`/rating columns as plain `localeCompare`
strings has no equivalent carve-out, so read in isolation it implies the
placeholder is compared as an ordinary string for those five columns — a
different, wrong outcome per FR-3.3. FR-3.3 read alone still resolves this
correctly for an attentive reader, but the v2 changelog explicitly scoped
the fix to "numeric-column missing-value handling," leaving the textually
identical gap open for `currency` and the three rating columns. (main-agent)
**Recommendation:** Either broaden FR-3.2's cross-reference to state it
applies to all five placeholder-capable columns (not just the two numeric
ones), or add one sentence to FR-3.3 itself stating plainly that it governs
every sortable column that can carry the placeholder — the latter is
cleaner (one truth in one place) and removes the need to repeat the
carve-out per column type in FR-3.2.

### AR-1.1: The new justification sentence asserts something spec 001 explicitly disclaims

**Issue:** AR-1.1's v2-added sentence calls spec 003's employee ids
"numeric," implying they're reliably DOM-safe by format. Spec 001's own
Constraints say the opposite: `employees.id`'s format is "not defined" —
only non-blank-after-trim is enforced. Spec 004's own FR-3.2 is careful
about exactly this point elsewhere in the same document ("`id` sorts this
way even though its values happen to look numeric... the rule still governs
any future dataset whose ids aren't fixed-width"), making AR-1.1's new
phrasing inconsistent with the document's own established carefulness.
(main-agent)
**Recommendation:** Reword to something like "unlike spec 003's checkbox
ids, which happen to be numeric in every observed export" — this is a
non-functional rationale correction (the manager checkbox behavior itself
is unchanged, reused verbatim from an already-implemented spec 003), not a
requirement change.

## Findings Considered and Not Carried Forward

- **Claude-haiku's claim that this spec "already imports" `byNameThenId`
  from `chart-logic.js`**: checked directly — false. `byNameThenId` is not
  exported by `chart-logic.js`, and this spec's actual import list
  (`buildTree`/`managerList`/`visibleIds`, per AR-2.1) never includes it;
  this exact point was already verified and settled in the v2 round. No
  spec change follows from this — the error is in the critique, not the
  spec. Noted here only so it isn't mistakenly treated as a fourth
  confirmation of correctness on this point.
- **A general "is this testable" sweep beyond the one AR-2.3 gap codex
  found**: main-agent and claude-haiku both independently checked the rest
  of the document's Verify lines against the actual codebase and found
  none of the same category of problem elsewhere — the gap is specific to
  the newly-added malformed-payload case, not a systemic issue.

## Summary of Required Changes

1. Extend AR-2.3 to require the malformed-payload validation check to live
   in `public/employeeDetailsLogic.js` as a pure, unit-testable function;
   correct the Testing Strategy checklist to accurately describe what's
   automated (the validation logic) versus manually verified (the actual
   page rendering) — consistent with the rest of this document's existing
   client-rendering Verify lines.
2. Broaden FR-3.3 (or FR-3.2's cross-reference) to state explicitly that
   the missing-values-sort-last rule governs all five placeholder-capable
   columns (`currency`, `baseSalary`, `bonus`, and the three rating-period
   columns), not only the two numeric ones.
3. Correct AR-1.1's "numeric employee ids" rationale sentence to match
   spec 001's actual (format-undefined) guarantee and this document's own
   careful phrasing elsewhere (FR-3.2).

## Overall Recommendation

Two of three independent critiques, and the third after discounting one
factual error, agree: **this spec has reached diminishing returns.** All
three findings above are small, cheap, non-blocking documentation
corrections — none change a requirement's behavior, only its precision.
After applying them, a fourth critique round is unlikely to be worth the
cost; proceeding to implementation is reasonable either immediately after
applying these three fixes, or even before them if the team prefers to
close them inline during implementation (main-agent's assessment: "Finding
1 is cheap to close inline during implementation... Finding 2 requires no
code change at all").
