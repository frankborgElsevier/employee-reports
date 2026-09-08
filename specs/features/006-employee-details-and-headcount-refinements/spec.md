# Spec 006: Employee Details & Headcount Refinements

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-08-31.
> Implementation summary: `specs/features/006-employee-details-and-headcount-refinements/implementation-summary.md`
> Implementation review: `specs/features/006-employee-details-and-headcount-refinements/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

Three targeted refinements to the two existing data screens. On Employee
Details (spec 004): narrowing the manager filter to one or more managers now
actually isolates their team — other root-level rows no longer leak through —
and every row gains a Comp Ratio column sourced from a WorkDay column
(`Base Pay Compa Ratio`) the import has never captured. On the Headcount
Dashboard (spec 003): the totals-by-position breakdown becomes a
position-by-region matrix, grouped into a fixed seniority-band order instead
of today's flat count-descending list.

## Goals

- Make the Employee Details manager filter behave like an isolation filter:
  selecting a manager (or managers) shows exactly their team, not every other
  root-level person in the roster.
- Surface each employee's Base Pay Compa Ratio on Employee Details, importing
  it from a WorkDay column that exists in the reference export but has never
  been read.
- Replace the Headcount Dashboard's flat, count-ordered position breakdown
  with a seniority-band-ordered, region-columned matrix that keeps its
  region-subtotals and grand total consistent with the existing headcount
  figure.

## Initiative Context

None — this repository has no Cyclops initiative workspace (`specs/cyclops/`
/ `.cyclops/` do not exist).

---

## Feature 1: Manager Filter Isolation on Employee Details

**Who & why:** A user narrows the Employee Details manager filter to look at
one team's compensation or ratings — e.g. checking only one manager and
unchecking the rest. Today that still shows every other manager's own row
and every individual contributor whose supervisor reference never resolved
(11 such people in the reference file: the 5 managers themselves, who are
roots because their own supervisor, `00000270149`, is absent from the file,
plus 6 non-manager individual contributors who report to that same absent
id) — because `visibleIds()` (`public/chart-logic.js`, reused unchanged from
spec 003 per spec 004 AR-2.1) treats every root as unconditionally visible,
regardless of manager checkbox state. The user wants narrowing the selection
to actually narrow what they see.

### Functional Requirements

#### FR-1.1: Root visibility becomes conditional once at least one root-level manager is deselected

Define a **root manager** as an entry in `managerList(employees)` whose
underlying employee is a root per `isRoot()` (spec 003 FR-1.4: `managerId` is
`null`, or doesn't resolve to another employee in the payload). On the
Employee Details screen only:

- **While every root manager is currently checked** (the page's default load
  state, and the state after re-checking all of them): visibility is exactly
  what it is today — every root (a root manager, or an individual contributor
  whose manager reference is null or unresolved) is visible regardless of any
  checkbox state, and a manager's own row stays visible while only their
  subtree responds to their own checkbox (spec 003 FR-2.4, reused via spec
  004 FR-2.3).
- **As soon as at least one root manager is unchecked:** visibility is seeded
  only from the currently-checked root managers — every other root, whether
  an unchecked root manager or an individual-contributor root with no
  checkbox of its own, is neither seeded nor traversed into, and is
  therefore not visible at all. A root manager who is unchecked is hidden
  entirely: both their own row and their whole subtree, not only the subtree
  (which is what an unchecked manager's own checkbox controls at any
  *non-root* depth, per FR-1.2 below — this FR changes root-level default
  visibility only).

Traversal beneath a visible, checked root proceeds exactly as it does today:
a checked root manager's descendants become visible per the existing
top-down pass, and any manager encountered along the way — root or not — is
subject to FR-1.2, unchanged.

**Verify:** With the reference file imported and only manager `00000622695`
checked (the other four root managers unchecked), the table shows exactly
that manager's own row plus their full descendant subtree — 9 rows total (1
own row + 8 direct reports; the reference tree is exactly two levels deep,
since all five managers are themselves roots) — and shows no row for the
other four managers or for any of the 6 individual contributors whose
supervisor is the absent `00000270149`. With all five managers checked (the
default), the table shows all 43 rows, identical to today's behavior.

The single most common interaction — unchecking exactly one manager and
leaving the other four checked — is the case a user hits first: with, e.g.,
`00000628358` (6 direct reports) unchecked and the other four checked, 30
rows remain visible (the four checked managers' own rows plus their 26
combined direct reports), and 13 rows are hidden (`00000628358`'s own row
and their 6 direct reports, plus the 6 unrelated individual contributors who
were never related to any checked manager).

Unchecking every manager checkbox leaves zero visible rows and triggers
FR-2.5's existing "No employees match the current filters." message (spec
004 FR-2.5) — a deliberate reuse of that generic message rather than a
dedicated one, since this screen (unlike spec 003's Headcount Dashboard,
which has a bespoke message for the analogous all-deselected state per spec
003 FR-2.7) had no equivalent wording of its own to begin with. This
supersedes spec 004 FR-2.5's claim that the manager filter alone can never
reach zero rows, which held only because every root was previously
unconditionally visible.

#### FR-1.2: Non-root visibility is unaffected by isolation mode

This screen's existing rule that a manager's own row stays visible while
only their subtree responds to their own checkbox (spec 003 FR-2.4, spec 004
FR-2.3) is unchanged for any manager reached via a visible root's traversal —
FR-1.1 changes only whether an unchecked *root* is reachable at all, not what
happens once traversal is already inside a visible subtree. Likewise, nested
deselection stays subtractive (spec 003 FR-2.5): unchecking a non-root
manager whose ancestor chain is otherwise checked hides only that manager's
own subtree, whether or not isolation mode (FR-1.1) is currently active.

**Verify:** In a fixture with two root managers, A and X: A has one direct
report, manager B, who has one direct report, individual contributor C (a
three-level chain, A→B→C); X separately has one direct report, individual
contributor Y (X has no other relation to A/B/C). The manager checkboxes are
therefore {A, B, X} — B is a manager but not a root; A and X are both root
managers.

With A and B checked and X also checked (today's default — every root
manager is checked, so isolation is *off* per FR-1.1): unchecking B alone
hides C but leaves B's own row visible, and X (and Y) stay visible
regardless — exactly spec 003 FR-2.4's existing rule.

Now additionally uncheck X (A stays checked, B stays unchecked): not every
root manager is checked, so isolation is *on*. Traversal seeds only from A
(the one checked root manager); X is skipped entirely and never traversed
into, hiding both X's own row and X's subtree (Y) — even though X itself was
never "reached" by anything. Within A's traversal, nothing changes from the
isolation-off case above: A is visible, A's child B is reached and stays
visible (a manager's own row is unaffected by their own checkbox once
reached), and B's own checkbox being unchecked still hides only C. Net
result: A and B visible; C, X, and Y all hidden. B's and C's states are
identical to the isolation-off case immediately above — confirming that
whether isolation is triggered elsewhere in the tree has no effect on
non-root visibility, which is this FR's claim.

### Architectural Requirements

#### AR-1.1: `visibleIds()` gains a backward-compatible option; `visibleRows()` gains a required parameter

`public/chart-logic.js`'s `visibleIds(employees, selectedManagerIds)`
(spec 003 FR-2.4/FR-2.5/AR-2.1) gains a third, optional parameter:
`visibleIds(employees, selectedManagerIds, options = {})`, reading a single
boolean flag, `options.requireRootSelection`, defaulting to `false` — today's
unconditional-root-visibility behavior. When `true`, the traversal is seeded
only with the root managers present in `selectedManagerIds`; every other
root — an unchecked root manager, or an individual-contributor root with no
checkbox at all — is neither seeded nor marked visible, and is therefore
never traversed into (this is FR-1.1's rule, stated as a traversal seed
rather than a per-node predicate, since the two phrasings coincide only
because of an incidental property of the current loop — stating it this way
removes that ambiguity). `public/headcount.html`'s call site
(`visibleIds(employees, selected)`) is not edited and keeps the `false`
default, so spec 003's FR-1.4/FR-2.7 root-always-visible invariant, and
every existing `test/dashboard/chartLogic.test.ts` case, is unaffected.

`public/employeeDetailsLogic.js`'s `visibleRows` gains a fourth, **required**
parameter: `visibleRows(employees, selectedPositions, selectedManagerIds,
rootManagerIds)`, where `rootManagerIds` is the `Set<string>` of every root
manager's id (an entry in `managerList(employees)` whose underlying employee
is a root per `isRoot()`). `visibleRows` computes `requireRootSelection` as
"not every id in `rootManagerIds` is present in `selectedManagerIds`" and
passes it to `visibleIds` per the paragraph above.

`employee-details.html`'s `start()` computes `rootManagerIds` exactly once
per page load — via a single `buildTree(employees)` call together with
`isRoot()` and the `managers` array `start()` already gets from
`managerList(employees)` — and passes that same set into every
`refresh()`-triggered call to `visibleRows`. This precompute is mandatory,
not illustrative: `visibleRows` recomputing the tree on every checkbox click
(one `buildTree` call directly, plus a second inside `managerList`, plus a
third inside `visibleIds`'s own call to `buildTree`) would be wasted,
avoidable work on every keystroke of interaction.

The five existing 3-argument `visibleRows(employees, positions, managerIds)`
calls in `test/employeeDetails/employeeDetailsLogic.test.ts` must be edited
to pass a `rootManagerIds` set as part of implementing this spec — a required
edit to existing tests, not an optional extension alongside them (see the
Testing Strategy checklist item below, which states this explicitly rather
than describing it as "extending" those tests).

#### AR-1.2: This is a deliberate, scoped revision of spec 005's stated boundary

Spec 005's Out of Scope explicitly stated that the Employee Details manager
filter "is unaffected" by that spec's headcount-only changes, and spec 005
AR-2.4 separately stated "no changes to `buildTree`/`isRoot`/`visibleIds`/
`managerList`". This spec revisits both deliberately: `visibleIds`'s
signature does change (AR-1.1), but strictly additively — a new optional
parameter defaulting to preserve every behavior those two spec 005
statements described. The isolation behavior itself applies only to
Employee Details' own filter; spec 005's actual subject (external manager
placeholders, team-size badges, manager-first card ordering) is untouched,
and the Headcount Dashboard gains none of this spec's isolation behavior.

---

## Feature 2: Base Pay Compa Ratio Column

**Who & why:** The WorkDay export (`workday_docs_examples/Team_Market_Range_Analysis_for_Managers–_RELX (1).xlsx`)
carries a `Base Pay Compa Ratio` column — each employee's base salary
expressed as a ratio against their market range midpoint (e.g. `1.141603`
for someone paid 114.16% of midpoint) — that today's import never reads.
Anyone reviewing compensation on Employee Details currently has to go find
this figure outside the app; this feature imports and displays it alongside
the salary fields the screen already shows.

### Functional Requirements

#### FR-2.1: `Base Pay Compa Ratio` is an optional import column

`src/import/parseWorkbook.ts` treats `Base Pay Compa Ratio` as optional,
detected the same way `Direct Supervisor Name` already is (spec 005 FR-2.1):
if the header is absent from the file entirely, `compRatio` is `null` for
every row and the import proceeds exactly as it does today. If the header is
present, each row's cell is read with the same `requireNumberCell` check
already used for `Worker Total Base Pay Amount`: a blank cell (the same
`isBlankCell` convention already used for optional/nullable fields) maps to
`compRatio: null`; a present, numeric cell maps to that number; a present,
non-numeric cell (a formula result, an error value, or text) **rejects the
import** with the same `RowValidationError` `requireNumberCell` already
raises for a malformed required numeric column. This mirrors, rather than
diverges from, the existing `Direct Supervisor Name` precedent: that
column's non-blank cells are also type-checked and rejected on a mismatch
(`requireNonBlankString`'s underlying `requireStringCell`) — "optional"
means the column may be absent, not that a present cell's value is exempt
from the type check every other column of its kind already gets. A file with
the header duplicated is rejected with the same "Column header(s) appear
more than once" error already generalized for `Direct Supervisor Name` (the
check now also covers this second optional header).

**Verify:** Importing the reference file maps employee `00000015867`'s row
to `compRatio: 1.141603` (the workbook's stored value; ExcelJS returns the
underlying decimal, not a percentage-formatted string, matching the
`numFmt: "#,##0.00%"` display format the source cell carries over its plain
numeric value). A file with the column removed entirely imports successfully
with `compRatio: null` for every row. A file with two `Base Pay Compa Ratio`
columns is rejected before any row is mapped. A synthetic file (the
reference file has no such cell) where one row's `Base Pay Compa Ratio` cell
holds a non-numeric value — a text string, or a formula — is rejected before
any row is committed, exactly as a malformed `Worker Total Base Pay Amount`
cell is rejected today.

#### FR-2.2: Comp ratio is validated and stored per salary snapshot

When `compRatio` is non-null, it must be a finite, non-negative number
(the same shape check `isFiniteNonNegative` already applies to `baseSalary`/
`bonus`); a value failing this check raises the same `ValidationError` those
fields already raise. No plausibility ceiling beyond finite-and-non-negative
is imposed: a value entered in the wrong units (e.g. `114.1603`, as if the
source had already been expressed as a percentage) is accepted and
displayed exactly as supplied. This is an accepted, unverified stance, not a
gap this spec closes — matching this project's existing pattern of accepting
input-shape assumptions it has no independent way to validate (spec 004
Constraints' N+1-query performance stance is the same kind of explicit,
undecided trade-off).

It is stored on the `salary_history` row for that employee/year, alongside
`currency`/`base_salary`/`bonus`, since it is a snapshot value tied to a
specific import's compensation data, not a standing employee attribute.
Unlike `currency`/`base_salary`/`bonus` (which are all non-null together, or
the row doesn't exist), `compRatio` is independently nullable on an existing
salary row: a WorkDay export could supply base pay without a resolvable
market range (and therefore no compa ratio) for a given role, or the column
could be entirely absent from an older export re-imported later.

**Verify:** Re-importing the reference file writes `comp_ratio = 1.141603`
on `00000015867`'s current-year `salary_history` row; importing the same
data with the `Base Pay Compa Ratio` column removed instead writes
`comp_ratio = NULL` on that same row while `currency`/`base_salary`/`bonus`
remain populated exactly as before. Independently — using a synthetic
fixture built through the database's write API, since every one of the
reference file's 43 rows carries a non-null comp ratio and none can produce
this state — an employee whose current-year salary row exists with
`currency`/`base_salary`/`bonus` all populated, but whose `Base Pay Compa
Ratio` cell was blank on import, has `comp_ratio = NULL` on that same row:
this mixed state (salary present, comp ratio absent) is the genuinely new
case this feature introduces, distinct from the no-salary-row-at-all case
above.

#### FR-2.3: `GET /api/employee-details` gains `compRatio`

The payload's per-employee projection (spec 004 FR-4.1) gains a ninth key,
`compRatio: number | null`, inserted between `bonus` and `ratings` — i.e.
the projection's key order becomes `id, name, position, managerId, currency,
baseSalary, bonus, compRatio, ratings` — populated from the same
`getCurrentSalary(id)` call the endpoint already makes (spec 004 FR-4.2), no
new query. `compRatio` is `null` whenever `getCurrentSalary` returns `null`
(no eligible salary row at all, per spec 004 FR-1.3) and independently
`null` whenever that row's `comp_ratio` column is `null` (FR-2.2) — the two
`null` cases are indistinguishable in the payload, matching how
`currency`/`baseSalary`/`bonus` already collapse the "no row" case into the
same `null` shape.

**Verify:** With the reference file imported, `GET /api/employee-details`'s
entry for `00000015867` includes `compRatio: 1.141603` immediately after
`bonus` and before `ratings`, alongside its existing eight keys; an employee
with no `salary_history` row at all shows `compRatio: null` alongside
`currency`/`baseSalary`/`bonus` all `null`. Independently, an employee whose
salary row exists but whose `comp_ratio` column is `NULL` (FR-2.2's mixed
state) shows `currency`/`baseSalary`/`bonus` populated normally alongside
`compRatio: null` — confirming the two `null` cases are handled
independently rather than conflated with the no-salary-row case.

#### FR-2.4: Comp Ratio column on the table

The table gains a "Comp Ratio" column immediately after "Bonus" and before
"Most Recent Rating" — matching FR-2.3's payload key position, per spec 004
FR-1.2's rule that column order follows payload key order. Two independent,
ordered lists in `employee-details.html` must both gain this entry, in the
same position, in the same change: the `COLUMNS` array (used to render
headers) and `renderRow`'s `values` array (used to render cells) — these
must stay in sync with each other and with FR-2.3's payload key order, or
headers and cells misalign. A `null` value renders as `—`, reusing the
existing `cellText()` helper unchanged (it already renders any non-null
value via `String(value)`, so no rendering change is needed beyond adding
the column, its header, and its cell-value entry in both arrays above).

**Verify:** For `00000015867`, the rendered row's Comp Ratio cell reads
`1.141603` and sits between the Bonus and Most Recent Rating columns; for an
employee with no salary row, every one of `currency`/`baseSalary`/`bonus`/
`compRatio` in that row reads `—`. For an employee in FR-2.2's mixed state
(salary present, comp ratio absent), the row shows real values in
Currency/Base Salary/Bonus alongside `—` in Comp Ratio alone — distinguishing
it from the no-salary-row case, where all four cells read `—` together.

#### FR-2.5: Comp Ratio is sortable, numerically, missing-last

`public/employeeDetailsLogic.js`'s column-sort machinery (spec 004 Feature 3)
treats `compRatio` as a numeric column: added to `NUMERIC_COLUMNS` and to
`COLUMN_VALUE`, so it sorts via numeric comparison (spec 004 FR-3.2) and
follows the existing missing-values-sort-last rule (spec 004 FR-3.3) in
either direction. The payload validator (`isValidPayload`, spec 004
AR-2.3/FR-4.4) gains `compRatio` in its `REQUIRED_EMPLOYEE_KEYS` list and
requires it to satisfy the existing `isNumberOrNull` check already used for
`baseSalary`/`bonus`.

**Verify:** Clicking the "Comp Ratio" header sorts ascending by that value
with missing (`—`) rows sorting last in both directions, exactly matching
spec 004 FR-3.2/FR-3.3's existing rules for `baseSalary`; a payload body
missing the `compRatio` key is rejected by `isValidPayload` the same way a
body missing `ratings` already is (spec 004 FR-4.4).

### Architectural Requirements

#### AR-2.1: New nullable column, added via the existing idempotent-migration pattern

`src/db/schema.ts`'s `CREATE TABLE IF NOT EXISTS salary_history` gains a new
nullable column, `comp_ratio REAL`. Because `CREATE TABLE IF NOT EXISTS` is a
no-op against an already-existing table, `src/db/connection.ts` gains a new
migration function mirroring `migrateExternalManagerColumn` — cited in that
function's own code comment as spec 005's AR-2.1/ADR-001 pairing
(`specs/features/005-headcount-manager-context/ADR.md`) — e.g.
`migrateCompRatioColumn`, checking `PRAGMA table_info(salary_history)` for
the column and running `ALTER TABLE salary_history ADD COLUMN comp_ratio
REAL` only if it's missing — called from `initDatabase` alongside the
existing migration call, so a pre-existing database file gains the column on
next `npm start` with no manual step and no effect on existing rows.

#### AR-2.2: Type, mapper, and mutation signature updates

`src/db/types.ts`'s `SalaryRecord` gains `compRatio: number | null`;
`src/db/queries.ts`'s `SalaryRow` interface and `toSalaryRecord` mapper are
updated to read/carry `comp_ratio`. `src/db/mutations.ts`'s
`validateSalaryRecord` gains FR-2.2's check (only when `compRatio` is
non-null); `upsertSalaryRecord(employeeId, effectiveYear, currency,
baseSalary, bonus, compRatio)` gains the new, sixth parameter (nullable,
defaulting to `null`), written into the `INSERT ... ON CONFLICT DO UPDATE`
statement's column list and `SET` clause alongside the three existing
fields. Any existing 5-argument caller of `upsertSalaryRecord` (there are
none outside `src/import/reconcile.ts` today, but the default exists for any
future one) will now write `comp_ratio = NULL` — intended, matching how the
5th parameter's own existing default (`bonus = 0`) already behaves for a
caller that omits it. Unlike `baseSalary`/`bonus`, `compRatio` is not passed
through `roundToTwoDecimals` — it is not a currency amount, and rounding a
ratio to two decimals would discard meaningful precision (`1.141603` would
become `1.14`); it is stored exactly as validated.

#### AR-2.3: Reconciliation passes the mapped field through unchanged

`src/import/reconcile.ts`'s existing `upsertSalaryRecord(row.employeeId,
effectiveYear, row.currency, row.baseSalary, row.bonus)` call (spec 002
FR-1.5) gains `row.compRatio` as its sixth argument. No new reconciliation
pass or ordering change is needed — this is a same-row, same-call addition
alongside data already being written in that loop.

---

## Feature 3: Position-by-Region Matrix on the Headcount Dashboard

**Who & why:** The Headcount Dashboard's totals-by-position breakdown (spec
003 FR-2.2) is a flat, count-descending list with no sense of seniority
progression or where those people sit. The user wants to scan the org by
career level — entry engineers, then each senior tier, then principal, lead,
and senior-principal roles, in that fixed order — and see, for each role, how
many sit in each of the existing region colour buckets (spec 003 AR-1.2:
blue = UK/US, red = India, green = everywhere else), with a running total per
bucket and one grand total that must always agree with the "Total headcount"
figure already on the page.

### Functional Requirements

#### FR-3.1: Positions are grouped into a fixed sequence of seniority bands

Every distinct `position` string among the currently-visible, non-external
employees (spec 003 FR-2.6: recomputed from the visible set on every filter
change; the external-manager exclusion is stated as an explicit precondition
in AR-3.1 below) is classified into exactly one of eight bands, evaluated in
this fixed priority order — the first matching rule wins:

1. **Senior Principal** — the position contains a "senior" indicator token
   (`senior` or `sr`) and a "principal" indicator token (`principal` or
   `prin`).
2. **Lead** — the position contains the token `lead`.
3. **Principal** — the position contains a "principal" indicator token
   (`principal` or `prin`).
4. **Senior 2** — the position contains a "senior" indicator token and a
   level-2 token (`ii` or `2`).
5. **Senior 1** — the position contains a "senior" indicator token and a
   level-1 token (`i` or `1`).
6. **Software Engineer 2** — the position contains both the tokens
   `software` and `engineer`, and a level-2 token (`ii` or `2`).
7. **Software Engineer 1** — the position contains both the tokens
   `software` and `engineer`, and a level-1 token (`i` or `1`).
8. **Other** — anything not matched by rules 1–7 (e.g. a bare `III`-level
   title, a seniority title with no numeral at all such as `Senior Software
   Engineer`, or a title with no recognizable level or seniority indicator).

A "token" is produced by splitting the position string on any run of
non-alphanumeric characters, lowercasing each piece, and dropping any
resulting empty piece (e.g. from a leading, trailing, or doubled separator)
— so `"Consult/Prin Quality Test Engr"` tokenizes to `[consult, prin,
quality, test, engr]`, and `"Sr. Business Analyst"` tokenizes to `[sr,
business, analyst]`. Matching is by exact token equality, not substring
search — this is required precisely so `"Software Engineer III"`
(tokenizing to `[software, engineer, iii]`) does **not** match the level-2
rule, since `"iii"` is a distinct token from `"ii"`, even though the string
`"iii"` contains the substring `"ii"`.

Rules 1, 3, 4, and 5 are deliberately job-family-agnostic — they match on
seniority/level tokens alone, regardless of what else is in the title, so
`Senior Quality Test Engineer II` lands in Senior 2 alongside any `Senior
Software Engineer II`. Rules 6 and 7 (Software Engineer 1/2) are
deliberately narrower: they additionally require the `software`+`engineer`
token pair, because these two bands were named for the Software Engineering
title specifically, not as a generic "entry IC level 1/2" bucket that would
otherwise also have to absorb every other family's untitled entry-level
roles. This asymmetry between the two ends of the band sequence is
intentional.

Rule 2 (Lead) matches on the bare token `lead` with no seniority qualifier,
so it outranks rules 1 and 3 whenever a title happens to combine "Lead" with
"Principal" or "Senior" wording — e.g. a hypothetical `Principal Software
Engineering Lead` classifies as Lead, not Principal. This match-priority
order (which rule wins when a title could satisfy more than one) governs
classification only; it is independent of the bands' fixed *display* order
(FR-3.2), where Lead renders between Principal and Senior Principal to match
the career-ladder progression the user described. The two orderings serve
different purposes and are not expected to agree with each other.

This classification is defined only over the `position` values of real
(non-external) employees. `position` is a required, non-blank string
validated at write time (`src/db/mutations.ts`'s `validateEmployeeInput`),
so a real employee's `position` is never blank or `null` by the time it
reaches this classifier; a spec-005 external-manager placeholder entry's
`position` is `null` and must never reach this classifier at all — see
AR-3.1's precondition on `positionRegionBreakdown`'s input.

The exported band-order constant (AR-3.1) holds the eight band names above
verbatim, in the display order FR-3.2 specifies; each name doubles as both
the internal classification result and the literal rendered header text —
no separate label lookup exists.

**Verify:** Against the reference file's 14 distinct positions, this
classification produces exactly: Software Engineer 2 — `Software Engineer
II` (4); Senior 1 — `Senior Software Engineer I` (6); Senior 2 — `Senior
Software Engineer II` (6), `Senior Quality Test Engineer II` (1); Principal —
`Consult/Prin Quality Test Engr` (1), `Consulting/Principal Quality Test
Engineer` (3), `Principal Quality Test Engineer` (1), `Consulting/Principal
Software Engineer` (4), `Principal Software Engineer` (1); Lead —
`Software Engineering Lead` (5); Senior Principal — `Sr Principal Software
Engineer` (1); Other — `Software Engineer III` (6), `Quality Test Engineer
III` (3), `Sr. Business Analyst` (1). No position matches Software Engineer
1 in this file (band renders empty and is omitted, per FR-3.3). Band counts
sum to 43.

#### FR-3.2: Bands render in a fixed order; within a band, positions keep today's tie-break

The table renders bands in this fixed sequence: Software Engineer 1,
Software Engineer 2, Senior 1, Senior 2, Principal, Lead, Senior Principal,
Other. Within a band, its member positions are ordered exactly as spec 003
FR-2.2 already orders the flat list — by total visible count descending,
then position ascending via `localeCompare` — so this spec changes grouping
and order *between* bands without changing the existing, already-tested
ordering rule *within* one.

**Verify:** In the reference file, the Principal band's five positions render
in the order `Consulting/Principal Software Engineer (4)`, `Consulting/Principal
Quality Test Engineer (3)`, then the three count-1 positions ordered
alphabetically among themselves — matching FR-2.2's existing tie-break
applied within this one band.

#### FR-3.3: Zero-count bands are omitted; the grand total always agrees with headcount

A band with no currently-visible member position is omitted entirely from
the rendered table — not shown with a zero-filled row — mirroring spec 003
FR-2.6's existing rule that a position whose count falls to zero disappears
rather than showing `— 0`. Because each band's member positions are derived
directly from the currently-visible, non-external employee set (FR-3.1), a
position can never appear with a zero total that must be separately filtered
out — if it has no visible employees at all, it is simply absent from the
set FR-3.1 classifies in the first place. This is also why FR-3.4's grand
total can never disagree with the number of currently-visible, non-external
employees: it is a sum over exactly that set, by construction, not a figure
that could drift from it.

When every band is empty — reachable if the currently-visible, non-external
employee set is itself empty (e.g. after unchecking the checkbox for spec
005's external-manager placeholder, whose subtree is every real employee
once no in-file manager remains a distinct root) — the table renders only
its column headers and a totals row reading Blue 0 / Red 0 / Green 0 /
Total 0; no band rows and no additional empty-state message are shown. This
table has no dedicated empty-state wording elsewhere in this spec, unlike
spec 003 FR-2.7's chart-only "no manager teams selected" message, which does
not cover this table.

**Verify:** In the reference file with all managers checked, the Software
Engineer 1 band (which has zero matching positions per FR-3.1's Verify) does
not appear in the rendered table at all — there are 7 band groups rendered,
not 8. Separately, with every manager unchecked on a headcount payload whose
only root is an external-manager placeholder (spec 005), the table renders
its header row and a totals row of Blue 0 / Red 0 / Green 0 / Total 0, with
no band rows.

#### FR-3.4: Each band's rows are broken out by region bucket, with per-bucket and grand totals

The table's leftmost column header reads "Position"; the four data column
headers are, in order, "Blue — UK & US", "Red — India", "Green — all other
countries", and "Total" — the first three colour-coded and labelled exactly
as the existing legend text (spec 003 FR-1.7), reusing that exact region
mapping (spec 003 AR-1.2: blue = UK/US, red = India, green = everywhere
else). Each band's positions are preceded by one full-width band-header row
— a single cell spanning all five columns, whose text is that band's name
(FR-3.1's literal band-name-as-label rule). For each rendered position row,
the table shows one count per region bucket plus a row total. Beneath all
band groups, one totals row — its leftmost cell labelled "Totals" — sums
each region bucket's column across every rendered position (not only the
last band), plus a grand total that must equal the number of
currently-visible, non-external employees — the same figure spec 003
FR-2.1's "Total headcount" heading already shows (spec 005 FR-2.6's
`isExternal` exclusion applies here identically, since this table reads the
same visible-and-real employee set `renderTotals` already computes for
`totals()`). Recomputed on every manager-checkbox change exactly as the
existing totals already are (spec 003 AR-2.2).

**Verify:** With the reference file imported and every manager checked, the
region-bucket totals row reads Blue 29, Red 13, Green 1 (matching spec 003
FR-1.6's existing colour-count Verify), and the grand total reads 43,
matching "Total headcount: 43". Deselecting a manager whose team is entirely
one region bucket reduces that bucket's column total and the grand total by
that team's size, while the other buckets' totals are unchanged.

### Architectural Requirements

#### AR-3.1: Classification and the pivot are new, DOM-independent exports in `chart-logic.js`

`public/chart-logic.js` gains a new exported constant for the fixed band
order (FR-3.2) and a new exported classification function, e.g.
`classifyPositionBand(position)`, implementing FR-3.1's token rules — a
single named function, following spec 003's AR-1.2 existing "single named
constant for a classification mapping" precedent (there: country → colour
bucket; here: position → seniority band).

A second new export, e.g. `positionRegionBreakdown(visibleEmployees)`,
builds the full grouped structure FR-3.2–FR-3.4 need. It **requires its
input to already exclude every `isExternal: true` entry** (spec 005 FR-2.4's
external-manager placeholder, whose `position` is `null` and would
otherwise reach — and throw inside — `classifyPositionBand`); `headcount.html`
must apply the same `.filter(employee => !employee.isExternal)` it already
applies before calling `totals()` (spec 005 FR-2.6) before calling this
function too. Given that precondition, it returns a plain object of this
shape:

```
{
  bands: [
    {
      band: "Senior 2",   // one of FR-3.1's eight names, in FR-3.2's fixed
                           // order; a band with no member positions is
                           // omitted from this array entirely (FR-3.3)
      rows: [
        { position: "Senior Software Engineer II", blue: 6, red: 0, green: 0, total: 6 },
        { position: "Senior Quality Test Engineer II", blue: 0, red: 1, green: 0, total: 1 }
      ]                    // ordered per FR-3.2's within-band tie-break
    }
    // ...one entry per non-empty band, in FR-3.2's fixed order
  ],
  totals: { blue: 29, red: 13, green: 1, total: 43 }   // FR-3.4's grand total, always present even when `bands` is []
}
```

This is a pure function taking data and returning data, no DOM access,
matching spec 003 AR-2.3's existing "chart logic is DOM-independent and
unit-testable" rule. The existing `totals()` function (spec 003 FR-2.1's
headcount figure) is unchanged and still called separately;
`positionRegionBreakdown` is additive, not a replacement of `totals()`'s
own return shape.

#### AR-3.2: `headcount.html`'s totals rendering is rewritten as thin wiring only

`renderTotals` in `public/headcount.html` is rewritten to render the new
grouped, columned table structure (FR-3.4's headers, band-header rows,
per-position region counts, the totals row) by calling
`positionRegionBreakdown` (on the same `!employee.isExternal`-filtered array
already passed to `totals()`) and iterating its result — no classification
or aggregation logic lives in this file, matching this project's existing
DOM-independent-logic convention. Every `position` string, and every band
name and column header rendered from FR-3.1's fixed literal text, reaches
the DOM through `element(...)`/`textContent` — never template-string
interpolation — matching spec 003 AR-1.4's existing rule, extended
explicitly to this new table since `position` is untrusted imported text
exactly like every other employee-derived field this screen already renders
safely. The existing `<h2>Total headcount: N</h2>` line (spec 003 FR-2.1) is
unchanged and continues to come from `totals()`, not from the new pivot's
grand total — FR-3.4's Verify line is what confirms the two
independently-computed figures still agree.

#### AR-3.3: This is a scoped exception to the project's "no position normalisation" convention

Spec 003's Constraints ("no position normalisation") and spec 004's
identical precedent govern how the raw `position` string is grouped and
displayed everywhere else in this app — two differently-spelled equivalent
roles remain two distinct rows/checkboxes. `classifyPositionBand` (FR-3.1)
is a narrow, explicit exception, used only to choose which band-group a
position's row renders under on this one table; it does not alter, merge, or
rename the underlying `position` string anywhere — each position still
renders under its own exact-string row (FR-3.2), the position checkbox list
on Employee Details is untouched, and no other consumer of `position`
anywhere in the app is affected.

#### AR-3.4: New header styling, not a reuse of the `.card` classes

The `<th>` elements carrying each region bucket's colour (FR-3.4) get three
new CSS classes — e.g. `.region-header.blue/.red/.green` — that set only
`background-color` to the exact hexes spec 003 AR-1.2/FR-1.7 already fixed
(`#d6e4f7`/`#f7d6d6`/`#d9f0dc`) and `color: #1a1a1a`, the same text colour
those hexes were contrast-checked against (13.5:1/12.9:1/14.5:1, spec 003
FR-1.7 — the ratios carry over unchanged because only the background/text
colour pair is reused, not the rest of the card styling). They do **not**
reuse the `.card`/`.card.blue`/`.card.red`/`.card.green` classes
(`headcount.html` lines 15–19), which additionally carry `max-width:
22rem`, card padding, border, and border-radius meant for the org-chart
cards, not a table header cell. `headcount.html`'s existing `#totals
table`/`#totals td` rules apply to the new table as they do today; a new
`#totals th` rule is added for basic header styling (e.g. `text-align:
left`, `font-weight: 700`), giving header cells comparable visual weight to
`employee-details.html`'s own sortable `<th>` buttons (spec 004's table).

---

## Data Requirements

| Source | Field | Used for |
| --- | --- | --- |
| `salary_history` | `comp_ratio` (new, nullable `REAL`) | Comp Ratio column and sort on Employee Details (FR-2.2, FR-2.3, FR-2.4, FR-2.5) |
| `ImportRow` | `compRatio: number \| null` (new) | Optional-column mapping from `Base Pay Compa Ratio` (FR-2.1) |
| `SalaryRecord` | `compRatio: number \| null` (new) | Query-layer carrier for the new column (AR-2.2) |
| `employees` | `manager_id` (existing) | Root-manager identification for FR-1.1's isolation flag, via existing `isRoot()`/`buildTree`/`managerList` |
| `employees` | `position` (existing, unchanged) | Band classification input (FR-3.1) — read, never written or normalised |

## Integration Points

| Integration | Detail |
| --- | --- |
| `src/import/parseWorkbook.ts` | New optional-column detection and mapping for `Base Pay Compa Ratio` (FR-2.1), generalizing the existing duplicate-optional-header check |
| `src/import/reconcile.ts` | Existing `upsertSalaryRecord` call gains `row.compRatio` as a sixth argument (AR-2.3) |
| `src/db/schema.ts`, `src/db/connection.ts` | New `comp_ratio` column and a new idempotent migration function mirroring `migrateExternalManagerColumn` (AR-2.1) |
| `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts` | `SalaryRecord`/`SalaryRow`/`toSalaryRecord`/`validateSalaryRecord`/`upsertSalaryRecord` updated for the new field (AR-2.2) |
| `src/server/app.ts` (`/api/employee-details`) | Payload gains `compRatio` from the existing `getCurrentSalary` call, inserted between `bonus` and `ratings` (FR-2.3) |
| `public/chart-logic.js` | New `visibleIds` option (AR-1.1); new `classifyPositionBand`, band-order constant, and `positionRegionBreakdown` exports (AR-3.1) |
| `public/employeeDetailsLogic.js` | `visibleRows` gains a required 4th parameter and computes/passes the new isolation flag (AR-1.1); `NUMERIC_COLUMNS`/`COLUMN_VALUE`/`REQUIRED_EMPLOYEE_KEYS`/`isValidPayload` extended for `compRatio` (FR-2.5) |
| `public/employee-details.html` | New Comp Ratio entries in both `COLUMNS` and `renderRow`'s `values` array (FR-2.4); `start()` precomputes `rootManagerIds` once and passes it into `visibleRows` (AR-1.1) |
| `public/headcount.html` | `renderTotals` rewritten as thin wiring over `positionRegionBreakdown`; new `#totals th` and `.region-header.*` CSS (AR-3.2, AR-3.4) |

## Related Specs

| Spec | Relationship | Affected Requirements |
| --- | --- | --- |
| [Spec 001: Data Foundation & SQLite Schema](../001-data-foundation/spec.md) | **Extends** — adds a new nullable `salary_history.comp_ratio` column via the same idempotent-migration pattern spec 005 established | Schema requirements in spec 001; AR-2.1 |
| [Spec 002: WorkDay Import Screen](../002-workday-import/spec.md) | **Modifies** — a new optional import column, following the exact `Direct Supervisor Name` optional-column precedent | FR-1.5, reconciliation loop |
| [Spec 003: Headcount Dashboard Screen](../003-headcount-dashboard/spec.md) | **Modifies** — replaces the flat totals-by-position breakdown with the seniority-band-ordered, region-columned matrix; the flat list's exact rendering is superseded, though its underlying visible-set/recompute pattern is reused unchanged | FR-2.2, AR-2.2 (its "not fetched" principle is preserved, not its rendered shape) |
| [Spec 004: Employee Details Screen](../004-employee-details/spec.md) | **Modifies** — root-manager isolation changes root visibility under the manager filter (superseding FR-2.5's "manager filter alone can never reach zero rows" claim), and a new sortable Comp Ratio column extends the table, sort machinery, and payload validator | FR-1.2 (via reused `visibleIds`), FR-2.2, FR-2.3, FR-2.5, FR-3.2, FR-3.3, FR-4.1, FR-4.4, AR-2.1, AR-2.3 |
| [Spec 005: Headcount Dashboard Manager Context](../005-headcount-manager-context/spec.md) | **Modifies** — deliberately revisits this spec's Out of Scope statement that the Employee Details manager filter is unaffected by headcount-only changes, and its AR-2.4 claim of "no changes to `visibleIds`" (both superseded, additively); reuses its FR-2.6 `isExternal` filter at the same `renderTotals` call site this spec's Feature 3 rewrites | AR-2.4, FR-2.6, Out of Scope (Employee Details exclusion) |

## Constraints

- **No currency conversion, no compa-ratio recomputation.** `compRatio` is
  stored and displayed exactly as WorkDay supplies it — this app never
  computes a compa ratio from base salary and a range midpoint of its own;
  it has no range data at all beyond this one pre-computed figure.
- **No new required header.** `Base Pay Compa Ratio`, like `Direct Supervisor
  Name` before it, stays optional — a file lacking it must continue to
  import successfully, with `compRatio: null` throughout (FR-2.1). A file
  that has the column but supplies a non-numeric value in it is a different
  case and is rejected (FR-2.1).
- **Position band classification is presentation-only** (AR-3.3) — it
  affects only which group a row renders under on the Headcount Dashboard's
  totals table; the underlying `position` string, its use as a Employee
  Details checkbox/filter value, and every other screen are unaffected.
- **The isolation flag is Employee-Details-only** (AR-1.1) — the Headcount
  Dashboard's own manager filter and its FR-2.7 "no manager teams selected"
  behavior are unchanged; `visibleIds()`'s new option defaults to preserving
  that screen's existing behavior exactly.
- **Local, single-user, no authentication**, inherited from specs 002–004 —
  the new Comp Ratio figure is exposed through the same unauthenticated,
  loopback-bound, `Cache-Control: no-store` endpoint that already carries
  salary and rating data (spec 004 AR-4.1/AR-4.4). A compa ratio is, if
  anything, more directly comparable across people than raw salary — it is
  already currency- and level-normalized, which makes peer comparison
  trivial in a way a raw salary figure alone is not — so this is treated as
  a modest widening of the existing accepted exposure, not a strictly
  equivalent one.
- **No framework, no build step**, inherited from specs 002–004.

## Out of Scope

- Total Target Cash Compa Ratio (the export's other compa-ratio column,
  which factors in bonus/incentive target) — only Base Pay Compa Ratio is
  imported and displayed by this spec.
- Importing or displaying `Base Pay Range (1 FTE)`, `Total Target Cash Range
  (1 FTE)`, `Zone - Base Pay Range`, `Compensation Grade Profile`,
  `Management Level`, or any other market-range/leveling column from the
  export — this spec captures only the one pre-computed ratio figure, not
  the underlying range data.
- Any change to the Headcount Dashboard's manager filter behavior, its
  FR-2.7 all-deselected message, or its card rendering — Feature 1's
  isolation change is scoped to Employee Details only (AR-1.1, AR-1.2).
- Any change to the Employee Details position filter, or to how positions
  are grouped/labelled in that screen's own checkbox list — Feature 3's band
  classification exists only on the Headcount Dashboard's totals table
  (AR-3.3).
- A per-band subtotal row (e.g. a "Principal total" line) on the Headcount
  Dashboard's new table — only per-region-bucket subtotals and one grand
  total are in scope (FR-3.4).
- Sorting, filtering, or otherwise interacting with the new position-by-
  region table beyond what the existing manager checkbox filter already
  drives — it is a derived report, not an independently sortable table like
  Employee Details' own (spec 004 Feature 3).
- Persisting or exporting the position-by-region breakdown (print, CSV,
  image) — matches spec 003's existing "no export" exclusion.
- Rounding or reformatting the Comp Ratio value for display (e.g. as a
  percentage string) — it renders as the plain stored number, matching how
  `baseSalary`/`bonus` already render with no unit formatting (spec 004
  AR-1.1). WorkDay's own cell displays this same value as a percentage
  (`114.16%`, `numFmt: #,##0.00%`) while this screen shows the underlying
  decimal (`1.141603`); the two representations will visibly disagree if
  compared side-by-side against the source spreadsheet — an intentional
  consequence of this rule, not a defect, but worth knowing before a
  reviewer cross-checks against the export directly.
- A dedicated empty-state message for the position-by-region table when it
  renders with no band rows (FR-3.3) — the zeroed totals row already
  communicates the state.
- Backfilling `comp_ratio` for salary rows already in the database before
  this spec ships — like every other import-derived field, it populates
  only from imports that happen after this spec is implemented.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — every FR carries a **Verify:** line
  with concrete reference-file figures (43 employees, the 14 distinct
  positions and their exact band assignments, the 5/11-root manager
  structure, the 9-row and 30-row isolation-mode outcomes); Out of Scope
  lists 9 explicit exclusions, including the two adjacent WorkDay columns
  (Total Target Cash Compa Ratio, Management Level) a reader might otherwise
  assume are also in scope.
- [x] **Testing strategy** — follows the existing pattern (`node:test` via
  `tsx`, one file per feature area, FR ids in test names). Feature 1's
  changes require **editing**, not merely extending, existing tests: the
  five 3-argument `visibleRows(employees, positions, managerIds)` calls in
  `test/employeeDetails/employeeDetailsLogic.test.ts` (today's
  default-selection scenarios) must be updated to pass a `rootManagerIds`
  set per AR-1.1's now-required fourth parameter. New tests cover FR-1.1's
  common one-manager-unchecked case (30 visible) and FR-1.2's actually-
  isolated nested-manager case (A/B visible, C/X/Y hidden), reusing the
  A→B→C-style fixture pattern this project's tests already use for
  multi-level scenarios the reference file's 2-level tree can't produce.
  Feature 2's column, mutation, and mapping changes extend
  `test/db/salary.test.ts`, `test/import/parseWorkbook.test.ts`,
  `test/import/reconcile.test.ts`, and `test/server/employeeDetails.test.ts`
  — but the last of these requires an **edit**, not an extension:
  `test/server/employeeDetails.test.ts`'s existing exact-eight-key
  assertion (and its "exactly the eight top-level keys" test name) becomes
  nine, and spec 004 FR-4.1's own "eight-key projection" wording is now
  stale by construction of this spec. New Feature 2 tests cover FR-2.1's
  non-numeric-cell rejection (D3) and FR-2.2/FR-2.3/FR-2.4's mixed
  salary-present/comp-ratio-absent state, both needing a synthetic fixture
  since the reference file has zero blank or non-numeric cells in this
  column. Feature 3's `classifyPositionBand` and `positionRegionBreakdown`
  are pure functions addable to `test/dashboard/chartLogic.test.ts`,
  directly verifiable against FR-3.1's worked 14-position table and
  AR-3.1's literal return shape, without needing a running server or a real
  `.xlsx` fixture.
- [x] **Existing patterns** — AR-1.1 (additive, default-preserving option on
  a shared function, not a fork), AR-2.1 (idempotent migration mirroring
  `migrateExternalManagerColumn`), AR-2.2/AR-2.3 (mirrors the existing
  `Direct Supervisor Name` optional-column precedent exactly, including its
  type-check-on-present-value behavior per FR-2.1's D3 resolution),
  AR-3.1/AR-3.2 (DOM-independent logic module, thin-wiring rendering) each
  name the specific existing pattern and file being followed.
- [x] **Dependencies** — none added. No new package; `ExcelJS`'s existing
  numeric-cell reading is reused for the new optional column.
- [x] **Architecture & interfaces** — AR-1.1 fixes both `visibleIds`'s
  backward-compatible option and `visibleRows`'s exact new required
  signature; AR-2.1/AR-2.2 fix the schema, type, and mutation-signature
  changes precisely, naming `validateSalaryRecord` as well; AR-3.1 fixes
  `positionRegionBreakdown`'s literal return shape and its
  external-manager-exclusion precondition, not merely "the full grouped
  structure". The Data Requirements, Integration Points, and Related Specs
  tables enumerate every field read/written and every existing file
  touched. This spec touches no `specs/docs/` living-doc file directly,
  though `specs/docs/domains/headcount-dashboard/` and
  `specs/docs/domains/employee-details/` describe behavior it changes and
  should be updated during implementation, matching spec 005's own
  precedent of updating `specs/docs/` on landing.
- [x] **Error handling & failure modes** — FR-2.1 now defines the
  non-numeric-present-cell case explicitly (reject, matching
  `Direct Supervisor Name`'s type-check precedent) alongside optional-column
  graceful degradation and duplicate-header rejection; FR-2.2 defines the
  validation error for an out-of-range comp ratio, matching `baseSalary`/
  `bonus`'s existing rule; FR-3.3 defines zero-count band omission and the
  all-bands-empty rendering state; AR-3.1 states `positionRegionBreakdown`'s
  precondition that excludes external-manager entries before classification
  ever sees a `null` position; FR-1.1 explicitly states and resolves the
  one place this spec invalidates an existing documented invariant (spec
  004 FR-2.5's "manager filter alone never reaches zero rows"), rather than
  leaving the contradiction implicit.
- [x] **Security review** — no new input surface beyond one more optional
  spreadsheet column, now with an explicit type-check-and-reject rule for a
  present, malformed value (FR-2.1), read through the same upload-validation
  path spec 002 already established. The new Comp Ratio figure reaches the
  DOM through the existing `cellText()` → `textContent` path (spec 004
  AR-1.1) with no new rendering code; the new pivot table's `position`
  strings and fixed literal labels reach the DOM the same way (AR-3.2),
  matching spec 003 AR-1.4. It is served through the same endpoint, same
  `Cache-Control: no-store` header, and same accepted local-exposure risk
  spec 004 already documents for salary and rating data — widened slightly,
  not strictly equivalently, since a compa ratio is more directly
  cross-comparable than raw salary (Constraints). Feature 3 introduces no
  new endpoint or input surface at all; it is a pure client-side
  reclassification of data the Headcount Dashboard already receives.
- [x] **Performance impact** — Feature 1's `visibleRows` change stays
  `O(n)` per refresh once the root-manager-id set is computed once at page
  load rather than rebuilt on every checkbox click (AR-1.1's now-mandatory
  precompute — the naive alternative would call `buildTree` three times per
  click). Feature 2 adds one nullable column read/written alongside three
  already-read/written columns on the same row — no new query. Feature 3's
  `positionRegionBreakdown` is `O(n + p log p)` where `p` is the small
  number of distinct visible positions (14 in the reference file) — the
  `p log p` term is FR-3.2's within-band sort, not a single flat pass, but
  immaterial at this project's scale (hundreds to low thousands of
  employees, at most a few dozen distinct positions).
- [x] **Rollout & migration** — AR-2.1's migration function follows
  `migrateExternalManagerColumn`'s exact idempotent, additive, non-destructive
  pattern: a pre-existing database gains the column on next `npm start` with
  no manual step and no effect on existing rows. No other schema change; no
  new dependency.
- [x] **Assumptions & risks** — stated below.

### Assumptions & Risks

- **Assumed:** "Comp ratio" means Base Pay Compa Ratio specifically, not
  Total Target Cash Compa Ratio — the more common definition (base salary
  against range midpoint), and the narrower of the two importable figures.
  Revisit by adding the second column later if the base-pay-only figure
  proves insufficient in practice (Out of Scope).
- **Assumed:** Once at least one root manager is unchecked, isolating
  visibility to only checked managers (and hiding every other root,
  including individual contributors with no resolvable manager) is the
  right interpretation of "select a manager and see only their team" —
  chosen because it composes cleanly with the existing per-manager
  subtractive traversal (FR-1.2) and requires no change to any *non-root*
  visibility rule.
- **Assumed:** The eight named bands (seven career-ladder bands plus the
  `Other` catch-all) are evaluated as fixed, hand-specified rules against
  tokenized title text (FR-3.1), not derived from WorkDay's own
  `Management Level` field — chosen because it needs no new import work and
  the token rules fully reproduce the requested band order against the
  reference file. **Risk:** a future export with differently-worded titles
  (e.g. a title using "Snr" instead of "Sr", or a numeral spelled out as
  "Two" instead of "II") would silently fall into "Other" rather than its
  intended band — the same class of risk spec 003's AR-1.2 already accepts
  for its own country-string mapping. A more likely real-world case than
  either of those: a seniority title with **no numeral at all** (e.g. a
  plain `Senior Software Engineer`, with no "I"/"II" suffix) falls to
  `Other` rather than either Senior band under the rules as written — worth
  a glance at the rendered bands after a first import from a differently-
  structured export, and worth revisiting if that title shape turns out to
  be common.
- **Accepted:** `compRatio` is stored unrounded (AR-2.2), unlike
  `baseSalary`/`bonus`. This is a deliberate asymmetry, not an oversight —
  rounding a ratio like `1.141603` to two decimals would visibly change the
  displayed figure, whereas rounding a currency amount to its own minor unit
  does not.
- **Accepted:** No plausibility ceiling is imposed on a validated comp
  ratio beyond finite-and-non-negative (FR-2.2) — an input-shape assumption
  this spec does not independently verify, consistent with this project's
  existing acceptance of similar unverified assumptions elsewhere (spec 004
  Constraints).

---

## Change Log

### Update from critique-consolidated-v1.md

**Applied:**

- Fixed `visibleRows`'s new parameter to an exact, required, named signature
  (`rootManagerIds`), rather than leaving it as an illustrative "e.g."; made
  the root-manager-id precompute at page load mandatory rather than optional
  (AR-1.1) — closes a correctness gap (five existing tests would otherwise
  silently break) and a performance gap (a literal reading of the original
  wording would triple `buildTree` calls per refresh).
- Renamed the isolation flag from `isolateUnselectedRoots` (which read as
  the opposite of what it does) to `requireRootSelection`.
- Restated FR-1.1's visibility rule as a traversal-seed rule rather than a
  per-node predicate, removing an ambiguity that happened to resolve
  correctly only because of an incidental property of the current code.
- Rewrote FR-1.2's Verify fixture, which previously held isolation mode
  *off* while a Risk note claimed it proved the *on* case — it now actually
  exercises isolation-on with a nested manager unchecked, and shows the
  isolation-off/isolation-on contrast explicitly.
- Added a full literal example of `positionRegionBreakdown`'s return shape
  (AR-3.1), and an explicit precondition excluding external-manager entries
  (whose `position` is `null`) before it's ever called.
- Fixed `compRatio`'s exact payload insertion point (between `bonus` and
  `ratings`) and named both `employee-details.html` arrays (`COLUMNS`,
  `renderRow`'s `values`) that must move together (FR-2.3, FR-2.4).
- Specified the new pivot table's column headers, band-header-row markup,
  and totals-row label (FR-3.4), and added a new AR-3.4 for dedicated header
  CSS that does not reuse the `.card.*` classes (which carry card-specific
  box-model styling unsuited to a `<th>`).
- Decided and stated explicitly that a present, non-numeric
  `Base Pay Compa Ratio` cell rejects the import, matching the existing
  `Direct Supervisor Name` type-check precedent, rather than leaving this
  case — which the reference file cannot exercise — to accident (FR-2.1).
- Added missing Verify coverage: FR-1.1's common single-manager-unchecked
  case (30 visible); the salary-present/comp-ratio-absent mixed state
  through FR-2.2/FR-2.3/FR-2.4; FR-3.3's all-bands-empty rendering state.
- Corrected the Testing Strategy checklist item to state plainly which
  existing tests require editing (five `visibleRows` call sites, one
  eight-key payload assertion) rather than describing all of them as
  "extended."
- Qualified every previously-bare cross-spec `FR-x.y`/`AR-x.y` reference
  that collided with this spec's own numbering (spec 002 FR-1.5; spec 003
  FR-2.1, AR-1.2, AR-2.3; spec 004 FR-2.5, FR-3.2, FR-3.3).
- Added spec 005's AR-2.4 and FR-2.6 to the Related Specs row's Affected
  Requirements — this spec's AR-1.1 additively changes `visibleIds`, which
  AR-2.4 previously said would never change, and Feature 3 reuses FR-2.6's
  `isExternal` filter at the same call site it rewrites.
- Corrected the AR-2.1 migration citation to match how `connection.ts`
  itself cites the pattern (its AR-2.1/ADR-001 pairing), and fixed two
  Out-of-Scope column names to their exact headers (`Base Pay Range (1
  FTE)`, `Total Target Cash Range (1 FTE)`).
- Corrected the Performance checklist's complexity claims
  (`positionRegionBreakdown` is `O(n + p log p)`, not a single pass) and the
  Scope checklist's Out-of-Scope count (9, not 8).
- Named the specific, previously-unstated Software-Engineer-vs-generic
  asymmetry in the band rules (FR-3.1), the Lead-rule's match-priority-vs-
  display-order distinction, and the fact that a bare, un-numeraled
  "Senior" title falls to `Other` — the single most likely real-world title
  shape to be missed, previously understated in the Risk note.
- Added an `Initiative Context: None` section, matching spec 005's
  precedent for a repository with no Cyclops workspace.
- Added two security notes: a compa ratio is more directly cross-comparable
  than raw salary (a widening, not a strictly equivalent exposure), and the
  new pivot table's `position` strings must reach the DOM through
  `textContent`, matching spec 003 AR-1.4.
- Added one sentence acknowledging the raw-ratio-vs-percentage display
  divergence from WorkDay's own cell formatting (Out of Scope), so a
  reviewer comparing screens against the source file doesn't mistake it for
  a defect.

**Rejected:**

- Deriving level bands from WorkDay's `Management Level` column instead of
  token rules — the answered clarifying question that shaped this spec
  already declined the new-import-work option in favor of pattern-matching.
- Adding an un-numbered "Senior" fallback tier to catch a bare
  `Senior Software Engineer` — out-of-scope creep beyond the seven bands the
  user named; documented as a known risk instead of silently expanding
  scope.
- Providing the multi-level test fixtures as literal code inside the spec —
  rejected per this project's established WHAT-not-HOW convention (spec
  004's own critique history rejected the identical class of request); the
  fixtures are instead fully described in prose (ids, relationships,
  checkbox states, expected visible sets).
- Pinning an exact `RegExp` literal for tokenization, or deepening it for
  Unicode/locale edge cases — described precisely enough in prose (split on
  non-alphanumeric runs, lowercase, drop empty pieces) without a literal
  regex object, consistent with how this project's other specs describe
  string-matching rules (e.g. spec 003 AR-1.2's country-bucket mapping)
  without one.
- A dedicated empty-state message for the all-bands-empty pivot table — the
  zeroed totals row already communicates the state, and a redundant message
  would sit awkwardly against FR-2.6's existing "removed, not shown as
  zero" philosophy, which this state is a natural extension of.

**Reorganized:**

- The FR-1.2 Risk note that previously claimed the A→B→C fixture "proves
  the root-manager-vs-nested-manager distinction" is removed — the fixture
  itself was rewritten to actually do so, so the caveat no longer applies.
