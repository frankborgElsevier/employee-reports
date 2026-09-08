# Spec 001: Consolidated Critique (v1)

## Overview

**Critiques received from:** main-agent, codex (gpt-5.4), claude (haiku)
**Critiques missing:** none — all three critique adapters completed successfully.

## Executive Summary

All three critiques converge on one central gap: **the spec defines a read-only data-access layer (FR-4.1) but the write path — the thing FR-1.3's cycle prevention, FR-2.1/FR-3.1's uniqueness constraints, and the future WorkDay Import spec all depend on — is never specified.** No insert/update/delete function signatures, no transaction boundaries, and no batch/upsert semantics are defined. This is the most important gap to close before implementation.

Beyond that, both external critiques independently flagged: missing indexes for the queries this spec itself defines, undefined `ON DELETE`/cascade behavior for foreign keys, under-specified validation (date format, currency shape, string length limits), and a "Security: N/A" checklist verdict that undersells real exposure (compensation and rating data, arbitrary file path in `initDatabase`). The main-agent critique independently flagged the missing employee status/termination field, which will block the Headcount Dashboard spec's "total headcount" requirement.

## Consolidated Requirements Feedback

### Mutation / write API (blocking — codex + claude)

**Issue:** FR-4.1 only lists query functions (`getEmployeeById`, `getDescendants`, etc.). Nothing defines how an employee, salary record, or rating record actually gets written — yet FR-1.3 requires cycle validation "before any row is written," and FR-2.1/FR-3.1 have uniqueness constraints that a writer must handle (insert vs. upsert).
**Agreement:** Both external critiques call this a blocking gap; the future WorkDay Import spec cannot be scoped against a data-access layer that has no defined write surface.
**Divergence:** None — both critiques agree on the fix, differing only in how much detail to add now (codex suggests defining upsert/batch semantics now; claude enumerates specific function names).
**Recommendation:** Add a new Feature (or extend Feature 4) with explicit write functions: `upsertEmployee`, `reassignManager` (the one that triggers FR-1.3's cycle check), `upsertSalaryRecord`, `upsertRatingRecord`. State that all of these run inside a single `better-sqlite3` transaction per call. Defer *batch/bulk* import-specific performance tuning to the WorkDay Import spec, but the function signatures and per-record transaction semantics belong here.

### Foreign key delete/cascade behavior (blocking — main-agent + codex + claude)

**Issue:** No FR or AR states what happens when a manager (or any employee with history rows) is deleted — `RESTRICT`, `CASCADE`, or `SET NULL` is never chosen.
**Agreement:** All three critiques raised this independently.
**Recommendation:** Add an AR stating the default: manager deletion is rejected while direct reports still reference them (`RESTRICT`/`NO ACTION`, forcing explicit reassignment first — consistent with FR-1.2's "no manager = root" model). `salary_history`/`rating_history` rows should cascade-delete with their employee, since they have no independent meaning without it.

### Employee status / termination (blocking — main-agent)

**Issue:** No `status` or `end_date` field exists, so "total headcount" (an explicit requirement in the roadmap's Headcount Dashboard spec) cannot distinguish active from former employees.
**Agreement:** Raised by main-agent only, but neither external critique contradicts it, and it directly blocks a named downstream spec.
**Recommendation:** Add an `end_date` (nullable) column to `employees`. Define "active" as `end_date IS NULL`. This is cheaper to add now than to retrofit once Headcount Dashboard and Employee Details both depend on the current shape.

### Temporal/validation ambiguity in salary and rating history (blocking per codex, non-blocking per claude)

**Issue:** `effective_year`/`rating_year` granularity assumes exactly one record per employee per year; there's no stated rule for what happens with mid-year raises, backfilled corrections, or malformed input (invalid dates, non-ISO currency codes, negative salary).
**Agreement:** Both external critiques flagged this; codex treats it as blocking, claude treats it as an ambiguity/validation gap.
**Recommendation:** Keep the one-row-per-year design (it matches WorkDay's typical annual-snapshot pattern) but state it explicitly as an assumption in AR-2.1, and add lightweight validation requirements: `base_salary >= 0`, `bonus >= 0`, `currency` matches a 3-letter uppercase pattern, `rating_year`/`effective_year` within a sane range (e.g. not before 1990, not more than 1 year in the future). This doesn't need to be exhaustive, just enough that malformed data fails loudly instead of silently.

### Missing indexes (non-blocking, both external critiques)

**Issue:** FR-1.4's recursive hierarchy traversal, FR-2.2's "latest by year" query, and FR-3.2's "last N ratings" query are all defined without the indexes that make them performant: `employees(manager_id)`, `salary_history(employee_id, effective_year)`, `rating_history(employee_id, rating_year)`.
**Recommendation:** Add these three indexes to the Data Requirements section. This is cheap to specify now and removes ambiguity for the implementer.

### Security checklist marked N/A (non-blocking, both external critiques)

**Issue:** The spec marks Security as N/A on the grounds that this is a local, single-file, no-network database — but it stores compensation and performance-rating data, and `initDatabase(path)` accepts an arbitrary file path.
**Agreement:** Both external critiques suggest upgrading this from N/A to an explicit, scoped statement rather than dropping it.
**Recommendation:** Change the checklist item to `[x]` with a note: prepared statements are mandatory for all string inputs (already implied by AR-1.1, make it explicit as an AR), the SQLite file should be created with restrictive permissions (owner read/write only), and this assessment is scoped to local single-user use — revisit if the app ever adds a server/API layer or multi-user access.

### Query behavior ambiguity (non-blocking, claude + codex)

**Issue:** FR-1.4 doesn't state whether the traversal result includes the starting node, what order results come back in, or what happens for very deep/large histories (FR-3.2/`getSalaryHistory` could return decades of rows with no limit).
**Recommendation:** State explicitly: descendant/ancestor queries exclude the starting employee and return results in top-down (or unspecified but consistent) order; `getSalaryHistory`/`getRatingHistory` (full-history functions) have no limit by design since the underlying data volume (per employee, per year) is inherently small — this is different from the org-wide `getAllEmployees` case, which is the one that actually needs to handle scale.

### Node.js/TypeScript stack stated as assumption, not decision (non-blocking, codex)

**Issue:** codex notes `ARCHITECTURE.md` still lists the runtime as TBD, while this spec commits to Node.js/TypeScript and `better-sqlite3`.
**Recommendation:** No change needed to the spec itself — this was a deliberate decision made with the user during this spec's clarifying-questions phase, not an unstated assumption. Recommend updating `specs/ARCHITECTURE.md`'s Tech Stack table (Runtime: Node.js/TypeScript, Data: SQLite via better-sqlite3) once this spec is finalized, so the project-level doc reflects the decision instead of showing TBD.

## Additional Requirements Identified

- Write/mutation function signatures (see above) — new FRs needed.
- `end_date` column and "active employee" definition — new FR needed on `employees`.
- Three supporting indexes — addition to Data Requirements.
- Basic field validation (salary/bonus non-negative, currency shape, year ranges) — new FR or AR.
- Explicit `ON DELETE` behavior for both foreign key relationships — new AR.

## Ambiguities Requiring Clarification

- Is `country` intended to hold a full country name or an ISO code? (Currently just "raw location/country value" — fine to leave open until the WorkDay Import spec sees real data, but worth a one-line note in Constraints acknowledging it's unresolved.)
- Should `getSalaryHistory`/`getRatingHistory` ever need a limit/pagination parameter, or is per-employee history volume inherently small enough that this is a non-issue? (Recommendation above proposes resolving this rather than leaving it open.)

## Summary of Required Changes

1. Add mutation/write functions (`upsertEmployee`, `reassignManager`, `upsertSalaryRecord`, `upsertRatingRecord`) as new FRs under Feature 4, with a stated per-call transaction boundary.
2. Add an `end_date` (nullable) column to `employees` and define "active" as `end_date IS NULL`; note this resolves the Headcount Dashboard's headcount-total requirement.
3. Add an AR stating `ON DELETE RESTRICT` for `manager_id` (until reports are reassigned) and `ON DELETE CASCADE` for `salary_history`/`rating_history`.
4. Add the three supporting indexes to Data Requirements.
5. Add lightweight validation requirements (non-negative salary/bonus, currency format, sane year ranges) and state the one-row-per-employee-per-year assumption explicitly in AR-2.1.
6. Upgrade the Security checklist item from N/A to addressed, citing prepared statements (make AR-1.1 explicit about this) and file-permission handling for `initDatabase`.
7. Clarify FR-1.4/FR-3.2 result ordering, inclusion of the starting node, and confirm full-history functions are intentionally unbounded.
8. Once this spec is finalized, update `specs/ARCHITECTURE.md`'s Tech Stack table to reflect the Node.js/TypeScript + better-sqlite3 decision (separate from this spec's own scope).
