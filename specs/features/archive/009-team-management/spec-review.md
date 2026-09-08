# Spec 009 Review: Team Management and Headcount Team Breakdown

## Overview

This spec adds durable manager-derived and custom teams, a dedicated static
creation page, and a saved-team summary that replaces Headcount's current
location/role table. It fits the application's existing local SQLite,
Express, and vanilla-browser architecture without changing the established
`/api/headcount` contract.

## Approach Summary

- Store a normalized team definition plus custom-membership join rows; derive
  line-manager membership live from the existing `manager_id` hierarchy.
- Provide separate read/create endpoints rather than extending the current
  Headcount payload or reusing contractor form options.
- Use a new `teams.html`/`teamLogic.js` pair following the existing static
  page and DOM-free helper pattern.
- Replace only Spec 008's location/role Team breakdown; retain the chart,
  reporting-team filters, headline, and position-by-region matrix.
- Use explicit decisions where alternatives existed: active full descendant
  subtree excluding the manager for manager teams; active imported employees
  only for custom membership; saved-team rows independent of chart filters.

## Risks

| Risk | Likelihood | Impact | Spec coverage |
| --- | --- | --- | --- |
| Manager membership becomes stale after a reimport or reassignment | Medium | High | Addressed: FR-2.2 derives it at read time and requires regression tests. |
| Team foreign keys unexpectedly break `deleteEmployee()` | Medium | Medium | Addressed: FR-2.4 and AR-2.1 require restrictive references and explicit conflict behavior. |
| The two Headcount requests produce confusing partial-failure UI | Medium | Medium | Addressed: FR-3.2 preserves Headcount results and isolates a team-load failure. |
| The new custom-row UI accepts malformed or duplicate selections | Medium | Medium | Addressed: FR-1.3, FR-2.5, AR-1.1, and browser-logic tests. |
| Case-insensitive uniqueness differs for unusual non-ASCII names under SQLite `NOCASE` | Low | Low | Addressed for the local product's normal team labels; document this implementation choice when updating the schema contract. |

## Security Assessment

The feature accepts user-controlled team names and IDs, but the spec requires
server-side type/domain validation, same-origin protection for writes,
transactional persistence, fixed safe errors, and `textContent` for every
server-derived DOM value. The application remains local and single-user; this
feature adds neither external commands/resources nor additional sensitive-data
exposure. No blocking security issue found.

## Complexity Hotspots

1. **Team invariants across two tables.** SQLite can constrain each row but
   cannot ensure that only custom teams receive member rows; AR-2.1 correctly
   assigns this to transactional application validation.
2. **Live membership resolution.** `getDescendants()` already implements the
   required active, full-subtree traversal, including traversal through an
   inactive intermediate. The implementation must preserve that behavior while
   returning an inactive saved manager's stored name and a zero/active count.
3. **Independent Headcount loads.** The current page has one fetch and a
   single error path. FR-3.2 gives enough direction to split these outcomes
   without regressing the chart's current full-page failure handling.
4. **Five duplicated nav blocks.** This is intentional repository convention;
   served-page assertions should cover all of them.

## Completeness Checklist Audit

| Item | Status | Notes |
| --- | --- | --- |
| Scope & acceptance criteria | PASS | Radio modes, membership semantics, Headcount replacement, and non-goals are explicit. |
| Testing strategy | PASS | DB, server, browser-logic, navigation, and regression suites are named. |
| Existing patterns compared | PASS | The spec correctly references the static-page, DAL, transaction, and safe-DOM patterns. |
| Dependencies justified | PASS | No dependency is added. |
| Architecture & interfaces | PASS | The schema roles and exact teams-summary response are pinned; `/api/headcount` remains stable. |
| Error handling & failure modes | PASS | Covers malformed bodies, Origin rejection, safe errors, empty options, and partial Headcount loading. |
| Security review | PASS | Input, CSRF-equivalent origin guard, safe rendering, and error exposure are addressed. |
| Performance impact | PASS | Local roster-sized recursive membership reads and summary-only response are appropriate. |
| Rollout & migration | PASS | New additive tables require no employee-data migration or backfill. |
| Assumptions & risks | PASS | The product choices and referential-integrity rule are explicit. |

## Verdict

**READY** — the spec is implementation-ready. Its requirements match the
existing codebase, resolve the previously identified integrity/API/empty-state
gaps, and contain sufficient acceptance and regression coverage for the
cross-cutting change.

## Suggested Next Steps

`/spec-implement 009-team-management`
