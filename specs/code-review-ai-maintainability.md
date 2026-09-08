# API-to-Browser Contract Tests

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-09-08.
> Implementation summary: `specs/implementation-summary-code-review-ai-maintainability.md`
> Implementation review: `specs/implementation-review-code-review-ai-maintainability.md`
> Documentation: updated in `specs/docs/`

## Summary

Add a small set of integration assertions proving that successful API payloads
conform to the browser validators that their screens already use. This closes
the current gap where server projections and client validation can each pass
their own tests while disagreeing with one another.

## Problem

`src/server/app.ts` constructs response payloads, while
`public/employeeDetailsLogic.js` and `public/contractorLogic.js` independently
validate those payloads in the browser. A future edit can change one side but
not the other, causing the screen to show its generic load-error state rather
than failing an automated test.

## Goals

- Verify real successful API responses pass the existing browser validators.
- Cover the response variants that carry nullable or worker-type-specific
  fields.
- Keep the change limited to tests; retain the existing defensive validators.

## Non-goals

- Creating a shared runtime schema, frontend build step, or framework.
- Adding a validator for `/api/headcount`, which has no existing standalone
  browser validator.
- Changing database migration strategy or reorganising page controllers.
- Changing any API payload or browser behaviour.

## Scope

In scope:

- `test/server/employeeDetails.test.ts`
- `test/server/contractors.test.ts`
- Imports from the existing `public/employeeDetailsLogic.js` and
  `public/contractorLogic.js` validator modules.

Out of scope:

- `src/server/`, `src/db/`, `src/import/`, and `public/*.html` production
  code.

## Proposed Approach

- In `test/server/employeeDetails.test.ts`, pass successful
  `/api/employee-details` response bodies to `isValidPayload`.
- Cover an imported employee with populated salary/ratings, an employee with
  nullable salary/rating values, and a contractor response. Existing endpoint
  tests may be extended rather than duplicated.
- In `test/server/contractors.test.ts`, pass successful
  `/api/contractor-form-options` responses to `isValidManagerOptions`;
  contractor-list responses to `isValidContractorList`; and successful create,
  detail-update, and manager-update responses to `isCreatedContractor`.
- Do not assert browser validators on error responses: those are not consumed
  as successful screen data and already have route-specific error tests.

## Acceptance Criteria

- A representative successful employee-details payload with populated salary
  and ratings passes `isValidPayload` in an HTTP route test.
- Successful employee-details payloads with nullable values and a contractor
  entry also pass `isValidPayload`.
- A successful manager-options payload passes `isValidManagerOptions`.
- Successful contractor list, create, detail-update, and manager-update
  payloads pass their corresponding existing validators.
- `npm test` fails if any of those server payloads no longer conform to the
  browser validator used by its screen.
- No production API or browser code changes.

## Testing

- Unit/Integration tests: extend the existing HTTP route tests listed in
  Scope; no new test harness is needed.
- CLI tests: not applicable; the project ships no CLI command.
- Playwright tests: not applicable; this change verifies the API/validator seam
  directly and introduces no browser interaction.

## Risks And Tradeoffs

- These tests intentionally verify only APIs with existing standalone browser
  validators. Adding a validator solely to cover Headcount is outside scope.
- Importing browser ES modules from Node tests follows the established project
  pattern and does not add a build dependency.

## Spec Completeness Checklist

- [x] Scope and acceptance criteria are defined.
- [x] Existing code and test patterns are identified.
- [x] Automated testing strategy is defined.
- [x] Dependencies are unchanged and justified.
- [x] Security impact is not applicable: no input, authorization, storage, or
  external-resource behaviour changes.
- [x] Performance impact is negligible: only test assertions are added.
- [x] Rollout and migration are not applicable: no production behaviour or
  persistent data changes.

---

## Change Log

### Update from `code-review-ai-maintainability-review.md`

**Applied:**

- Reduced scope to the API-to-browser contract tests identified as immediately
  valuable and implementation-ready.
- Added concrete response variants, test locations, acceptance criteria, and a
  completeness checklist.

**Rejected:**

- Migration registry: the documented case-by-case schema-evolution strategy is
  intentional; a registry needs separate evidence and a safe bootstrap and
  recovery design.
- Inline controller extraction: retain as future editing guidance only; it is
  not a current defect or independently justified change.

**Reorganized:**

- Replaced the general code-review findings with one bounded test-improvement
  specification.
