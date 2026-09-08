# Spec 002 (WorkDay Import Screen): Consolidated Critique (v3)

## Overview

**Critiques received from:** main-agent, codex (gpt-5.6-terra), claude (haiku)
**Critiques missing:** none.

This round confirms the v2 fixes hold: `reassignManager`'s resolve-before-
call sequencing, `getAllEmployees()`'s active-only default fixing the
overwrite bug, and the removal of the broken scope-root mechanism were all
independently re-verified against the actual code by all three reviewers.
One factual claim repeated across three rounds — that `better-sqlite3`
supports nested transactions via automatic savepoints — was directly
verified against the library's own documentation this round and confirmed
true. But this round surfaces one confirmed-infeasible requirement (AR-4.5)
and one new, well-reasoned safety concern (an unguarded destructive path)
that's worth addressing before implementation.

## Executive Summary

Two real issues, one previously-known and now proven wrong three ways, one
genuinely new:

1. **AR-4.5's decompression-bomb guard cannot work as specified** — all
   three reviewers, independently, confirm ExcelJS's `readFile`/`load` (the
   API AR-1.1 commits to) fully decompresses the workbook into memory
   before any application code can inspect its size. Codex additionally
   cites a specific published security advisory describing uncontrolled
   decompression in ExcelJS through the version this spec references.
2. **(New, from codex)** The single-team-at-a-time constraint is honestly
   documented, but nothing stops a user from accidentally uploading a
   *different* team's file and having it silently inactivate the entire
   existing team — a successful, irreversible, undetected mistake. "Don't
   do that" in the Constraints section isn't a safeguard.

## Consolidated Requirements Feedback

### AR-4.5's uncompressed-size check is not achievable with the chosen API (main-agent + codex + claude, independently)

**Issue:** `workbook.xlsx.readFile()`/`.load()` (AR-1.1) decompress the
entire ZIP archive before returning — there's no hook to inspect size
incrementally "as it reads." By the time any check could run, the
allocation this guard is meant to prevent has already happened. Codex adds
that even a hypothetical incremental check would need to cover more than
worksheet XML — `sharedStrings`, styles, and embedded media can also be
decompression-bomb vectors — and cites a published advisory
(GHSA-7cvf-3r55-r39q) describing exactly this class of issue in ExcelJS
through the version referenced here.
**Agreement:** Total, three independent reviewers, with codex providing
external verification via ExcelJS's own source and a security advisory.
**Recommendation:** Replace AR-4.5's approach with one of:
- A ZIP preflight *before* handing the file to ExcelJS at all — inspect
  the archive's central directory for declared vs. actual entry sizes,
  total entry count, and compression ratio, rejecting anything suspicious
  before any entry is decompressed.
- Switch to ExcelJS's streaming reader (`exceljs/stream/xlsx`), which
  processes entries incrementally and could support a running size check —
  but this changes AR-1.1's API choice, not just AR-4.5.
- At minimum, if neither is adopted, reword AR-4.5 to state the actual,
  weaker guarantee honestly (a post-hoc memory/time bound after the file is
  already loaded) rather than implying a pre-decompression guard.

### No safeguard against an accidental cross-team import (codex, new this round)

**Issue:** The single-team-at-a-time constraint (added in v2) is real and
correctly disclosed, but it's purely a documentation note — the import
endpoint will happily accept a different manager's file and soft-inactivate
every employee absent from it, which in practice means the entire
previously-imported team. There's no confirmation step, no preview, and no
recovery path (Out of Scope already rules out undoing a successful import).
**Recommendation:** Add a lightweight safety net rather than reverting to
the heavier persisted-ownership-marker design (direction 1): before
committing, the screen shows a preview of what the import *would* do
(counts of added/updated/inactivated, or better, the actual names about to
be soft-inactivated) and requires an explicit confirmation click when the
inactivated count is large relative to the current active headcount — this
catches the "wrong file" mistake without needing schema changes. This is a
UX addition to Feature 4, not a Feature 2 redesign.

## Additional Requirements Identified

- **FR-3.2's "never holds more than the source shows" is now imprecise**
  (codex): since FR-2.3 preserves ratings for soft-inactivated employees
  indefinitely, the claim only holds for employees *present in the current
  import*. Reword to scope it correctly.
- **Text-cell validation should cover more than identifiers** (codex):
  `name`, `position`, `country`, `currency`, and rating-value cells can
  also be formulas, rich-text, or error cells — FR-1.3's string-type check
  currently only covers `Employee ID`/`Direct Supervisor ID`.
- **Define what counts as a "data row" for the 5,000-row cap** (codex):
  blank/sparse rows via `eachRow` need an explicit rule so the cap has one
  obvious meaning.
- **A hierarchy cycle in source data should be a defined validation
  failure** (codex), not an incidentally-surfaced `CycleError` — route it
  through the same FR-5.1 abort path with a clear message.
- **FR-4.2's Verify line overclaims** (codex): `accept=".xlsx"` is a
  browser hint, not enforcement — a user can still select another file
  type via "all files." Soften the Verify wording (server-side rejection
  via FR-1.1 is what's actually authoritative here, and already covers it).
- **Startup cleanup of stale uploads** (codex, carried from v1/v2): since a
  crash/`SIGKILL` can't run the request-scoped cleanup in AR-4.2, add a
  one-time sweep of the upload temp directory at server startup.
- **FR-5.2's in-flight guard is process-scoped, not multi-process-scoped**
  (claude): two separately-started `npm start` processes would each have
  their own guard and could import concurrently. Worth an explicit note
  that this assumes a single running instance (consistent with spec 001's
  single-connection model already assumed elsewhere), rather than a new
  mechanism.
- **AR-4.4's directory check has a minor TOCTOU race** (claude): `if
  (!existsSync) mkdir` can lose a race between two startups; recommend
  `fs.mkdirSync(dir, { recursive: true })` directly (idempotent, no
  existence check needed).
- **Minor wording clarifications** (claude): FR-2.2 should state explicitly
  that a blank `Direct Supervisor ID` always succeeds (no validation to
  fail); FR-1.3's invalid-numeric-cell case should specify the shown error
  message text.

## Ambiguities Requiring Clarification

- What form the accidental-cross-team safeguard should take (a raw count
  threshold, a percentage of current headcount, or always requiring
  confirmation of *any* inactivation) — a product decision, not something
  to default silently.

## Confirmed, No Change Needed

- `better-sqlite3`'s nested-transaction/savepoint behavior (AR-5.1) —
  verified directly against the library's published documentation this
  round: "Transaction functions can be called from inside other transaction
  functions. When doing so, the inner transaction becomes a savepoint,"
  with correct rollback-to-savepoint on error. No longer an open assumption.
- `reassignManager`'s throw-on-unresolved-id behavior and FR-2.2's
  resolve-before-call sequencing — re-verified against
  [mutations.ts](/Users/borgf/Documents/employee_reports/src/db/mutations.ts)
  by all three reviewers.
- `getAllEmployees()`'s active-only default and its effect on FR-2.3's
  overwrite-prevention — re-verified against
  [queries.ts](/Users/borgf/Documents/employee_reports/src/db/queries.ts).

## Summary of Required Changes

1. **Replace AR-4.5's infeasible uncompressed-size check** with a
   ZIP-preflight approach, a streaming-reader switch, or an honestly-worded
   weaker guarantee. Blocking — as written, it describes behavior the
   chosen library cannot provide.
2. **Add a confirmation/preview safeguard** against an accidental
   cross-team import, given the single-team constraint has no machine
   enforcement. Strongly recommended before implementation, though not a
   structural blocker the way #1 is.
3. Scope FR-3.2's "never holds more" claim to employees present in the
   current import.
4. Extend text-cell-type validation beyond identifiers to all text fields.
5. Define "data row" precisely for the 5,000-row cap.
6. Route a source-data hierarchy cycle through FR-5.1's abort path
   explicitly.
7. Soften FR-4.2's Verify wording about the `accept` attribute.
8. Add startup cleanup of stale uploads; use `mkdirSync(..., {recursive:
   true})` in AR-4.4 to remove the TOCTOU race.
9. Note FR-5.2's guard assumes a single running server process.
10. Minor wording tightening: FR-2.2's blank-supervisor case, FR-1.3's
    error-message content.
