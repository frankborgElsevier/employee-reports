# Spec Review: 007 — Manual Contractor Management

Reviewed 2026-09-03 against the updated `spec.md`, project guidelines,
architecture, and the current database, import, server, and browser code.

## Overview

The spec introduces manually managed contractors without contaminating the
WorkDay import lifecycle. Contractors appear in both existing data screens:
as labelled purple Headcount cards and as intentionally partial Employee
Details records.

## Approach Summary

- Add an additive `employees.worker_type` discriminator and preserve the
  current employee-only read default.
- Make Headcount and Employee Details explicitly request the combined active
  roster; keep reconciliation explicitly employee-only.
- Create contractors through a transactional mutation, generated
  `contractor:<UUID>` ids, and an employee-only manager guard in
  `reassignManager()`.
- Reuse current static-page/vanilla-JS patterns and tree/filter logic; add a
  Contractor screen and clear unavailable WorkDay fields with `—`.
- Retain local same-origin protection for writes and define fixed JSON errors
  for malformed JSON, invalid bodies, and invalid managers.

The shared-table decision is well justified. It preserves the existing
employee hierarchy foreign key and avoids a parallel roster/tree model.

## Risks

| Risk | Likelihood | Impact | Spec coverage |
|---|---|---|---|
| A future query omits `workerType` and sends contractors through reconciliation. | Medium | High | Addressed by a default employee-only query contract, explicit `all` callers, and import regression tests. |
| Four-bucket Headcount totals diverge from visible cards. | Medium | Medium | Addressed by a fixed purple column and an explicit grand-total invariant; update `positionRegionBreakdown()` and its zero-data case together. |
| A future caller makes a contractor a manager. | Low | Medium | Addressed at the `reassignManager()` data boundary, rather than only in the browser route. |
| Existing databases do not receive `worker_type`. | Low | High | Addressed by the project's established guarded `PRAGMA table_info`/additive-migration pattern and lifecycle tests. |

### Security review

The feature accepts browser-provided identity and manager data. The spec
requires server-side validation, transactional writes, parameterised database
access through the existing data layer, DOM-safe rendering, and the existing
same-origin check for the write route; no commands or remote resources are
introduced. The local server remains intentionally unauthenticated, inherited
from current architecture. The route-local JSON-parser requirement correctly
prevents parser internals reaching the browser.

## Complexity Hotspots

1. **Worker-type propagation.** Update the schema, migration, `Employee` type,
   row mapper, `getAllEmployees()` option, import calls, and both read routes
   in lockstep. The spec gives an adequate contract and test boundary.
2. **Employee Details partial rows.** Extend payload validation, table columns,
   filtering/sorting, and null rendering together. Skipping salary/rating
   lookups for contractors prevents unnecessary existing N+1 calls.
3. **Dashboard fourth bucket.** `chart-logic.js` and `headcount.html` currently
   encode three literal colour buckets. Contractor detection must precede
   country bucketing while preserving the existing external-manager behaviour.
4. **Scoped JSON parser.** Implement a route-local error callback after Origin
   validation and before the create handler so only malformed contractor JSON
   receives the specified fixed `400` response.

## Completeness Checklist Audit

| Item | Status | Notes |
|---|---|---|
| Scope & acceptance criteria | PASS | Both screens and intentionally unavailable fields are observable. |
| Testing strategy | PASS | DB, migration, import, API, public logic, and UI-state coverage are named. |
| Existing patterns compared | PASS | Uses existing migration, static UI, Origin, data-layer, and tree patterns. |
| Dependencies justified | PASS | No new dependency is needed. |
| Architecture & interfaces | PASS | Query option, mutation invariant, routes, and payload changes are explicit. |
| Error handling & failure modes | PASS | Fixed JSON parser/body/manager errors and UI failure states are specified. |
| Security review | PASS | Input, CSRF, rendering, and local-access exposure are covered. |
| Performance impact | PASS | No material new scale cost; contractor details avoid history reads. |
| Rollout & migration | PASS | Additive migration and import persistence are explicit. |
| Assumptions & risks | PASS | Meaningful risks and mitigation are documented. |

## Verdict

**READY.** The prior blockers are resolved: contractor inclusion in the
Headcount metric is decided, and the malformed-JSON plus manager-type
contracts are now deterministic. The two optional-manager/colour questions
repeat decisions already stated earlier; treat the Product Decisions section
as authoritative during implementation.

## Suggested Next Steps

Proceed with `/spec-implement 007-contractor-management`.

Before implementation, optionally remove or relabel the two duplicated open
questions as future product considerations so they are not mistaken for
implementation blockers.
