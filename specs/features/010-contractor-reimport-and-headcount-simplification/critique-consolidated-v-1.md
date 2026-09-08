# Spec 010: Consolidated Critique (v1)

## Overview

**Critiques received from:** main-agent review.

**Critiques missing:** Codex CLI — it could not initialize its state database
in the read-only sandbox and refused to run outside a trusted repository;
Claude haiku — the installed CLI is not logged in.

## Executive Summary

The draft has a sound safety model: contractors persist, identity matching is
exact and user-supplied, previews remain rollback-only, and matching never
silently changes a contractor into an employee. The main requirements are
implementable on the existing SQLite/Express/vanilla-JS architecture.

Before implementation, resolve two material gaps: define what happens when an
imported employee reports to a workbook row consumed as a contractor, and make
the contractor update payload/transaction semantics explicit. The requested
removal also conflicts with unimplemented Spec 009 Feature 3 and needs that
feature's lifecycle formally updated before implementation.

## Consolidated Requirements Feedback

### Consumed contractor rows in the imported hierarchy

**Issue:** The spec says a matched workbook row is consumed and excluded from
supervisor processing, but does not define how existing employee rows that name
that WorkDay ID as their `Direct Supervisor ID` reconcile. The application must
not assign them to the contractor because contractors cannot be line managers.

**Agreement:** The current contractor-manager invariant must remain true.

**Recommendation:** Add a requirement: a consumed contractor row never becomes
an imported employee manager. Employee references to that WorkDay ID follow the
existing unresolved-supervisor/external-manager fallback, using the workbook
supervisor name where it is supplied. This preserves the import and the
org-chart relationship without creating a contractor manager.

### Contractor update contract

**Issue:** The draft permits clearing the WorkDay worker ID and changing a line
manager but does not say whether each field is required in a request or whether
the two changes are atomic.

**Agreement:** The server should remain the authority for the ID and manager
invariants, and no partial update should survive a validation failure.

**Recommendation:** Define one required whole-row update payload: a string
`workdayWorkerId` (empty means clear) and `manager` (`null` or the existing
typed manager descriptor). Validate both then write both in one transaction.

### Latest-confirmed-import status

**Issue:** The draft strongly implies a complete reset/recompute of status but
does not name that as a durable invariant.

**Agreement:** Preview and unsuccessful confirmation must never change the
visible status.

**Recommendation:** State that each successful confirmation atomically
recomputes status for every active contractor; new contractors are initially
Needs review and do not alter the summary of a past import.

### Spec 009 conflict

**Issue:** Spec 009's unimplemented Feature 3 requires a saved-team table in
the exact Headcount area this spec removes.

**Agreement:** The two requirements cannot both ship as written.

**Recommendation:** Use `/spec-update` or `/spec-close` on Spec 009 before
implementation to remove, defer, or supersede its Feature 3. Treat Spec 010 as
the present source of truth: no Team breakdown appears on Headcount; saved-team
presentation requires a future, explicit product decision.

### Responsive contractor layout

**Issue:** The ASCII design reads like a table although the application is a
narrow, single-column page.

**Recommendation:** Add an accessibility/layout note allowing each contractor
to stack its labelled fields and retain its own Save action. The ASCII screen
remains a content guide, not a required table implementation.

## Additional Requirements Identified

1. Define consumed-contractor supervisor handling using the existing external
   manager fallback.
2. Define an atomic, required-field contractor update request.
3. Make whole-roster status recomputation a stated confirmed-import invariant.
4. Resolve or defer the conflicting Spec 009 Feature 3 before implementation.

## Ambiguities Requiring Clarification

None require a new product choice. The recommendations above preserve the
draft's stated safety and ownership decisions.

## Summary of Required Changes

1. Add the supervisor rule for rows that reference a matched contractor.
2. Specify atomic contractor ID/manager update semantics.
3. State the status-reset invariant explicitly.
4. Update or close the conflicting Headcount portion of Spec 009.
5. Add a responsive-layout note to the Contractor ASCII design.
