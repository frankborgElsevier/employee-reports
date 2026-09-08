# Implementation Review: 002-workday-import

**Status:** Approved
**Date:** 2026-08-31
**Reviewed HEAD:** unavailable (not a git repository)
**Review baseline:** unavailable (implementation summary records none — not a git repository)
**Scope confidence:** High — this round's scope is fix round 2's files, named in the updated `implementation-summary.md` and matching what's on disk.

## Reviewed Scope

- `src/server/previewStore.ts` — the ticket-based compare-and-swap
  (`tryReserve`/`finalizeReservation`/`releaseReservation`) and the new
  `"computing"`-state timeout, re-read in full to verify Finding 4 is
  actually closed and to hunt for anything the ticket mechanism itself
  might have introduced
- `src/server/app.ts` — confirmed the ticket is threaded correctly through
  every call site, and checked the new `408` response against the spec's
  documented status contract
- `test/server/app.test.ts` — the new reservation-timeout test, to confirm
  it exercises a faithful simulation of a stuck request rather than an
  artificial setup that wouldn't occur in reality
- `specs/features/002-workday-import/spec.md`'s FR-4.3 (HTTP status
  contract) and Constraints, re-read to check the new `408` code and the
  2-minute timeout value against what the spec actually commits to

## Evidence

- Spec: `specs/features/002-workday-import/spec.md`
- Implementation summary: `specs/features/002-workday-import/implementation-summary.md`
- Prior reviews: this file's two previous versions (Findings 1–3 + nit,
  then Finding 4) — both now resolved, not repeated below except where a
  new, distinct issue surfaced while verifying the fix
- Validation: re-ran `npm test` (100/100, matching the summary); traced
  `reapIfExpired`/`tryReserve`/`finalizeReservation`/`releaseReservation`'s
  state transitions by hand rather than re-deriving the whole design from
  scratch, since the mechanism itself (not just the test result) is what
  needed checking

## Requirement Coverage

Unchanged from the first review round for everything outside the
`previewStore.ts`/`app.ts` fix chain (FR-1.x–FR-3.x, AR-1.1–AR-4.6, FR-5.1,
AR-5.1–AR-5.3) — see that round's coverage table; nothing in either fix
round touched that code.

| Requirement | Review evidence | Result |
| --- | --- | --- |
| FR-5.2 (atomic concurrent-preview guard) | `previewStore.ts:65-71` | Covered — confirmed atomic |
| FR-5.2 (no indefinite blocking on abandoned token) | `previewStore.ts:44-49` | Covered |
| FR-5.2 (no indefinite blocking on a stuck computation) | `previewStore.ts:24`, `50-52` | Covered — the regression this round exists to fix; traced by hand, not just trusted from the test |
| FR-5.2 (stale reservation can't clobber a newer one) | `previewStore.ts:80-81`, `92-95` | Covered |
| FR-4.4 (double-confirm) | `app.ts:111-138` | Covered (unchanged from round 1) |
| FR-4.3 (HTTP status contract) | `spec.md` lines 408-417 list exactly `200`/`400`/`403`/`409`/`413`; `app.ts:97` now also returns `408` | **Gap — see Finding 5.** Not a functional defect (the browser UI already handles any non-2xx status generically), but an undocumented addition to a contract the spec describes as closed to five specific codes. |

## Findings

| Severity | Evidence | Finding | Required action |
| --- | --- | --- | --- |
| suggestion | `app.ts:97` (`res.status(408)...`) vs. `spec.md` FR-4.3 ("`400` is reserved for... `403`... `409`... `413`" — five codes, no `408`) | The reservation-timeout-during-computation path (added this round to fix Finding 4) returns `408`, a status code not part of FR-4.3's documented contract. `implementation-summary.md`'s Deviations section disclosed the 2-minute timeout *value* as an undocumented judgment call, but didn't call out that a *new status code* was also added — this is the more notable of the two omissions, since it changes the API surface, not just a tuning constant. No functional impact: `public/index.html` treats any non-`2xx` response generically. | Either update `spec.md`'s FR-4.3 to document `408` for this case (a quick `/spec-update`), or simplify by reusing an already-documented code instead — `409` ("another import is already in progress") is a reasonable fit, since from the client's perspective a timed-out reservation and a contended slot look similar enough to report the same way. Either resolves it; not required before closing this spec, since the gap is documentation/contract-cleanliness, not a defect. |
| suggestion | `previewStore.ts:24` (the `"computing"` variant has no `filePath` field) | When a stuck `"computing"` reservation is reaped by timeout (`reapIfExpired`, line 50-52), there's no way to know whether multer had already written a temp file for that request, so a genuinely orphaned upload (one that got past multer but then hung during `preflightZip`/`parseWorkbook`/`reconcile`) isn't deleted until the next server restart's startup sweep (`start.ts`'s `AR-4.2` backstop) — not immediately when the reap happens. Bounded impact (each orphan is capped by `AR-4.5`'s per-file size limit, and this requires the already-rare >2-minute-hang precondition on top of getting past multer first), so this isn't a resource-exhaustion risk in practice, just a delay in cleanup. | Track `filePath` on the `"computing"` variant too (set once multer's callback fires, before the try block) so a timeout-triggered reap can delete the orphaned file immediately, matching how the `"ready"` state's expiry already does. Nice-to-have, not required before closing this spec. |

## Verdict

Approved. Both remaining findings are suggestions, not defects: neither
changes runtime behavior a user would notice, neither contradicts a
requirement in a way that leaves the feature incorrect, and both have
cheap, well-understood fixes that can land in a follow-up pass without
holding up this spec. The three rounds of review on this implementation
progressively found and closed a real concurrency defect (Finding 1), a
regression that defect's own fix introduced (Finding 4), and a related
correctness edge case caught proactively before it needed its own review
round (the ticket-based compare-and-swap) — the core FR-5.2 guarantee this
whole chain was testing is now genuinely sound, verified by hand-tracing
the state machine's transitions rather than relying on test results alone.

Next: `/spec-close 002-workday-import`. Consider filing the two suggestions
above as follow-up work (a small `/spec-update` for the `408` contract
question, and a small code change for immediate orphan cleanup) rather than
blocking closure on them.
