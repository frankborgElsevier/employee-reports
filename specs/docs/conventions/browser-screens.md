# Browser Screens Convention

How client-side code is written and structured in `public/`. Established by
`public/index.html` (spec
[002-workday-import](../../features/002-workday-import/spec.md)), extended by
`public/headcount.html` and `public/chart-logic.js` (spec
[003-headcount-dashboard](../../features/003-headcount-dashboard/spec.md)),
and further extended by `public/employee-details.html` and
`public/employeeDetailsLogic.js` (spec
[004-employee-details](../../features/004-employee-details/spec.md)).

## No Framework, No Build Step

Screens are plain HTML plus vanilla JavaScript, served directly by
`express.static(PUBLIC_DIR)`. There is no bundler, no transpiler, and no UI
framework. The file the browser loads is the file in the repository.

This is why client-side logic is written as plain ES-module **JavaScript**
rather than TypeScript: TypeScript in `public/` would require a build step. The
`src/` tree stays TypeScript; `public/` does not. (`tsconfig.json` includes only
`src/**/*.ts`, so `public/` is outside typechecking entirely.)

## Split Logic from DOM Wiring

Anything worth testing lives in a plain importable module that takes data and
returns data, with no DOM access — `public/chart-logic.js` is the reference
example. The page keeps only the thin wiring: creating elements, attaching
listeners, reading the current control state.

This project has no browser test harness, so this split is the only thing that
gives client-side rules automated coverage. The tests import the same file the
browser loads:

```ts
import { buildTree, visibleIds } from "../../public/chart-logic.js";
```

Tests for these modules live under `test/dashboard/` (or, for
`employeeDetailsLogic.js`, `test/employeeDetails/`) and follow the same
`node:test` conventions as the rest of the suite — see
[data-access-layer.md](data-access-layer.md#testing), including test names that
cite the requirement they verify.

The same no-browser-harness limit applies to payload-shape validation, not
only to filtering/sorting: `employeeDetailsLogic.js`'s `isValidPayload`
function is the automatable half of the Employee Details screen's
malformed-response check (spec 004 FR-4.4) — the check itself is unit-tested,
while the resulting "page displays the failure message" rendering is
verified manually, the same as any other client-rendering state this
project accepts as manual (the empty-database and no-rows-match states on
both existing table/chart screens).

When a browser module validates a successful API response, the relevant HTTP
route test also passes a real successful body through that same validator.
This catches a server projection and its browser consumer drifting apart while
keeping the browser's defensive validation in place. See
[API-to-Browser Contract Tests](../../code-review-ai-maintainability.md).

When a selector needs an opaque server reference, its option label must remain
human-readable. The Contractors screen keeps the selected manager reference
only as the form value; duplicate names are disambiguated with ordinary person
context and an indistinguishable option is disabled rather than exposing an ID.

## All DOM Text Goes Through `textContent`

Employee names, positions, and countries originate in an uploaded spreadsheet
and are untrusted input, even in a single-user local app. They reach the DOM
through `textContent` or an equivalent escaping path — never through
`innerHTML`/`insertAdjacentHTML` string concatenation. Attribute values are set
with `setAttribute` (or direct property assignment) using text values, never
built by template-string interpolation.

A practical consequence: `showResult(text)` in `public/index.html` assigns
`textContent`, so a message that needs a link appends an `<a>` element as a DOM
node rather than passing markup through it. Switching that function to
`innerHTML` to save a few lines would undo the guarantee for every caller.

### Checkbox `id`/`for` Pairs Need a Generated Identifier, Not the Raw Text

A checkbox built from an arbitrary, untrusted string (e.g. one distinct
value per position on the Employee Details screen) uses a generated,
screen-local identifier — an index-based prefix such as
`position-checkbox-${index}` — for its `id`/`for` attribute pair, never the
raw string itself. Unlike an employee id (which happens to be numeric in
every export seen so far, though spec 001 leaves its format formally
undefined), arbitrary text can contain spaces or other characters unsuited
to a bare DOM identifier. The raw string still reaches the DOM safely as
the checkbox's `value` and its label's `textContent` — only the identifier
half needs generating, not the visible/functional half.

## Navigation

Every screen carries the same nav element listing all screens, with the current
page's link marked `aria-current="page"`. The Import link is `/index.html`.
The root URL (`/`) is a server-side, data-aware landing route: it redirects to
Headcount when active people exist and to Import when the roster is empty.

The markup is duplicated per page rather than shared through a template or JS
module. With four static pages this remains the cheaper
choice; revisit if a further screen makes the duplication a real maintenance
cost.

## Rendering Trees

Tree assembly and rendering are iterative, using an explicit stack rather than
recursion, so an unexpectedly deep hierarchy renders instead of overflowing the
call stack.
