# Implementation Summary: 012-contractor-lifecycle-table-and-manager-resolution

**Status:** Completed
**Date:** 2026-09-07
**Implementation Review:** Required

## Overview

Implemented the contractor lifecycle table and removed all contractor-owned
WorkDay-link behavior. Contractors can now be added, edited, assigned an
imported line manager by human-readable selection, and permanently deleted.
Manager WorkDay identity remains import-owned and is never displayed in the
Contractors experience. Imports now process only imported employees and leave
contractors untouched.

## Review Baseline

- **Commit before implementation:** unavailable — this directory is not a Git
  worktree.
- **Pre-existing local changes:** unknown — Git status is unavailable.
- **Baseline tests:** 269 passing, 0 failing after local-loopback permission
  was granted. The ordinary sandbox cannot bind the HTTP test server.

## Team Execution

| Teammate | Role | Tasks completed |
| --- | --- | --- |
| `scout_conventions` | Rules scout | Identified repository conventions and living-documentation updates. |
| `database_import` | Data/import implementation | Removed contractor linkage, added migration and lifecycle mutations, and simplified reconciliation. |
| `contractor_ui` | Browser implementation | Replaced cards with table actions and added manager-selection and delete behavior. |

## Files Modified

- `src/db/{schema,connection,types,queries,mutations,index}.ts` — simplified
  contractor storage, transactional legacy migration, and atomic lifecycle
  mutations.
- `src/import/{reconcile,types}.ts`, `src/server/app.ts`, and
  `public/index.html` — removed contractor matching and review contracts.
- `public/{contractors.html,contractorLogic.js}` — management table, manager
  picker, and edit/delete interactions without user-visible IDs.
- Database, import, server, and browser-helper tests — lifecycle, migration,
  unambiguous manager, import-preservation, and safe-route coverage.
- `specs/docs/` — contractor/import behavior, schema/API contract,
  conventions, provenance, and run metadata.

## Test Results

- `npm run typecheck` — passed.
- Focused contractor/server/browser tests — passed, **25/25**.
- `npm test` — passed, **269/269**. Local loopback permission was required
  for Express integration tests.

## Spec Adherence

| Requirement | Status | Implementation | Verification |
| --- | --- | --- | --- |
| FR-1.1–FR-1.2 | Done | Active contractor table, add/edit flow, empty state | Contractor browser and server tests |
| FR-1.3, FR-2.2 | Done | Name-led manager picker with human context and ambiguity rejection | Browser, database, and route tests |
| FR-1.4 | Done | Confirmed permanent deletion with narrow endpoint | Database and server tests |
| FR-2.1, AR-2.2 | Done | Import-owned employee/supervisor reconciliation, no contractor path | Import and preview/confirm tests |
| FR-2.3, AR-2.1 | Done | Transactional legacy-table rebuild removes contractor WorkDay link data | Database migration tests |
| FR-2.4, AR-2.3 | Done | Origin-checked narrow mutations, fixed errors, DOM-safe helpers | Typecheck and API/browser tests |

## Deviations from Spec

None.

## Review Remediation

The implementation review found that the line-manager form defaulted to `No
manager` when a saved manager had become ineligible. The form now retains that
manager as a disabled, human-readable current value. Saving it is rejected by
the existing server validation; the relationship cannot be cleared unless the
user explicitly selects `No manager`.

## Review Outcome

The implementation review was approved after the stale-manager remediation.
