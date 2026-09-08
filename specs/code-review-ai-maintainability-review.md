# Spec Review: API-to-Browser Contract Tests

## Overview

This spec adds test-only assertions that real Express API responses satisfy the
browser validators that consume them. It targets a specific drift risk without
changing runtime behaviour, production code, or project architecture.

## Approach Summary

- Extend existing HTTP route tests rather than create a new harness.
- Import and call `isValidPayload`, `isValidManagerOptions`,
  `isValidContractorList`, and `isCreatedContractor` against successful
  response bodies.
- Cover populated and nullable employee-details variants, contractors, manager
  options, contractor lists, and successful contractor mutations.

This is well-justified: the validators and APIs already exist independently,
and the project already imports browser ES modules directly into Node tests.

## Risks

| Risk | Likelihood | Impact | Addressed? |
| --- | --- | --- | --- |
| Only a happy-path payload is asserted, allowing nullable or contractor-specific drift | Low | Medium | Yes; the spec explicitly requires those variants. |
| Tests duplicate current endpoint field assertions without exercising the browser validator | Low | Low | Yes; each new assertion calls the validator directly. |
| Browser-module imports need a separate toolchain | Low | Low | Yes; existing tests already import the same ES modules. |

Security: not applicable. The change introduces no user input, API endpoint,
authorization change, external resource, command execution, or data storage.

## Complexity Hotspots

1. **Choosing existing test cases — low complexity.**
   `test/server/employeeDetails.test.ts` already seeds populated, nullable, and
   contractor cases; `test/server/contractors.test.ts` already performs the
   required successful route calls. Add validator assertions to those cases
   rather than duplicate requests.
2. **Response-body ownership — low complexity.** A response body can be parsed
   only once, so retain each parsed body for both its current route assertions
   and the new validator assertion.

## Completeness Checklist Audit

| Item | Status | Notes |
| --- | --- | --- |
| Scope & acceptance criteria | PASS | Explicit routes, validators, variants, and no-production-code constraint. |
| Testing strategy | PASS | Uses the established HTTP test harness and existing validators. |
| Existing patterns compared | PASS | Browser ES modules and relevant server test files exist. |
| Dependencies justified | PASS | No dependencies or tooling changes. |
| Architecture & interfaces | PASS | Tests connect two existing interface boundaries only. |
| Error handling & failure modes | PASS | Error payloads are correctly excluded; route tests already cover them. |
| Security review | N/A | No security-relevant behaviour changes. |
| Performance impact | N/A | Negligible test-only assertions. |
| Rollout & migration | N/A | No deployed behaviour or persistent-data change. |
| Assumptions & risks | PASS | Bounded to existing validators; Headcount is explicitly out of scope. |

## Verdict

**READY.** The spec is small, bounded, and matches established test patterns.
It provides a direct regression signal for the server/browser drift it targets,
without introducing architecture work.

## Suggested Next Steps

`/spec-implement specs/code-review-ai-maintainability.md`
