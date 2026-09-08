# Critique Consolidated v1 — Spec 011

## Review outcome

**Revise before implementation.** The draft correctly separated manager
placement from WorkDay-link health and correctly rejected an automatic match.
Its initial preview-only solution, however, did not fully meet the reported
use case: after a fresh import, candidate worker IDs commonly already exist as
imported employee records.

## Critical finding: preview-time selection still hits the identity guard

Spec 010 intentionally rejects assigning a contractor a WorkDay ID held by an
imported employee, including an inactive one. This is enforced by
`assertAvailableContractorWorkdayWorkerId` in `src/db/mutations.ts` and is
covered by `test/db/contractors.test.ts`. An unlinked contractor's first fresh
import creates exactly that imported employee row. On the next preview, simply
selecting the same candidate would still be rejected before reconciliation can
consume it.

Therefore, a spec that offers a picker but retains the blanket collision rule
would be misleading: it could recommend the right record but could not save
it for the user's current data.

## Recommended resolution

Add an explicit, confirm-time **identity claim** within the existing preview
and confirmation workflow:

1. The user explicitly selects a candidate; no candidate is automatic.
2. In the same transaction as confirmation, the system marks any existing
   imported record with that worker ID as superseded by the selected
   contractor, rather than deleting historical salary, rating, or manager-key
   records.
3. The contractor takes the WorkDay link and consumes the current workbook
   row. The superseded imported record is excluded from Headcount and normal
   employee lookup/projection, cannot be reactivated by later imports while
   the contractor owns the link, and is not treated as a valid employee
   supervisor.
4. Future imports continue to consume the row as the contractor. Clearing the
   link must not silently reactivate the archived record; recovery needs an
   explicit future workflow.

This is a narrow, auditable alternative to destructive deletion or silently
allowing two active identities. It changes Spec 010's collision invariant only
for a user-confirmed candidate in the atomic import transaction; all ordinary
manual-ID edits remain rejected on collision.

## Required draft changes

- Replace the "existing duplicates are out of scope" decision with the
  explicit identity-claim policy above.
- Define the hidden/superseded imported-record state, data migration, and its
  effects on Headcount, employee details, manager resolution, and future
  imports.
- Require a confirmation warning before a pre-existing imported record is
  superseded and retain existing data rather than deleting it.
- Add acceptance and rollback scenarios for claiming active and inactive
  imported identities, supervisor fallback, and later imports.

## Retained strengths

- Blank optional IDs no longer become attention items.
- Stale non-blank links remain the only review-count condition.
- Candidate suggestions are bounded, explainable, and not a search endpoint.
- Preview and confirmation stay server-authoritative and atomic.

## Decision applied

The recommended identity-claim resolution has been incorporated into the
revised spec. No implementation was performed.
