# Headcount HTTP API

The request/response contract for `GET /api/headcount` in `src/server/app.ts`
(spec [003-headcount-dashboard](../../features/003-headcount-dashboard/spec.md),
extended by spec [005-headcount-manager-context](../../features/005-headcount-manager-context/spec.md)
to include external-manager placeholder entries),
the data source for the [Headcount Dashboard](../domains/headcount-dashboard/index.md).

## `GET /api/headcount`

No parameters, no request body, no state change.

| Status | Meaning | Body |
| --- | --- | --- |
| `200` | Every active employee and contractor, plus any referenced external-manager placeholders | `{ employees: [{ id, name, position, country, managerId, isExternal, isContractor }] }` |
| `500` | The data layer threw | `{ error: "Could not load employee data." }` |

Real employee entries (`isExternal: false`) arrive first, in `id` order
(lexicographic), inherited from `getAllEmployees()`. External-manager entries
(`isExternal: true`) are appended after all real employees, sorted by their
own `id` ascending — see External Manager Entries below. `managerId` is `null`
for an employee with no manager at all; the browser sorts by name for
display — the payload order is not the render order.

## Contract Details

- **Seven fields per entry** (`isContractor` added by spec 007). The
  handler projects them explicitly rather than passing the `Employee` object
  through, which would also serialise `endDate`. No salary, bonus, currency,
  or rating field appears: this screen has no use for compensation data, so
  it is not shipped to the browser.
- **Active employees and contractors.** Built on `getAllEmployees({ workerType:
  'all' })`; an inactive row of either type is absent.
- **An empty database returns `{ employees: [] }`, not an error.**
- **No `Origin` check.** Unlike `/api/preview` and `/api/confirm` (see
  [import-http-api.md](import-http-api.md)), this route changes no state and
  therefore carries no CSRF risk. It is not given a guard it does not need.
- **No CORS headers.** Without `Access-Control-Allow-Origin`, the browser's
  default policy already prevents another page the user has open from reading
  the roster off this port. Do not add `cors()`.
- **The `500` message is fixed and generic.** The real error is logged
  server-side. This differs deliberately from the import routes, whose messages
  are user-actionable validation feedback — a failure here tells the user
  nothing they can act on, and echoing the error would risk putting internal
  detail such as filesystem paths into a browser-readable response.

## External Manager Entries (spec 005)

An employee's `Direct Supervisor ID` sometimes names someone outside the
imported file (see [WorkDay Import](../domains/workday-import/index.md)). When
the raw file also carried that supervisor's name, the import captures it into
`external_managers` (see [data-schema.md](data-schema.md)) and links the
employee's row to it via `employees.external_manager_id` — a column separate
from `manager_id`, since `manager_id`'s `ON DELETE RESTRICT` foreign key can
only ever reference a real employee row.

This handler unifies the two link columns into one `managerId` value per real
employee (`employee.managerId ?? employee.externalManagerId`), so the browser
still only ever has to reason about a single parent-link field. It then
appends one entry per `external_managers` row that is actually referenced by
at least one active person's `external_manager_id` — an id captured in one
import but no longer referenced (e.g. every employee who once pointed to it
has since left, or that person was later imported as a real row) is not
included, even though the underlying `external_managers` row is not deleted
(see data-schema.md's Known Constraints).

An external-manager entry always has `position: null`, `country: null`, and
`managerId: null` (nothing is known above them), and `isExternal: true`. As a
defensive guard, an external id that happens to coincide with a real active
employee's id is never emitted as a second entry — the real employee's row
wins.

## Accepted Risk

The roster — names, positions, countries, and the full reporting structure — is
served without authentication to any local process able to reach
`127.0.0.1:<port>` while the server runs. This is inherited from the local,
single-user model established by spec 002, not an oversight. It is also why the
endpoint still withholds compensation data despite being unauthenticated by
design.

## Testing the Failure Path

The `500` branch needs no dependency-injection seam: `closeDatabase()` is safe
to call at any time and `getConnection()` throws once no connection is open
(`src/db/connection.ts`), so a test closes the database inside `withTestServer`
and issues the request — see `test/server/headcount.test.ts`.
