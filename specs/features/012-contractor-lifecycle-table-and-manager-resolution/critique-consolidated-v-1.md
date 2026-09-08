# Spec 012: Consolidated Critique (v1)

## Overview

**Critiques received from:** Main-agent critique.

**Critiques missing:** Codex CLI could not run because this workspace is not a
trusted Git directory and its read-only sandbox could not initialize state.
Claude CLI could not run because it is not logged in.

## Executive Summary

The draft clearly separates contractor-owned WorkDay identity from manager
placement, adds the requested table actions, and makes the application—not the
user—the owner of a manager employee ID. The primary product decision to
confirm before implementation is that Delete is permanent. The wording about
same team names is also resolved safely without inventing a non-existent team
model: same displayed manager names are disambiguated with human context and,
only if needed, a read-only ID.

## Consolidated Requirements Feedback

### Manager disambiguation

**Issue:** The request says to ask for an ID where managers have the same team
name, but the current data model has no durable team-name field.

**Agreement:** A UI must never guess a manager from an ambiguous human label,
and the user must never need to type an employee ID.

**Divergence:** None.

**Recommendation:** Retain Product Decisions and FR-1.4: use manager-name
collisions as the detectable condition, add already available human context,
and append an application-held read-only ID only when the choices still cannot
be distinguished.

### Contractor deletion

**Issue:** A permanent delete ends the current "live forever" behaviour but
does not support recovery.

**Agreement:** The action needs an explicit confirmation, narrow server target,
and must never revive a superseded imported identity.

**Divergence:** A product owner may prefer archive/recovery semantics, which
would be materially different scope.

**Recommendation:** Confirm permanent deletion is intended before
implementation. If recovery is required, write a follow-up archival spec rather
than weakening this delete contract.

### Delivery order and table usability

**Issue:** The desired truthful link states and guided WorkDay-link action are
defined by still-draft Spec 011; a wide actions column also needs responsive
implementation care.

**Agreement:** This spec must not reimplement Spec 011's import safeguards, and
the table needs accessible action labels on narrow screens.

**Divergence:** None.

**Recommendation:** Implement Spec 011 first or keep the manual WorkDay-ID
path until it is available. Allow actions to wrap or use an accessible per-row
menu without changing the semantic table contract.

## Additional Requirements Identified

No required new FRs or ARs. The implementation should treat responsive action
layout as part of normal accessible table styling.

## Ambiguities Requiring Clarification

1. Is permanent local deletion acceptable, or should contractors be archived
   and recoverable instead?
2. Does "same team name" mean two managers with the same person name? The
   spec adopts that interpretation because no team field exists today.

## Summary of Required Changes

1. No spec change is required to proceed under the stated product decisions.
2. Resolve the permanence decision before implementation if it is not already
   intended.
3. Sequence the Spec 011 dependency, or consciously retain the temporary
   manual WorkDay-ID path.
