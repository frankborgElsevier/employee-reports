# Spec 001: Consolidated Critique (v2)

## Overview

**Critiques received from:** main-agent, codex (gpt-5.4), claude (haiku)
**Critiques missing:** none — all three critique adapters completed successfully.

## Executive Summary

All three critiques agree the v1→v2 update genuinely closed the biggest gaps (mutation API, delete semantics, active/inactive concept, basic validation). All three also independently converged on the same new issue the update introduced: **`upsertEmployee`'s relationship to `reassignManager` is still ambiguous, and as written could let a caller bypass the cycle-prevention check that FR-1.4 otherwise carefully protects.** This is the one finding that should block sign-off.

Beyond that, the critiques cluster around three themes: (1) error/not-found semantics are never defined for any rejecting operation, so callers can't build reliable error handling; (2) a few validation edges are still open — malformed dates, the "current salary" definition contradicting the new future-dated-row allowance, and whether hierarchy traversal includes inactive employees; (3) several minor wording inconsistencies (AR-1.3 vs. AR-4.3, query ordering, `getLastRatings(limit)` bounds) that are cheap to fix.

## Consolidated Requirements Feedback

### `upsertEmployee` / `manager_id` ownership (blocking — all three critiques)

**Issue:** FR-1.4 and FR-4.3 both say `reassignManager` is "the sole path for changing `manager_id`," but FR-4.3 also describes `upsertEmployee` as creating/updating "an employee record" without saying whether `manager_id` is part of that payload. If it is, a caller could set `manager_id` through `upsertEmployee` without ever going through `reassignManager`'s cycle check — silently defeating FR-1.4.
**Agreement:** All three critiques flagged this independently and treat it as the most important open issue in this version.
**Divergence:** None on the core problem. Claude additionally asks whether "sole path" means enforced-by-the-spec or merely by convention — same root cause, just phrased as an ambiguity rather than a bug.
**Recommendation:** State explicitly in FR-4.3 that `upsertEmployee`'s payload does not include `manager_id` at all — new employees are always created with `manager_id = NULL`, and any manager assignment (including the first one, for a brand-new hire) happens via a follow-up `reassignManager` call, which is the only function that runs the cycle check. This is a one-sentence fix but closes a real security-relevant gap, and it matters for the future WorkDay Import spec, which will need to know it must call `reassignManager` per employee after each `upsertEmployee`.

### Error / not-found semantics undefined (non-blocking per codex, blocking per claude)

**Issue:** Every rejecting behavior in the spec ("rejected," "fails," "throws") is described in prose without stating what a caller actually receives — an exception, a specific error type, a `null`/`undefined` return, or a result object. This affects `getEmployeeById` (not-found), `deleteEmployee` (has-reports conflict), `reassignManager` (cycle detected), and all four validation FRs (2.3, 3.3, 1.2's date check).
**Agreement:** Both external critiques raised this; they differ only on severity (codex: non-blocking polish; claude: a real implementation blocker since downstream error-handling code can't be written without it).
**Recommendation:** This is a genuine gap, but resolving it fully (a designed exception hierarchy, specific error codes) risks over-specifying HOW rather than WHAT — which the spec-writing rules caution against. A middle path: add one FR stating the *category* contract (e.g., "not-found queries return `null` rather than throwing; validation and integrity failures throw an error the caller can catch — the specific error type/class is an implementation detail left to the data-access layer"). That's enough for downstream specs to write against without dictating an exception hierarchy this spec shouldn't own.

### "Current salary" contradicts the new future-dated-row allowance (blocking — codex)

**Issue:** FR-2.3 (added in v2) allows `effective_year` up to one year ahead of the current year, to accommodate forward-looking salary records. But FR-2.2 defines "current salary" as simply the row with the highest `effective_year`. Combined, a 2027 row entered in 2026 would become the "current" salary a year before it takes effect.
**Agreement:** Raised only by codex, but it's a straightforward logical inconsistency between two FRs that were each individually reasonable — not a matter of opinion.
**Recommendation:** Tighten FR-2.2 to: "current salary is the row with the highest `effective_year` that is not greater than the current calendar year" — i.e., future-dated rows can exist (for planned changes) but don't become "current" until their year arrives.

### Malformed date validation (blocking per codex, listed as an edge case by claude)

**Issue:** `start_date` and `end_date` are typed as "ISO 8601 date" in prose, but nothing requires the write path to validate the format or reject nonsensical dates (e.g. `2025-13-45`). FR-1.2 only validates the *relationship* between the two dates (`end_date >= start_date`), not that either is well-formed.
**Agreement:** Both external critiques note this; codex treats it as blocking for reliable anniversary-calculation logic downstream.
**Recommendation:** Add one clause to FR-1.2 (or a new FR-1.7) requiring `upsertEmployee` to reject `start_date`/`end_date` values that aren't valid ISO 8601 calendar dates, alongside the existing ordering check. This mirrors the validation approach already established for salary/rating fields (FR-2.3/FR-3.3), so it's consistent with the spec's existing pattern rather than a new concept.

### Inactive-employee filtering undefined for hierarchy traversal (non-blocking — codex + claude)

**Issue:** FR-1.2 defaults `getAllEmployees` to active-only, "since headcount totals and org-hierarchy views need active employees by default" — but `getDescendants`/`getAncestors` (FR-1.5, FR-4.1) have no stated filter or default at all.
**Agreement:** Both external critiques flagged this identically.
**Recommendation:** Extend FR-1.5 (or FR-4.1) one sentence: hierarchy traversal functions accept the same `includeInactive` flag as `getAllEmployees`, defaulting to active-only, for consistency — an org chart shouldn't silently include departed employees unless asked.

## Additional Requirements Identified

- Explicit ordering for `getAllEmployees` (e.g., by `id` or `name`) and for `getSalaryHistory`/`getRatingHistory` (e.g., ascending by year, since "history" implies chronological reading) — currently unspecified, per claude.
- A stated bound on `getLastRatings(employeeId, limit)` — reject or clamp non-positive or unreasonably large `limit` values, per codex.
- Currency-change-within-a-year behavior for `upsertSalaryRecord` — claude notes that overwriting an existing year's row could silently change `currency` (e.g. USD→GBP) without any rule against it; worth one sentence stating whether that's allowed (it plausibly should be, for a genuine mid-year relocation) or should be rejected as inconsistent.
- Wording fix for AR-1.3: "execute `PRAGMA foreign_keys = ON` on every new database connection" reads as if multiple connections are expected, but AR-4.3 (also added in v2) commits to a single shared connection per process. Reword AR-1.3 to say the pragma is set once, when that single connection is opened.

## Ambiguities Requiring Clarification

- Single-process/single-thread assumption: AR-4.3's "one connection per process" doesn't say whether Node.js worker threads are in scope. `better-sqlite3` connections aren't safe to share across worker threads, so if the app ever uses them, this assumption needs revisiting — not urgent now, but worth a one-line note (per claude).
- `AR-4.2`'s `0600` file-permission requirement is POSIX-specific; worth a caveat that it applies where the host OS supports POSIX permissions, per codex — not blocking, just a precision nit.

## Not New Findings (already addressed, no action needed)

- Claude's note that `reassignManager(A, A)` (an employee managing themselves) isn't "explicitly" rejected: FR-1.4 already covers this — it rejects a manager change "directly or transitively," and a direct self-reference is exactly the "directly" case. No spec change needed; flagging here so it isn't mistakenly reintroduced later.
- Codex's migration/rollout concern (that `CREATE TABLE IF NOT EXISTS` won't upgrade an existing v1-shaped database): this spec has not been implemented yet — v1 and v2 are spec *drafts*, not deployed schema versions, so no real database exists under the old shape. The Rollout & migration checklist item's `[N/A]` remains correct for now. Revisit only if implementation of an earlier draft has actually happened outside this repo (it hasn't, per the current codebase state).
- Country-name normalization and opaque rating-value concerns (claude): both already explicitly acknowledged as deferred, documented risks in the spec's Constraints section from v1 — restated by the critique, not a new gap.

## Summary of Required Changes

1. **(Blocking)** Clarify that `upsertEmployee` never accepts `manager_id` — all manager assignment, including for new hires, goes through `reassignManager` (FR-4.3).
2. Add a not-found/error-category contract (return `null` for not-found queries; throw for validation/integrity failures) without dictating a specific exception hierarchy.
3. Fix FR-2.2's "current salary" definition to exclude future-dated rows (highest `effective_year` not greater than the current calendar year).
4. Add explicit ISO-8601 format validation for `start_date`/`end_date`, alongside the existing ordering check (FR-1.2).
5. Extend the `includeInactive` filter to `getDescendants`/`getAncestors`, matching `getAllEmployees`.
6. Specify ordering for `getAllEmployees`, `getSalaryHistory`, and `getRatingHistory`.
7. Bound `getLastRatings`'s `limit` parameter to positive values.
8. State whether `currency` may change on an `upsertSalaryRecord` update to an existing year.
9. Reword AR-1.3 to match AR-4.3's single-connection model.
