# Implementation Review: 001-data-foundation

**Status:** Approved
**Date:** 2026-08-31
**Reviewed HEAD:** unavailable — repository is not under git version control
**Review baseline:** unavailable — implementation summary records no baseline commit (repo had no `.git` at implementation time)
**Scope confidence:** High — greenfield implementation; every reviewed file is new and attributable entirely to this spec.

This is a re-review after a targeted fix pass. The prior report (2026-08-31,
Changes Requested) found one blocking issue and five non-blocking
suggestions/nits; the user scoped the fix pass to the blocking issue only.

## Reviewed Scope

- `src/db/connection.ts` - re-reviewed in full; this is where the blocking finding and its fix live
- `test/db/lifecycle.test.ts` - re-reviewed the new regression test added for the fix
- `src/db/queries.ts`, `src/db/mutations.ts`, `src/db/types.ts` - spot-checked to confirm they were untouched by this fix pass, so the five prior non-blocking findings are still accurately described
- All other files from the original review (`schema.ts`, `validation.ts`, `errors.ts`, `index.ts`, remaining `test/db/*.test.ts`) - not re-reviewed in detail; nothing in the fix pass touched them and the original review already covered them

## Evidence

- Spec: `specs/features/001-data-foundation/spec.md`
- Implementation summary: `specs/features/001-data-foundation/implementation-summary.md` (updated with a "Post-Review Fix" section)
- Prior review: `specs/features/001-data-foundation/implementation-review.md` (this file, previous version — Changes Requested)
- Validation: re-ran `npm test` (47/47 pass, up from 46 — one new regression test) and `npm run typecheck` (clean) independently; read `connection.ts` and the new test directly rather than trusting the summary's description alone.

## Requirement Coverage

Unchanged from the prior review for every requirement except AR-4.3 and the AR-2.2 note below; see the prior report's full table for the other 24 rows (all "Covered"). Restating only what changed:

| Requirement | Review evidence | Result |
| --- | --- | --- |
| AR-4.3 | `connection.ts`: `initDatabase`'s connection-opening/schema-init section is now wrapped in `try/catch`, calling a shared `restorePreviousUmask()` on any failure before rethrowing; `closeDatabase` calls the same helper. `lifecycle.test.ts: "AR-4.3: a failed initDatabase restores the process umask instead of leaking it"` forces the failure (via a path that's a directory, not a file) and asserts `process.umask()` is unchanged afterward, and that a subsequent real `initDatabase` call still succeeds. | **Covered — blocking finding resolved** |
| AR-2.2 | `validation.ts:currentCalendarYear` (UTC); still not reused by `queries.ts:getCurrentSalary`, which still computes `new Date().getUTCFullYear()` inline (confirmed unchanged by this fix pass) | Covered (behavior correct); duplication finding still open, see Findings |

## Findings

| Severity | Evidence | Finding | Required action |
| --- | --- | --- | --- |
| suggestion | `src/db/queries.ts:138` vs `src/db/validation.ts:21-23` | *(Carried over, unresolved — out of this fix pass's scope.)* `getCurrentSalary` still computes the current year inline instead of calling the shared `currentCalendarYear()` helper. Behavior is correct; this is a maintainability/DRY concern, not a defect. | Replace the inline calculation with a call to `currentCalendarYear()`. |
| suggestion | `src/db/mutations.ts:59-70` | *(Carried over, unresolved.)* `wouldCreateCycle` still has no visited-set/depth bound; safe under normal use (this function is the only writer of `manager_id` and always runs this check first) but no defense-in-depth against corrupted data. | Add a `visited` set or depth cap as insurance; optional. |
| nit | `src/db/queries.ts:161-163` | *(Carried over, unresolved.)* `getLastRatings` still throws a built-in `RangeError` while the rest of the module uses the custom `ValidationError`. Not a spec violation. | Consider `ValidationError` for consistency, or leave as an intentional distinction. |
| nit | `src/db/types.ts:34-36`, `src/db/queries.ts:2` | *(Carried over, unresolved.)* `QueryOptions` is still exported and imported but unused — each function still redeclares its own identical inline options type. | Use `QueryOptions` in all three functions, or remove it. |
| nit | `test/db/*.test.ts` | *(Carried over, unresolved.)* Still no explicit leap-year test for `isValidIsoDate` (code is correct on manual trace). | Add a leap-year test case for completeness. |
| suggestion | `specs/PROJECT_GUIDELINES.md:8-13`, `specs/ARCHITECTURE.md:12-19` | *(Carried over, unresolved.)* Both still say tooling/tech-stack is `TBD`, which is stale now that `package.json`, `tsconfig.json`, and `src/db/` exist. | Update both docs' tables with the now-real tooling/stack/structure. Not blocking. |

## Verdict

**Approved.** The blocking finding from the prior review — the process-umask leak on `initDatabase`'s failure path — is resolved: the fix is correctly scoped (wraps exactly the risky section), the shared restore helper is used consistently by both the new catch block and `closeDatabase`, and the new regression test genuinely exercises the failure path (verified independently: 47/47 tests pass, typecheck clean) rather than just asserting around it. No blocking findings or unresolved clarification remain. The five carried-over suggestions/nits are all non-blocking per the severity table and were explicitly left open by the user's choice to scope the fix pass to blocking issues only — they don't need to hold up closure, but they're worth picking up opportunistically (the stale `ARCHITECTURE.md`/`PROJECT_GUIDELINES.md` entries especially, since they've now been outstanding since before implementation even started).

Next: `/spec-close 001-data-foundation`.
