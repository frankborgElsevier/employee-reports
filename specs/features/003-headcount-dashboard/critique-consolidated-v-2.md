# Spec 003: Consolidated Critique (v2)

## Overview

**Critiques received from:** main agent (`critique-v-2-main-agent.md`), Codex
`gpt-5.6-terra` (`critique-v-2-codex-gpt-5.6-terra.md`), Claude `haiku`
(`critique-v-2-claude-haiku.md`).

**Critiques missing:** none. Both external adapters ran first time this round
(Codex with `--skip-git-repo-check`, needed because this project is not a git
repository).

## Executive Summary

The v1 fixes held: all three reviewers independently confirmed the card-content
contradiction, the orphaned-employee gap, and the navigation ambiguity are
closed, and both external reviewers re-verified the codebase claims (cycle
rejection, `PRIMARY KEY`, `getAllEmployees` default, `createApp`/`withTestServer`
wiring) against the actual source. Codex explicitly re-checked and upheld v1's
rejection of renderer cycle defence, and found no stale cross-references from
the FR renumbering.

But the revision introduced **one new contradiction**, and it is the same one
the main agent and Codex found independently: FR-2.3's claim that roots don't
appear in the checkbox list is false in the reference dataset, where all five
managers *are* roots. Three further reachable-state or testability gaps follow.

Worth recording honestly: Claude `haiku` reported "no critical issues" and
declared the spec ready to implement. It missed the FR-2.3 contradiction that
two other reviewers caught from the spec's own verify lines. Its verification
table and edge-case sweep are useful confirmation; its verdict is not.

## Consolidated Requirements Feedback

### FR-2.3 — "Neither do roots" is factually wrong

**Issue:** FR-2.3 states that roots never appear in the manager checkbox list.
All five managers in the reference file report to the absent supervisor
`00000270149`, so all five are roots — and FR-2.3's own verify line requires
exactly those five checkboxes, while FR-2.7's verify says deselecting all five
leaves 11 roots visible "including the 5 managers themselves".
**Agreement:** main agent and Codex, found independently, both blocking. Codex
names the underlying conflation precisely: "reports to nobody" is not the same
as "has no reports".
**Divergence:** none.
**Recommendation:** Delete the clause. Being a root and being a manager are
independent properties that happen to coincide for every manager in this
dataset. Restate the intent — which FR-2.4 already half-covers — as: a manager's
own card is never hidden by their own checkbox, and an employee with no manager
is therefore visible in every checkbox state.

### FR-2.7 / FR-2.3 — The zero-manager state is unspecified

**Issue:** If no active employee has an active direct report, the checkbox list
is empty. This is reachable: it is what the reference file produces if the five
mid-level managers are excluded from the export, leaving an all-root roster.
FR-2.7's "with every manager checkbox deselected" is then vacuously true, so its
message ("No manager teams selected") would display over a perfectly normal full
roster.
**Agreement:** main agent and Codex.
**Divergence:** none.
**Recommendation:** Adopt. Omit the filter group entirely when no employee has a
direct report, and gate FR-2.7's message on at least one checkbox existing.

### FR-3.2 — The verify line is an invalid test

**Issue:** FR-3.2 asserts the serialised body contains none of the substrings
`salary`, `bonus`, `currency`, `rating`. An employee legitimately named or
titled with any of those words fails the test spuriously — and the check would
also pass a payload that leaked a field under a different name.
**Agreement:** main agent and Codex, independently.
**Divergence:** none.
**Recommendation:** Adopt. Assert on the key set of each entry — FR-3.1 already
fixes it at exactly five — which is both the real protection and a sound test.

### FR-3.5 — The link wording is self-contradictory

**Issue:** Each screen's nav "links to the other screen's path", yet the current
screen's own link must exist to be marked `aria-current="page"`.
**Agreement:** main agent (as a non-blocking clarity point) and Codex (as
blocking). Codex is right that it is not merely unclear but impossible as
written.
**Divergence:** severity only.
**Recommendation:** Adopt. Both pages carry both links — `/` for Import and
`/headcount.html` for Headcount — and the link matching the current page gets
`aria-current="page"`. Naming the literal hrefs also matters because
`aria-current` correctness depends on the Import link being `/`, the URL
`npm start` actually opens, not `/index.html`.

### AR-2.1 — Per-card ancestor walk is O(n²) at the stated ceiling

**Issue:** AR-2.1 computes visibility by walking each employee's ancestor chain.
For a 5000-employee chain that is ~12.5M ancestor checks per filter toggle, and
the checklist calls this "negligible" without demonstrating it.
**Agreement:** Codex (main agent noted the O(depth) cost but accepted it).
**Divergence:** Codex wants either single-pass propagation or a narrowed
guarantee; the main agent's v1 position was that real depth is 2 and the cost
does not matter.
**Recommendation:** Adopt Codex's first option. The fix is free and does not
compromise AR-2.1's actual intent: visibility is still derived rather than
stored, but propagated top-down in one traversal — a node is visible if its
parent is visible and its parent's checkbox is selected — making it O(n) instead
of O(n·depth). This also composes with AR-1.5's iterative requirement rather
than sitting awkwardly beside it. No responsiveness target is needed once the
complexity is linear.

### AR-3.4 — How is the 500 induced in a test?

**Issue:** The checklist claims the `500` shape is asserted, but `createApp()`
takes no database dependency, so Codex questions whether the failure path is
reachable from a test at all, and proposes dependency injection.
**Agreement:** Codex raised it; the main agent's checklist made the claim being
challenged.
**Divergence:** Codex proposes injecting a data-access abstraction.
**Recommendation:** Reject the injection; adopt the underlying point. Verified
against the source: `closeDatabase()` is idempotent (`src/db/connection.ts` —
"safe to call even if nothing is open") and `getConnection()` throws
`InitializationError` when no connection is open. So a test can call
`closeDatabase()` inside `withTestServer` and issue the request — the handler
throws, returns `500`, and `withTestServer`'s `finally` closes again harmlessly.
The failure path is testable today with no new seam. Do adopt Codex's other
half: name the exact client-facing string so the test can assert on it.

### FR-1.7 — A requirement with no acceptance condition

**Issue:** The 4.5:1 contrast ratio and the long-country-value layout rule have
no corresponding verify; FR-1.7's verify only checks legend text.
**Agreement:** main agent only.
**Divergence:** none.
**Recommendation:** Adopt. Per the project's own rule — if it's in the spec, it
ships — either name the three background/text colour pairs so the ratio is
computable and checkable, or move contrast to Constraints as a design guideline.
Naming the colour pairs is better: it also settles a decision the implementer
would otherwise make silently.

### FR-1.4 — "Rendered set" is undefined

**Issue:** FR-1.4 defines a root partly as an employee whose `manager_id` does
not resolve "to an employee in the rendered set" — a phrase used nowhere else,
and readable as the post-filter visible set, which would make root-ness change
as checkboxes toggle.
**Agreement:** main agent.
**Divergence:** none.
**Recommendation:** Adopt — say "in the payload (FR-3.1)".

### Minor clarifications

- **Payload order vs render order** (main agent): FR-3.1 fixes `id`-ascending,
  FR-1.2 fixes `name`-ascending. Both deliberate; one clause in FR-1.2 stops an
  implementer assuming the payload arrives pre-sorted for rendering.
- **The at-least-one-root invariant** (main agent): cycles are impossible and
  the graph is finite, so any non-empty active set has ≥1 root. Stating it rules
  out a defensive empty-chart branch and confirms FR-1.8 and FR-2.7 can never
  both apply.
- **AR-1.6 placement** (main agent): it governs FR-2.1/2.2/2.5 but sits under
  Feature 1. Cosmetic.
- **`camelCase` payload keys** (Claude): FR-3.1 already specifies `managerId`,
  and `src/db/types.ts` already returns camelCase from `toEmployee` — verified,
  no change needed.
- **Checkboxes don't update after a soft-delete** (Claude): already covered by
  Out of Scope's "Live refresh"; no change.

## Additional Requirements Identified

- **Amendment to FR-2.3:** delete the roots clause; omit the filter group
  entirely when no employee has a direct report.
- **Amendment to FR-2.7:** message conditional on at least one checkbox
  existing.
- **Amendment to AR-2.1:** single top-down visibility propagation, O(n).
- **Amendment to AR-3.4:** name the exact client-facing error string; record
  that the failure path is induced in tests via `closeDatabase()`, no new
  injection seam.
- **Amendment to FR-3.2:** key-set assertion replaces the substring assertion.
- **Amendment to FR-3.5:** both pages carry both links, hrefs `/` and
  `/headcount.html`, `aria-current="page"` on the current one.
- **Amendment to FR-1.7:** name the three colour pairs so contrast is checkable.
- **Amendment to FR-1.4:** "payload" replaces "rendered set".

## Ambiguities Requiring Clarification

None outstanding for the user. Every item above has a determinate answer from
the codebase or from decisions already recorded in the spec. The four open
questions from v1 were all closed in the revision.

## Summary of Required Changes

1. Delete FR-2.3's "neither do roots" clause and restate as "an employee with no
   manager is always visible".
2. Specify the zero-manager state: filter group omitted; FR-2.7's message gated
   on at least one checkbox existing.
3. Replace FR-3.2's substring verify with a key-set assertion.
4. Fix FR-3.5: both links on both pages, literal hrefs `/` and
   `/headcount.html`, `aria-current="page"` on the current one.
5. Tighten AR-2.1 to single top-down O(n) visibility propagation.
6. Name AR-3.4's exact error string; note the `closeDatabase()` test induction.
7. Give FR-1.7's contrast requirement checkable colour pairs.
8. Replace "rendered set" with "payload" in FR-1.4.
9. Note in FR-1.2 that payload order is not render order.
10. State the at-least-one-root invariant.
11. Move or re-scope AR-1.6 out of Feature 1.
12. Downgrade the "Scope & acceptance criteria" and "Error handling & failure
    modes" checklist items until 1–3 land, then restore them.

**Rejected:** dependency injection for the data layer (AR-3.4) — the failure
path is already testable via `closeDatabase()`. Nav markup examples and DOM
append instructions (Claude) — the spec says WHAT, not HOW, and both are
ordinary implementation choices.
