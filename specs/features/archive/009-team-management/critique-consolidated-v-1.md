# Spec 009: Consolidated Critique (v1)

## Overview

**Critiques received from:** Main agent.

**Critiques missing:** Claude (`haiku`) could not run because this environment
is not logged in. Codex CLI (`gpt-5.4`) could not initialize its state database
inside the restricted environment and then rejected the directory as untrusted.

## Executive Summary

The draft is implementation-ready in its main product flow: it defines the
radio-driven page, the live versus explicit membership model, the Headcount
replacement, and preservation of existing org-chart behavior. Before
implementation, tighten four boundary contracts so referential integrity,
empty states, and client/server data shapes cannot be guessed by the
implementer.

## Consolidated Requirements Feedback

### Referential integrity when an employee is deleted

**Issue:** The proposed new foreign keys affect `deleteEmployee()` but the
draft does not decide whether deletion is refused, cascades, or mutates teams.

**Agreement:** The current data layer already favors safe rejection for an
employee with reporting dependents, and ordinary WorkDay removals are soft
inactivations rather than deletion.

**Recommendation:** Require `ON DELETE RESTRICT` for saved-team manager and
custom-member references and an actionable conflict from `deleteEmployee()`.
Test that a failed deletion leaves both team definitions and memberships
unchanged.

### Exact saved-team read contract

**Issue:** `GET /api/teams` has described fields but no exact response schema.

**Agreement:** The Headcount page needs manager display information and a
stable, independently validatable summary; it does not need a full member
roster.

**Recommendation:** Define the response exactly as
`{ teams: [{ id, name, type, manager: { id, name } | null, headcount }] }`.
Require non-null manager only for `line_manager`; `custom` has null manager.

### Successful empty creation-options response

**Issue:** The draft handles failed options loading but not a valid response
with no eligible managers or no eligible engineers.

**Agreement:** A disabled mode needs explanatory text, while the other mode
can still be usable when it has options.

**Recommendation:** Define an empty-options message and mode-level disabled
state. Explain that a manager option requires an active imported employee with
an active direct report, while a custom member requires an active imported
engineer.

### Enforcing normalized name uniqueness

**Issue:** Case-insensitive, trimmed uniqueness cannot rely only on a page
check or an unspecified SQLite uniqueness constraint.

**Agreement:** The database must be the concurrency-safe authority, and its
conflict should map to a fixed client-safe response.

**Recommendation:** Require trimmed write values and a case-insensitive unique
database constraint/index (using the project's selected SQLite collation),
then test a case-only duplicate through the HTTP route.

## Additional Requirements Identified

1. Pin the employee-deletion behaviour for all new team foreign keys.
2. Pin `GET /api/teams`' JSON response fields and nullable-manager rule.
3. Specify successful empty manager/engineer option states per radio mode.
4. Specify storage-level enforcement of normalized team-name uniqueness.

## Ambiguities Requiring Clarification

None from the stated product workflow. The draft's full-subtree, manager-
excluded, contractor-in-manager-team, and imported-engineer-only custom-team
decisions are deliberate documented assumptions rather than open questions.

## Summary of Required Changes

1. Update the draft with the four recommendations above using
   `/spec-update specs/features/009-team-management/spec.md
   specs/features/009-team-management/critique-consolidated-v-1.md`.
2. Review the revised spec with `/spec-review` before implementation.
