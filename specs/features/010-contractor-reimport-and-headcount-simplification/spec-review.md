# Spec 010 Review: Contractor Re-import Reconciliation and Headcount Simplification

## Overview

Spec 010 preserves manually managed contractors during WorkDay re-import,
matches them only by an explicit WorkDay worker ID, and sends unmatched cases
to contractor management. It also removes Headcount's derived Team breakdown
without changing the roster API, matrix, filters, or organisation chart.

## Approach Summary

- Add contractor-only WorkDay identity and latest-confirmed-import status using
  the existing additive SQLite migration pattern.
- Reuse the transactional preview/confirm reconciliation path for exact
  matching and rollback-safe status calculation.
- Consume a matched workbook row without changing contractor type or manager;
  use the existing external-manager fallback for supervisor references.
- Expand Contractors from an add form to a list with atomic ID/manager updates.
- Remove only `locationRoleBreakdown` and its Headcount UI/tests.

The safety choices are sound: exact matching, no fuzzy match or automatic
conversion, and no contractor ID collision with an imported employee ID.

## Risks

| Risk | Likelihood | Impact | Addressed? |
| --- | --- | --- | --- |
| Duplicate contractor/imported-worker identity | Medium | High | Yes — worker-ID collisions with active or inactive employees are rejected. |
| Matched contractor becomes an employee manager | Medium | High | Yes — supervisor references use the established external-manager fallback. |
| Preview leaks status changes | Medium | High | Yes — the existing reconciliation transaction rolls preview changes back. |
| Existing local databases miss new fields/index | Medium | Medium | Yes — additive, idempotent migration and migration testing are required. |
| Deferred saved-team work reintroduces a breakdown | Low | Medium | Yes — Spec 009 is archived and the constraint requires a new product decision. |

Security is appropriate for the local single-user application. State-changing
routes retain same-origin validation, server-side validation, fixed errors, and
safe DOM rendering; read projections exclude compensation and rating data. No
external command, third-party service, or new dependency is introduced.

## Complexity Hotspots

1. **Reconciliation ordering:** match detection must precede employee upsert,
   supervisor linking, salary/rating writes, and inactivation. The transaction
   boundary and desired outcome are explicit.
2. **Identity and migration invariants:** SQLite enforces contractor-only
   uniqueness, while mutations enforce the cross-worker-type collision rule.
   The spec distinguishes these responsibilities clearly.
3. **Preview/confirm payload threading:** the contractor review count must
   flow through the existing pending-token lifecycle without altering employee
   count semantics. The current reconciliation and route boundaries fit this.
4. **Management-page stale options:** imports can change manager eligibility;
   the spec requires a server recheck and preserves the user's unsaved values.

## Completeness Checklist Audit

| Item | Status | Notes |
| --- | --- | --- |
| Scope & acceptance criteria | PASS | Requirements and Verify lines cover import, review, management, and UI removal. |
| Testing strategy | PASS | Existing import, DB, server, contractor, and dashboard test areas are named. |
| Existing patterns compared | PASS | Reconciliation, migration, route, and DOM patterns exist in the codebase. |
| Dependencies justified | PASS | No new dependency is needed. |
| Architecture & interfaces | PASS | Data, APIs, UI, and client aggregation changes are explicit. |
| Error handling & failure modes | PASS | Covers invalid IDs/managers, rollback, stale options, and supervisor fallback. |
| Security review | PASS | Same-origin writes, fixed errors, explicit projections, and safe rendering are retained. |
| Performance impact | PASS | Matching remains bounded by the existing local import transaction. |
| Rollout & migration | PASS | Additive migration preserves existing contractor records. |
| Assumptions & risks | PASS | The formerly conflicting saved-team proposal is now deferred and archived. |

## Verdict

**READY** — the cross-spec conflict is resolved, and the specification gives
implementers sufficient behavior, data, API, migration, security, and test
guidance to deliver it safely.

## Suggested Next Steps

`/spec-implement 010-contractor-reimport-and-headcount-simplification`
