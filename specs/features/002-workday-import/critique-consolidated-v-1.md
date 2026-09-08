# Spec 002 (WorkDay Import Screen): Consolidated Critique (v1)

## Overview

**Critiques received from:** main-agent, codex (gpt-5.6-terra), claude (haiku)
**Critiques missing:** none — all three adapters returned findings.

All three critiques converged independently on the same top issues (rating
schema incompatibility, `getConnection` not being public, and — most
importantly — an unsafe reconciliation scope), which is a strong signal
these are real problems, not one model's idiosyncratic take.

## Executive Summary

The spec is well-structured and each FR is individually testable, but it
has one **severe, previously-unidentified data-loss risk** (FR-2.3's
delete-on-absence logic, flagged independently by codex and claude), one
confirmed hard blocker (AR-3.1's un-applied schema change), two API/tooling
assumptions that don't match the actual codebase, and a cluster of
under-specified edge cases and security hardening items that are normal for
a first draft but should be closed before implementation.

## Consolidated Requirements Feedback

### Reconciliation scope (new, severe — codex + claude)

**Issue:** FR-2.3 deletes every employee in the database that's absent from
the *uploaded file*. But the reference report is explicitly scoped to one
manager's team ("Team Market Range Analysis for **Managers**"). If a second
import is ever run for a *different* manager's team — or the same manager's
report is ever exported in a smaller/filtered form — every employee outside
that file's scope gets deleted, including entire teams imported previously.
An accidentally truncated or empty export would wipe the whole database.
**Agreement:** Both external critiques flagged this independently, and
claude additionally connects it to a second problem: spec 001 modeled
departure as a *soft* signal (`end_date`, active/inactive queries) precisely
to preserve history, while FR-2.3 hard-deletes (cascading away
`salary_history`/`rating_history`) — the opposite choice, for reasons the
spec doesn't state.
**Recommendation:** Before implementing, decide explicitly: (a) scope
FR-2.3's "absent" comparison to only the subtree under whichever manager
this file represents (e.g., auto-detect the file's root via FR-2.2's
external-supervisor rule, then use spec 001's `getDescendants` to bound the
diff to that subtree, not the whole `employees` table), and/or (b) reconsider
whether "absent" should hard-delete at all versus setting `end_date` (soft
inactivate), preserving history the way spec 001 intended. This is not a
polish item — it's a correctness/data-safety gap that should block sign-off.

### Rating schema readiness (all three)

**Issue:** AR-3.1 already flags that spec 001's `rating_history` needs
`rating_year` → `rating_period`, but codex and claude both independently
verified this hasn't happened yet — `schema.ts`, `types.ts`, `mutations.ts`,
and `queries.ts` all still use `rating_year` today.
**Agreement:** Unanimous. Codex adds a detail the spec doesn't address:
`getLastRatings` currently orders by `rating_year DESC` — with only three
fixed relative labels, "descending" has no natural meaning, so this query
needs its own redefinition (e.g., return rows in a fixed period order),
not just a column rename.
**Recommendation:** Treat AR-3.1 as the literal first step of implementing
this spec — run `/spec-update` on spec 001 for the schema change *and* the
`getLastRatings` behavior, before starting Feature 3's code.

### Blank-rating reimport (all three)

**Issue:** FR-3.2 says ratings are "replaced, not accumulated," but the
underlying `upsertRatingRecord` only inserts/updates by key — there's no
delete operation. If a `rating_period` that was populated in one import is
blank in the next (data legitimately ages out of the 3-slot window), the
stale row is never removed.
**Recommendation:** Add an explicit FR requiring the importer to delete any
existing `rating_history` row for an employee whose `rating_period` is not
present (non-blank) in the current file's row for that employee — this
likely also requires a new `deleteRatingRecord`-style function in spec 001,
compounding the AR-3.1 dependency.

### `getConnection()` is not public API (codex + claude)

**Issue:** AR-5.1 has the import logic call `getConnection()` directly to
build a whole-import transaction, but `src/db/index.ts` (the intended public
barrel — codex notes the "consumers import only the barrel" convention)
exports only `initDatabase`/`closeDatabase`, the query functions, and the
mutation functions — not `getConnection`.
**Recommendation:** Either export `getConnection` from the barrel
deliberately (and accept that it exposes the raw `better-sqlite3` handle to
callers), or — likely cleaner — add a new exported function to spec 001's
data-access layer purpose-built for this (e.g. `runInTransaction(fn)`),
so the import layer never touches the raw connection directly.

### Missing tooling/dependencies (codex + claude)

**Issue:** `package.json` has only `better-sqlite3` as a dependency and no
`start` script. Express, Multer, ExcelJS, and `open` are all referenced by
the spec's ARs but not present.
**Recommendation:** Not a spec defect exactly (specs don't need to edit
`package.json`), but the spec should say explicitly that adding these four
dependencies and a `start` script is part of this spec's implementation
work, so it isn't discovered mid-implementation.

## Additional Requirements Identified

- **Duplicate `Employee ID` within one file** (all three): must be defined
  as invalid (triggering FR-5.1's abort), not silently resolved to "last
  write wins."
- **Malformed/non-`.xlsx` file upload** (all three): ExcelJS throwing on an
  unparseable file needs an explicit FR tying it to the FR-4.3 error-display
  path.
- **Negative derived bonus** (all three): FR-1.4 should say directly that
  `Target Cash < Base Pay` is invalid data (aborts per FR-5.1), not leave it
  to be inferred from spec 001's existing validation.
- **FR-2.3's deletion algorithm** (main-agent + claude, codex implicitly via
  performance note): name the actual procedure ("repeatedly delete any
  to-delete id with zero remaining direct reports until the set is empty")
  instead of describing the invariant only.
- **Header matching precision** (codex + claude): define case-sensitivity,
  trimming, and duplicate-header handling explicitly.
- **Numeric/formula cell parsing** (all three): define behavior when a
  numeric column's cell is a string, formula result object, or empty.
- **"Added vs. updated" counts** (codex + claude): define whether an
  idempotent re-import (no actual value changes) counts as 0 updates or as
  many upserts as rows.
- **Multer hardening** (codex + claude): explicit file-size/field limits,
  server-side structural validation of the uploaded archive, and
  archive-bomb protection — client-side `accept=".xlsx"` is not a security
  control.
- **Temp-file cleanup guarantee** (codex + claude): must cover parse
  failure, validation abort, and process crash/shutdown, not just the
  success path.
- **CSRF / cross-origin POST to localhost** (codex + claude, independently):
  localhost-only binding does not stop another page in the user's browser
  from submitting a cross-site form to the import endpoint. Needs an
  Origin check, CSRF token, or per-launch token, plus an explicit statement
  of the local-machine trust assumption this spec is accepting.
- **Error message sanitization** (codex + claude): validation errors shown
  to the user must not leak stack traces, file-system paths, or raw
  parser/database errors, and must be rendered as text (not HTML) to avoid
  reflecting uploaded content as markup.
- **Performance/scale limits** (all three): the reference file is 43 rows;
  behavior at hundreds/thousands of rows — including whether ExcelJS's
  in-memory load and `better-sqlite3`'s synchronous writes block the event
  loop long enough to delay the FR-5.2 409 check — is unmeasured and should
  get an explicit stated limit, not just an open checklist item.
- **"In-flight" import definition** (claude): FR-5.2 needs to define how an
  abandoned/crashed import (never completes, never releases the lock) is
  detected and cleared, not just the happy-path duration.

## Ambiguities Requiring Clarification

- Whether FR-2.3 should hard-delete or soft-inactivate absent employees
  (ties directly to the reconciliation-scope issue above — this needs a
  decision from the user, not an inferred default).
- Whether this app will ever import more than one manager's team into the
  same database (determines whether the reconciliation-scope fix is
  mandatory now or can be deferred with an explicit single-team constraint
  documented instead).

## Summary of Required Changes

1. **Fix FR-2.3's reconciliation scope** — bound deletion to the imported
   file's own hierarchy subtree, and/or switch to soft-inactivate
   (`end_date`) instead of hard delete, per the Reconciliation Scope
   finding above. Treat as blocking.
2. Confirm AR-3.1's spec 001 update also redefines `getLastRatings` for
   period-based (not year-based) ordering, and adds a delete/replace path
   for ratings that go blank on reimport (FR-3.2 gap).
3. Replace the `getConnection()` dependency in AR-5.1 with either an
   explicit export or a new `runInTransaction`-style function added to spec
   001's public API.
4. Add explicit FRs for: duplicate Employee IDs, malformed file uploads,
   negative derived bonus, and a named leaf-to-root deletion procedure.
5. Tighten ambiguous language: header matching rules, numeric/formula cell
   handling, and "added vs. updated" count semantics.
6. Add a security/hardening AR covering Multer limits, server-side upload
   validation, temp-file cleanup guarantees, CSRF/Origin protection, and
   error-message sanitization.
7. Note in Constraints that Express/Multer/ExcelJS/`open` and a `start`
   script are net-new additions to `package.json` as part of implementing
   this spec.
8. Replace the unchecked Performance checklist item with a stated file-size/
   row-count limit, even if provisional, rather than leaving it open.
