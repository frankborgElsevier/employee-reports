# Spec 010: Consolidated Critique (v2)

## Overview

**Critiques received from:** main-agent review.

**Critiques missing:** Codex CLI remains unavailable in this non-git,
read-only-sandbox context; Claude haiku remains unavailable because its CLI is
not logged in. Their status has not changed since v1, so neither was retried.

## Executive Summary

The v1 recommendations were applied successfully. One implementation-blocking
identity collision remains: the proposed contractor WorkDay worker ID is only
unique among contractors, not against existing imported employee IDs. Without
an explicit cross-worker-type validation rule, a contractor can consume a
workbook row while an existing imported employee with that same source ID
remains active.

## Consolidated Requirements Feedback

### Cross-worker-type WorkDay identity collision

**Issue:** The application persists imported employees under workbook
`Employee ID`; the draft permits a contractor's `workdayWorkerId` to take that
same value as long as another contractor does not own it. A subsequent import
can then show both records as active people for one source identity.

**Agreement:** This violates the spec's no-duplicate, no-silent-conversion
safety model.

**Recommendation:** Reject a non-empty contractor WorkDay worker ID that
matches any stored imported employee ID, active or inactive. Apply this
validation in the database mutation for contractor creation and update, not
only in the browser, and return one fixed safe validation error through both
routes.

### Previous findings

**Status:** Resolved in the v1 update.

- Consumed contractor rows now use the existing unresolved-supervisor fallback
  and never become managers.
- Contractor identity and manager updates are required-field and atomic.
- Contractor status is recomputed only by a successful confirmed import.
- The ASCII design permits a responsive stacked implementation.
- Spec 009 Feature 3 is correctly recorded as a pre-implementation workflow
  gate.

## Additional Requirements Identified

1. Add cross-worker-type WorkDay worker-ID collision validation.

## Ambiguities Requiring Clarification

None. Rejecting the collision preserves the explicit product decisions; it
does not require a new user choice.

## Summary of Required Changes

1. Reject a contractor WorkDay worker ID that is already an imported employee
   ID, whether that employee is active or inactive.
2. Test the validation through both contractor creation and contractor update,
   including a future workbook import that would otherwise duplicate the
   identity.
