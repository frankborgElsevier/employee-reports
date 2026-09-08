# Spec 003: Consolidated Critique (v1)

## Overview

**Critiques received from:** main agent (`critique-v-1-main-agent.md`), Codex
`gpt-5.6-terra` (`critique-v-1-codex-gpt-5.6-terra.md`), Claude `haiku`
(`critique-v-1-claude-haiku.md`).

**Critiques missing:** none. Codex initially refused (`Not inside a trusted
directory` — this project is not a git repository) and succeeded on retry with
`--skip-git-repo-check`.

## Executive Summary

All three reviewers agree the spec is close to implementable: the API shape,
data-source reuse, security posture, and performance analysis are sound and
verified against the actual code. Five issues must be resolved before
implementation, and all three reviewers independently found the same two of
them — the ambiguous `index.html` navigation migration and the manager-checkbox
label/identity mismatch.

The single most important finding is a **direct internal contradiction** that
only Codex caught: FR-1.2 requires each card to show "exactly two pieces of
text" while FR-1.6 requires the card to also display the country. Two more
correctness findings — an inaccurate claim about `src/db/queries.ts`, and an
uncovered orphaned-employee case — are factual errors about the codebase rather
than matters of taste.

## Consolidated Requirements Feedback

### FR-1.2 / FR-1.6 — Card content contradiction

**Issue:** FR-1.2 mandates exactly two text values (name, position); FR-1.6
mandates the raw country as card text so colour is not the sole information
carrier.
**Agreement:** Codex flags it as blocking. Not caught by the other two.
**Divergence:** none.
**Recommendation:** Confirmed by reading both requirements — this is a real
contradiction. Amend FR-1.2 to three values (name, position, country) and keep
FR-1.6's accessibility rationale. Country-outside-the-card is the weaker option:
it would break the "colour is never the only carrier" guarantee at the card level.

### FR-1.1 — Overstated claim about the query layer

**Issue:** FR-1.1 says the active-only behaviour "follows the `includeInactive:
false` default of every `src/db/queries.ts` function".
**Agreement:** Codex only.
**Divergence:** none.
**Recommendation:** Verified — `getEmployeeById`, `getCurrentSalary`,
`getSalaryHistory`, `getLastRatings`, and `getRatingHistory` take no
`includeInactive` option at all. Narrow the claim to `getAllEmployees()`,
`getDescendants()`, and `getAncestors()`, which is what the spec actually
depends on.

### FR-1.1 + FR-1.3 — Orphaned employees under an inactivated manager

**Issue:** An import can inactivate a mid-level manager while their reports stay
active. `getAllEmployees()` drops the manager but the reports keep a
`manager_id` pointing at them, so the payload contains employees whose
`managerId` is not in the payload.
**Agreement:** Claude and Codex, arrived at independently (Claude via the
inactive-manager scenario, Codex via the general missing-parent case).
**Divergence:** none — both propose treating an unresolvable parent as a root.
**Recommendation:** This is the highest-value gap. It is reachable in normal
operation, not a theoretical one, and without a stated rule those employees
would silently vanish from the chart while still counting in a naively-computed
total. Add an FR: an employee whose `managerId` does not resolve to a rendered
employee is treated as a root. Also decide their filter behaviour — they cannot
be hidden by any checkbox, same as FR-2.7's true roots.

### FR-2.3 — Checkbox label vs. identity

**Issue:** The requirement says checkboxes are labelled and sorted by manager
name; the verify line identifies them by employee ID. Names are not guaranteed
unique.
**Agreement:** all three.
**Divergence:** Codex wants `Name (ID)` as the visible label; Claude asks only
that the spec pick one; the main agent frames it as a testability problem.
**Recommendation:** Key the control by `id`, label it with `name`, sort by `name`
then `id` for a deterministic tie-break, and rewrite the verify line to assert
five checkboxes keyed to those five ids rather than implying ID labels. Reserve
`Name (ID)` display for the duplicate-name case only — the reference data has no
duplicates and the ID strings are long and unreadable.

### FR-3.5 — Navigation migration

**Issue:** The spec allows either augmenting `index.html` or redirecting it, and
does not fix the import screen's path, the "current screen" indication
mechanism, or nav placement.
**Agreement:** all three, all blocking. All three also independently verified
that `start.ts` opens the bare origin, served as `/` by `express.static`.
**Divergence:** none on the recommendation — all three prefer augmenting
`index.html` in place.
**Recommendation:** Commit to it: the import screen stays at `/`, nav is added in
place, no redirect and no new route. Add `aria-current="page"` for the active
link (Codex) and state whether the nav markup is duplicated per page or shared
via a small JS module (Claude) — for two static pages, duplication is the
honest choice and should be said so nobody builds a templating layer.

### FR-3.4 / FR-1.7 / FR-2.7 — State messages

**Issue:** Three distinct non-chart states, only one with fixed wording. FR-2.7's
"no teams selected" is misleading because root employees remain visible.
**Agreement:** Codex and main agent on the concrete-wording gap; Codex alone on
the misleading FR-2.7 phrasing; Claude asks about visual distinction between
states.
**Divergence:** Codex wants a required loading state and a definition of what
stays visible on failure; the main agent argues a loading state is
over-engineering for a local SQLite read and should be explicitly out of scope.
**Recommendation:** Side with the main agent on the loading state — put "no
loading indicator required" in Out of Scope with the sub-100ms justification, so
the absence is a decision rather than an oversight. Adopt Codex's other two
points: fix FR-3.4's message string, and reword FR-2.7 to "No manager teams
selected — showing employees who report to nobody." Do specify what FR-3.4 hides:
chart, totals, and filter list all clear, legend may remain.

### FR-1.3 / AR-1.1 — Traversal robustness

**Issue:** "Unlimited depth" plus a naive recursive renderer is a stack-overflow
risk; duplicate ids or a cycle in the payload could loop forever.
**Agreement:** Codex (blocking); main agent implicitly via AR-2.1's derived
visibility.
**Divergence:** Codex asks for iterative traversal and cycle detection as
requirements; the main agent's performance note argues real depth is 2 and the
5000-row ceiling bounds the worst case.
**Recommendation:** Partially adopt. Cycles are already impossible —
`reassignManager` in `src/db/mutations.ts` rejects direct and transitive cycles
before writing, so a cyclic payload cannot come out of this database; say that
rather than specifying detection for it. Duplicate ids are likewise excluded by
the `PRIMARY KEY`. But **do** require iterative (non-recursive) tree assembly
and rendering: it costs nothing, and 5000 rows in a chain is a reachable
pathological import that would blow the stack.

### AR-3.4 — Error handling breadth

**Issue:** Naming `InitializationError` as the example implies narrow handling.
**Agreement:** Claude and main agent.
**Divergence:** none.
**Recommendation:** Reword as a catch-all: any exception from the handler
produces `500 { error }`.

### AR-3.4 — Do not leak internal exception messages

**Issue:** The import routes echo `error.message` to the client
(`describeFailure` in `src/server/app.ts`), which is appropriate there because
those messages are user-facing validation feedback. A `GET /api/headcount`
failure has no such user-actionable content.
**Agreement:** Codex only.
**Divergence:** none.
**Recommendation:** Adopt. Log the real error server-side, return a generic
message. Cheap, and it keeps filesystem paths out of a browser-readable response.

### AR-1.4 — XSS scope

**Issue:** The requirement covers text nodes but not attribute values.
**Agreement:** Claude.
**Divergence:** none.
**Recommendation:** Adopt — extend AR-1.4 to attributes set via `setAttribute`
with text values, never template-string interpolation. Note the related concrete
case Codex found: `showResult(text)` in `public/index.html` uses `textContent`,
so FR-3.6's success-message link cannot be added by passing an HTML string
through it. Say the link is appended as a DOM node.

### FR-3.1 — Explicit field projection

**Issue:** Returning the `Employee` object directly would ship `endDate`, which
FR-3.1's five-field contract excludes.
**Agreement:** Codex.
**Divergence:** none.
**Recommendation:** Adopt — require an explicit five-field projection, not a
pass-through of the row object. FR-3.2's negative assertion (no salary/rating
strings) is worth keeping alongside a positive assertion that the key set is
exactly the five named fields.

### FR-1.2 / FR-1.3 — Sibling and root ordering

**Issue:** Unspecified; two correct implementations could disagree.
**Agreement:** main agent and Codex.
**Divergence:** main agent leans to `name` ascending (the visible field), Codex
to whatever is deterministic.
**Recommendation:** `name` ascending, `id` ascending as tie-break, at every
level including roots — consistent with the FR-2.3 checkbox ordering decision
above, so the chart and the filter list read in the same order.

### Testing strategy

**Issue:** The spec recommends factoring browser logic into a testable module
but does not require it; the A→B→C fixture is described but not located.
**Agreement:** all three, all pressing for the same promotion from note to
requirement.
**Divergence:** Claude additionally wants a `getHeadcount` helper in
`test/server/helpers.ts` and a named fixture location.
**Recommendation:** Adopt in full. Add an AR requiring tree assembly, ancestor
visibility, and totals to live in an importable module with no DOM dependency,
tested via `node:test` — this is the only way FR-2.5 gets automated coverage.
Name the fixture: a hand-built 3-level dataset inserted through `src/db`'s write
API in a test helper, following `test/db/helpers.ts:withFreshDatabase`, not an
`.xlsx` fixture.

### Accessibility

**Issue:** Colour buckets are red/green (the most common colour-vision
deficiency pair); contrast, keyboard operation, and checkbox grouping semantics
are unstated.
**Agreement:** main agent and Codex.
**Divergence:** none.
**Recommendation:** Adopt the cheap parts — state the card-text mitigation
explicitly as the mitigation it is, require adequate text/background contrast,
and require the checkbox list to be a labelled `fieldset`/`legend` group.
Full keyboard-navigation and screen-reader requirements are more than this
single-user local tool needs; note that as a deliberate limit rather than
silently omitting it.

### Data exposure (accepted risk)

**Issue:** The roster — names, positions, countries, and the full reporting
structure — is readable by any local process that can reach the port.
**Agreement:** Codex.
**Divergence:** none.
**Recommendation:** Adopt as wording, not as work. Record it in Constraints as
an explicitly accepted risk inherited from spec 002's local-single-user model,
rather than leaving it implied by "no authentication" in Out of Scope. Also add
to AR-3.2 that no CORS headers are to be added (main agent), so nobody
"helpfully" installs `cors()` and turns a same-origin-only read into a
cross-origin one.

## Additional Requirements Identified

- **New FR (Feature 1):** an employee whose `managerId` does not resolve to a
  rendered employee is treated as a root; covers both the absent-supervisor case
  spec 002 already produces and the inactivated-mid-level-manager case.
- **New AR (Feature 1):** tree assembly and rendering are iterative, not
  recursive.
- **New AR (Feature 2 or 3):** tree/visibility/totals logic lives in a
  DOM-independent importable module so it is unit-testable.
- **New AR (Feature 3):** the endpoint projects exactly five named fields;
  `endDate` is never serialised.
- **Amendment to AR-3.4:** catch-all error handling; generic client message,
  real error logged server-side.
- **Amendment to AR-1.4:** attribute values as well as text nodes; FR-3.6's link
  appended as a DOM node, not through `showResult`.
- **Amendment to AR-3.2:** no CORS headers.

## Ambiguities Requiring Clarification

1. **Duplicate manager names** — is `Name (ID)` disambiguation wanted always,
   only on collision, or never? (Recommendation above: only on collision.)
2. **Nav markup sharing** — duplicated per page, or extracted into a shared JS
   snippet? (Recommendation: duplicated, and say so.)
3. **FR-2.2 breakdown re-sorting** — count-descending means rows visibly reorder
   on every checkbox toggle. Acceptable, or should ordering be stable
   (position-ascending) so the eye can track a row? A product call, not a
   technical one.
4. **Totals and unfilterable employees** — roots and orphans are always visible,
   so total headcount can never fall below their count. Should the UI say so
   (e.g. "11 always shown"), or is the number alone enough?

## Summary of Required Changes

1. Resolve the FR-1.2/FR-1.6 card-content contradiction — cards show three
   values.
2. Add the unresolvable-manager-renders-as-root requirement (inactivated
   manager, absent supervisor).
3. Commit FR-3.5 to augmenting `index.html` in place at `/`; no redirect, no new
   route; `aria-current` for the active link; nav markup duplicated per page.
4. Fix FR-2.3: key by `id`, label by `name`, sort `name` then `id`; correct the
   verify line.
5. Specify sibling and root ordering (`name`, then `id`) in FR-1.2/FR-1.3.
6. Narrow FR-1.1's claim to the three query functions that actually take
   `includeInactive`.
7. Require an explicit five-field projection in FR-3.1; never serialise
   `endDate`.
8. Broaden AR-3.4 to a catch-all with a generic client message and server-side
   logging.
9. Require iterative tree assembly/rendering; state that cycles and duplicate
   ids are already excluded by `reassignManager` and the primary key.
10. Promote the DOM-independent testable-module recommendation to an AR; name
    the 3-level fixture's location and construction method.
11. Fix FR-3.4's message string and state what it clears; reword FR-2.7's "no
    teams selected" message; add "no loading indicator" to Out of Scope with its
    justification.
12. Extend AR-1.4 to attributes; specify FR-3.6's link as a DOM node.
13. Add to AR-3.2: no CORS headers.
14. Add accessibility minimums (contrast, `fieldset`/`legend` for the checkbox
    group) and state the deliberate limit beyond them.
15. Record local-roster data exposure in Constraints as an accepted risk.
