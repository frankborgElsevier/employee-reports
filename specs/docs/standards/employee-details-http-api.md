# Employee Details HTTP API

The request/response contract for `GET /api/employee-details` in
`src/server/app.ts` (spec
[004-employee-details](../../features/004-employee-details/spec.md), extended
by spec
[006-employee-details-and-headcount-refinements](../../features/006-employee-details-and-headcount-refinements/spec.md)
with a ninth field), the data source for the
[Employee Details](../domains/employee-details/index.md) screen.

## `GET /api/employee-details`

No parameters, no request body, no state change.

| Status | Meaning | Body |
| --- | --- | --- |
| `200` | Every active employee and contractor | `{ employees: [{ id, name, position, workerType, managerId, currency, baseSalary, bonus, compRatio, ratings: { mostRecent, priorRating, twoYearPriorRating } }] }` |
| `500` | The data layer threw | `{ error: "Could not load employee data." }` |

Entries arrive in `id` order (lexicographic), inherited from
`getAllEmployees()`. `managerId` is `null` for an employee with no manager.
The browser sorts and filters for display — the payload order is not the
render order.

## Contract Details

- **Exactly ten fields per entry** (`workerType` added by spec 007; `compRatio`
  added by spec 006), `ratings` being a nested object with exactly its three
  named keys. The handler builds this projection from `getAllEmployees()`,
  `getCurrentSalary(id)`, and `getLastRatings(id, 3)` — one call each per
  active employee — rather than passing the `Employee` object through, which
  would also serialise `country` and `endDate`.
- **`currency`/`baseSalary`/`bonus` are `null` together**, never a mix of
  `null` and a present value, when `getCurrentSalary` returns `null` for
  that employee — guaranteed by the `salary_history` schema, where
  `currency`/`base_salary` are `NOT NULL` and `bonus` defaults to `0` (see
  [Data Schema & API Contract](data-schema.md)).
- **`compRatio` is independently nullable** (spec 006), unlike the
  currency/baseSalary/bonus trio above: it comes from `salary_history`'s
  nullable `comp_ratio` column (see [Data Schema & API Contract](data-schema.md)),
  sourced from the WorkDay export's optional `Base Pay Compa Ratio` column.
  It can be `null` even when a salary row exists (the column was blank or
  absent on import), and is `null` whenever `getCurrentSalary` returns `null`
  entirely, the same as the other salary fields. Stored and returned exactly
  as imported, with no rounding — the source cell displays it as a
  percentage (e.g. `114.16%`) while this payload/screen carries the
  underlying decimal (`1.141603`).
- **Each `ratings` key is independently nullable.** `getLastRatings` omits
  any period with no row rather than padding it, so the handler maps each
  returned `ratingPeriod` string to its camelCase key (`"Most Recent"` →
  `mostRecent`, etc.) and leaves any key with no corresponding row as
  `null` — see `mapRatings`/`RATING_PERIOD_TO_KEY` in `src/server/app.ts`.
- **Active employees and contractors.** Built on `getAllEmployees({ workerType:
  'all' })`. A contractor has null salary/rating fields and does not trigger
  salary or rating-history reads.
- **An empty database returns `{ employees: [] }`, not an error.**
- **No `Origin` check, no CORS headers** — same reasoning as
  [`GET /api/headcount`](headcount-http-api.md): a read-only `GET` carries no
  CSRF risk, and the browser's default same-origin policy already stops a
  cross-origin read.
- **`Cache-Control: no-store` on every response, `200` or `500`.** Unlike
  `/api/headcount`, this endpoint carries compensation and rating data, so a
  browser or intermediate proxy must never retain a copy of a past response.
  The header is set once, before the handler's `try`, so both branches carry
  it without duplicating the call.
- **The `500` message is fixed and generic.** The real error is logged
  server-side, matching `/api/headcount`'s identical reasoning.

## Accepted Risk

This screen exposes compensation and rating data — a step beyond
`/api/headcount`'s roster-only exposure — without authentication to any
local process able to reach `127.0.0.1:<port>` while the server runs,
including other local users or processes on a shared machine, not only other
browser tabs. Inherited from the local, single-user model established by
spec 002/003, not an oversight. `Cache-Control: no-store` narrows how long a
past response can outlive the request that produced it; it does not change
who can request the data live.

## Testing the Failure Path

The `500` branch needs no dependency-injection seam, using the same
technique as `headcount-http-api.md`: `closeDatabase()` is safe to call at
any time and `getConnection()` throws once no connection is open
(`src/db/connection.ts`), so a test closes the database inside
`withTestServer` and issues the request — see
`test/server/employeeDetails.test.ts`.

A second failure mode has no server-side equivalent: a syntactically valid
`200` body missing `ratings` or a `ratings` sub-key. The client treats this
identically to a network/parse error. The check itself
(`isValidPayload` in `public/employeeDetailsLogic.js`) is unit-tested; the
resulting page-rendering behaviour is verified manually, since this project
has no browser test harness (see
[conventions/browser-screens.md](../conventions/browser-screens.md)).
