# Implementation Summary: 010-contractor-reimport-and-headcount-simplification

**Status:** Completed
**Date:** 2026-09-07
**Implementation Review:** Required

## Overview

Implemented safe contractor reconciliation during WorkDay re-imports. A
contractor's optional, exact WorkDay worker ID consumes its corresponding
workbook row without changing the contractor. Confirmed imports persist a
whole-roster matched/needs-review status and return a separate review count;
the import page links to Contractors only when review is needed. The
Contractors screen now supports list-and-edit management of the WorkDay ID and
line manager. The Headcount Team breakdown was removed.

## Review Baseline

- **Commit before implementation:** unavailable — this directory is not a Git
  worktree.
- **Pre-existing local changes:** unknown — Git status is unavailable.
- **Baseline tests:** 264 passing, 0 failing after local-loopback permission
  was granted. The ordinary sandbox cannot bind the HTTP test server to
  `127.0.0.1`.

## Team Execution

| Teammate | Role | Tasks completed |
| --- | --- | --- |
| `scout-conventions-and-standards` | Rules scout | Identified the data-access, browser safety, API, migration, and living-doc constraints. |
| `data-import` | Data/import implementation | Added matching fields, guarded migration/index, exact consumed-row reconciliation, and data tests. |
| `browser-contractor` | Contractor browser implementation | Added post-import review link plus contractor list/edit browser behavior and helper tests. |
| `headcount-cleanup` | Dashboard cleanup | Removed the Team breakdown rendering, helper, and tests. |
| `scout-conventions-and-standards-followup` | Review-remediation scout | Confirmed that persisted-manager display must be decoupled from active-only selectable options while preserving atomic validation. |

## Files Created

- `specs/features/010-contractor-reimport-and-headcount-simplification/implementation-summary.md` — this handoff.

## Files Modified

- `src/db/{schema,connection,types,queries,mutations,index}.ts` — contractor
  import-link fields, additive migration, partial unique index, exact-key
  validation, active-contractor query, atomic update, and match-status write.
- `src/import/{types,reconcile}.ts` — consumed contractor rows and separate
  `contractorsNeedingReview` result.
- `src/server/app.ts` — preview/confirm response extension, contractor
  list/update routes, and a persisted-manager projection that retains an
  inactive manager for safe stale-selection handling.
- `public/{index,contractors,headcount}.html`, `public/contractorLogic.js`,
  `public/chart-logic.js` — review link, contractor management UI, and Team
  breakdown removal.
- Database, import, server, contractor-browser, and dashboard tests — exact
  matching, transaction rollback/commit, API contract, atomic edit, and
  removed UI coverage.
- Living docs under `specs/docs/` — contractor/import/dashboard behavior,
  import API, schema migration, strategy, and spec provenance.

## Test Results

- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm test` — passed, **269/269**. Local loopback permission was required for
  the Express integration tests.
- Static removal check — no runtime `Team breakdown` or
  `locationRoleBreakdown` reference remains; the only occurrences are the
  intentional regression assertions and explanatory documentation.

## Spec Adherence

| Requirement | Status | Implementation | Test/verification |
| --- | --- | --- | --- |
| FR-1.1–FR-1.3, AR-1.1 | Done | `reconcile`, match-status mutation, preview/confirm responses | Data reconciliation and server preview/confirm tests |
| FR-1.2, AR-1.2 | Done | Exact trimmed WorkDay ID, guarded migration/index, consumed-row supervisor fallback | Database lifecycle and import reconciliation tests |
| FR-2.1–FR-2.4 | Done | Contractor list/edit UI, list/update routes, atomic mutation | Browser helper and contractor route tests |
| FR-3.1, AR-3.1 | Done | Removed Team breakdown helper and renderer | Dashboard page and static removal checks |

## Review Remediation

The first implementation review found that an employee manager made inactive
by a later import was omitted from a contractor's list projection. That could
make the browser submit `manager: null` when saving an otherwise unrelated
WorkDay-ID edit. The list projection now reads the persisted manager directly,
so the existing browser stale-option behavior displays it and preserves the
selected value. The existing atomic update validation still rejects that stale
manager with reload guidance, leaving both editable fields unchanged. Server
coverage now exercises the full re-import, list, failed-save, and unchanged
state sequence.

## Deviations from Spec

None.

## Conventions and Standards Applied

- **Sources:** `specs/PROJECT_GUIDELINES.md`, `specs/ARCHITECTURE.md`, data
  access/browser conventions, and the updated import, schema, and Headcount
  living docs.
- **Conflicts and how they were resolved:** None. Spec 009 remains deferred;
  no saved-team or replacement Team-breakdown work was reintroduced.

## Review Handoff

Run `/spec-implementation-review 010-contractor-reimport-and-headcount-simplification`
before closing this spec.
