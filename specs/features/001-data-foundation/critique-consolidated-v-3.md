# Spec 001: Consolidated Critique (v3)

## Overview

**Critiques received from:** main-agent, GitHub Copilot CLI (`gpt-5.3-codex` — run via `copilot`, per user request, in place of the standalone `codex` CLI used in v1/v2), claude (haiku)
**Critiques missing:** none — all three completed successfully.

## Executive Summary

All three critiques agree v2→v3 resolved the real blocker (`upsertEmployee`/`manager_id`) and the "current salary" contradiction cleanly. The spec is now in the territory of small, precise clarifications rather than structural gaps. Two independent external critiques converged on the same theme the main-agent critique also flagged from a different angle: **the spec still doesn't fully specify what happens when a query is asked about something that doesn't exist** (an unknown manager id, an employee with no eligible salary row, etc.) — AR-4.4 covers single-entity lookups and writes, but not collection queries or the "exists but empty" vs "doesn't exist" distinction. The other recurring theme is **loose wording around dates and numbers** — "ISO 8601 date," "current calendar year," and numeric field types are all specified at a level that reads fine but leaves an implementer to guess the exact rule.

## Consolidated Requirements Feedback

### "Current calendar year" is never defined (blocking-ish — copilot + claude)

**Issue:** FR-2.2, FR-2.3, and FR-3.3 all key validation/query behavior off "the current calendar year," but nothing states how that's determined — system clock at query time? Local timezone or UTC? Fixed at process start or re-evaluated per call?
**Agreement:** Both external critiques flagged this independently, both citing the same risk: behavior that silently changes at year boundaries and is hard to test deterministically without a stated rule.
**Recommendation:** Add one sentence (e.g. to AR-1.1 or a new small AR): "current calendar year" means the year component of the system clock at the moment of the call, evaluated in UTC (to avoid timezone-dependent boundary behavior across a distributed team). This is cheap to state and removes a real ambiguity affecting three separate FRs at once.

### Not-found vs. empty-result semantics incomplete (blocking-ish — copilot + main-agent)

**Issue:** AR-4.4 (added in v2) covers single-entity lookups (`getEmployeeById` returns `null`) and write rejections (throw), but is silent on: `getCurrentSalary`/`getLastRatings` when the employee exists but has no eligible row; `getDescendants`/`getAncestors`/`reassignManager` given an id that doesn't correspond to any employee at all (empty array vs. thrown error — indistinguishable from "valid id, zero results" otherwise).
**Agreement:** Copilot lists this as three separate missing requirements; main-agent's critique raised the same underlying gap independently, focused on the collection-query case. Claude didn't raise this directly but doesn't contradict it.
**Recommendation:** Extend AR-4.4 with one rule for collection-returning functions: a list-returning function given an id with no matching employee returns an empty list, exactly as it would for a valid employee with no matching rows — callers who need to distinguish "no such employee" from "employee exists, nothing to show" should call `getEmployeeById` first. And for single-value functions over history (`getCurrentSalary`, `getLastRatings`'s "current" equivalent): returns `null`/empty array when the employee exists but has no eligible row, consistent with the not-found-returns-null pattern already established.

### Empty/blank string validation inconsistency (non-blocking — copilot + claude)

**Issue:** `name`, `position`, and `country` are `NOT NULL` but nothing stops an empty string or whitespace-only value, while `rating_value` (FR-3.3) explicitly rejects blank values and `currency` (FR-2.3) has a strict format check. The inconsistency — some text fields validated, others not — looks accidental rather than intentional.
**Agreement:** Both external critiques raised this.
**Recommendation:** Extend `upsertEmployee`'s validation (alongside the existing date checks in FR-1.2) to reject empty or whitespace-only `name`, `position`, or `country`. This is a small, consistent extension of a pattern the spec already uses elsewhere — not new scope, just closing a gap in applying it.

### Date format specification is loose (non-blocking — both external critiques, different angle)

**Issue:** "Valid ISO 8601 calendar date" doesn't pin down which of ISO 8601's several date formats is meant (basic `YYYYMMDD`, extended `YYYY-MM-DD`, week-dates, ordinal dates). The examples given (`2025-03-14`) imply extended format, but the requirement doesn't say so explicitly.
**Recommendation:** Tighten FR-1.2's wording to "ISO 8601 extended calendar date format (`YYYY-MM-DD`) only" — a one-word-ish fix that removes an entire class of format ambiguity.

### Ordering determinism gaps (non-blocking — main-agent + copilot, two distinct angles)

**Issue:** Two separate ordering gaps surfaced: (1, main-agent) `getAllEmployees`'s "ordered by `id` ascending" sorts a `TEXT` column lexicographically, which may not match numeric expectations if WorkDay ids are numeric strings of varying length (`"10"` sorts before `"9"`); (2, copilot) `getDescendants`'s depth-ascending ordering doesn't say how to order siblings *within* the same depth level, leaving that non-deterministic.
**Recommendation:** Two small additions: state explicitly that `getAllEmployees`'s `id` ordering is plain string/lexicographic ordering as stored (not numeric) — implementers and downstream UI specs should not assume numeric sort. For `getDescendants`, add a secondary sort key among same-depth siblings (e.g., by `id`, for the same lexicographic-but-deterministic reason) so output is reproducible across runs.

### `includeInactive` traversal semantics ambiguous mid-chain (non-blocking — copilot, new finding)

**Issue:** FR-1.5 says traversal accepts `includeInactive`, defaulting to active-only, but doesn't say what happens when an *inactive* employee sits between two active employees in the reporting chain (e.g., A → inactive B → active C). Does filtering only affect which rows are *returned*, while traversal still walks through inactive nodes to reach C? Or does an inactive node stop traversal, hiding C entirely even though C is active?
**Recommendation:** State explicitly that `includeInactive: false` filters the *returned* set only — traversal itself always walks the full `manager_id` graph regardless of active status, so an active descendant behind an inactive manager is still found and returned. This is the behavior that matches the stated intent ("don't show departed employees," not "sever the org chart at departed employees") and is worth one sentence to remove the ambiguity.

### Numeric field validation is looser than the prose implies (non-blocking — copilot + claude)

**Issue:** Several small gaps cluster together: `effective_year`/`rating_year` aren't stated as requiring integers (SQLite's loose typing would otherwise accept a float); `base_salary`/`bonus` aren't stated as requiring finite numbers (`NaN`/`Infinity` aren't explicitly rejected); the "before 1990 or more than one year ahead" wording doesn't state whether 1990 itself is inclusive; `bonus = 0` isn't explicitly confirmed as valid (only "not negative" is stated).
**Recommendation:** Tighten FR-2.3/FR-3.3 with explicit inclusive bounds ("`effective_year` must be an integer in the inclusive range [1990, current year + 1]") and add "finite" to the `base_salary`/`bonus` non-negativity check. Confirm `bonus = 0` is valid (it already is, per the existing default, just state it plainly).

## Additional Requirements Identified

- `initDatabase`'s behavior when the parent directory of `path` doesn't exist (create it, or require the caller to) — currently unstated (claude).
- `initDatabase`'s behavior if called a second time in the same process, given AR-4.3's single-connection model — return the existing connection, or throw (claude; this echoes a v2 finding that wasn't fully closed).
- A note for the future WorkDay Import spec: since `upsertEmployee` and `reassignManager` are now two separate calls per new hire (per the v2 fix), bulk-importing many new employees with managers can leave the org topology transiently inconsistent between the two calls unless the import layer wraps a whole batch (or at least each employee's pair of calls) in a single transaction. This spec's functions are individually transactional (FR-4.3); coordinating *across* calls is the Import spec's responsibility, but it's worth flagging now so that spec doesn't miss it (copilot).

## Ambiguities Not Requiring a Spec Change (already addressed or correctly deferred)

- **Prepared-statement caching** (claude): this is an implementation detail (HOW to call `better-sqlite3`, not WHAT the behavior is) — correctly left unspecified.
- **Hierarchy depth/breadth limits** (claude suggested specific numbers like "~50 levels" or "1000 direct reports"): these would be unfounded, arbitrary guesses with no evidence behind them; the existing open Performance checklist item already acknowledges scale is unknown pending real data — no better to replace "unknown" with an invented number.
- **Schema drift detection beyond `CREATE TABLE IF NOT EXISTS`** (copilot): a real concern in general, but for a project with zero implementations and zero deployed databases, this is speculative extra machinery; the existing Rollout & Migration reasoning (added in v2) already covers why this isn't needed yet.
- **Order/limit parameters must be bound, not string-interpolated** (copilot): already satisfied — none of this spec's ordering is user-selectable (all `ORDER BY` clauses are fixed per FR, not passed by callers), and the one user-supplied numeric parameter (`getLastRatings`'s `limit`) is already required to be validated and passed as a bound parameter under AR-1.1's existing rule.
- **Backup/restore guidance** (claude): reasonable operational advice, but not a schema/data-access-layer requirement — out of this spec's scope by the same logic as auth/authz.

## Summary of Required Changes

1. Define "current calendar year" precisely (system clock, UTC) — affects FR-2.2, FR-2.3, FR-3.3.
2. Extend AR-4.4 to cover collection-returning functions (empty list for unknown id, same as valid-id-no-results) and single-value history queries (`null`/empty when no eligible row exists).
3. Reject empty/whitespace-only `name`, `position`, `country` in `upsertEmployee`'s validation.
4. Tighten "ISO 8601 calendar date" to "ISO 8601 extended format (`YYYY-MM-DD`) only."
5. Clarify `getAllEmployees`'s `id` ordering is lexicographic (not numeric), and add a deterministic same-depth sibling ordering to `getDescendants`.
6. State that `includeInactive: false` filters returned rows only; traversal still walks through inactive nodes to reach active descendants beyond them.
7. Tighten numeric validation: integers for year fields, finite-number requirement for salary/bonus, explicit inclusive year bounds, explicit confirmation that `bonus = 0` is valid.
8. Specify `initDatabase`'s behavior for a missing parent directory and for a second call in the same process.
9. Add an Integration Points note flagging the two-call (`upsertEmployee` + `reassignManager`) transaction-coordination responsibility for the future WorkDay Import spec.
