# Spec 008: Headcount Team Breakdown and Performance Filters

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-09-04.
> Implementation summary: `specs/features/008-headcount-team-and-performance-filters/implementation-summary.md`
> Implementation review: `specs/features/008-headcount-team-and-performance-filters/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

Add a concise, filter-aware Team breakdown to Headcount so a manager can see
the visible workforce by actual location, role, and count. Extend Employee
Details with two linked checkbox filters: one for the four requested
performance outcomes and one for the rating periods in which those outcomes
must match, while allowing a recent joiner to have no historic rating.

## Goals

- Make Headcount show an unambiguous location-and-role count for the teams
  currently selected in the org chart.
- Let Employee Details identify workers with selected performance outcomes in
  selected review periods without excluding recent joiners solely because an
  older review has not occurred.
- Preserve the existing position and manager filters, sortable table,
  endpoint contracts, and client-side/no-build architecture.

---

## Feature 1: Filter-Aware Team Breakdown on Headcount

**Who & why:** A manager looking at the Headcount page needs a compact answer
to “where are the people in this team and what roles do they hold?” The
current position-by-region matrix groups locations into colour buckets and
does not give a direct `Location | Role | Count` view.

### Functional Requirements

#### FR-1.1: Show a Team breakdown table by location and role

The Headcount page adds a `Team breakdown` table below its existing
position-by-region matrix. The new table contains one data row
per distinct `(location, role)` pair among currently visible **real workers**:

- **Location** is the exact `country` value received from `/api/headcount`.
- **Role** is the exact `position` value received from `/api/headcount`.
- **Count** is the number of visible workers with that exact pair.

External-manager placeholders are excluded: they have neither a location nor
a role and never count as people in the existing headline. Contractors are
included, using their stored country and position, exactly as they are in the
headline total. No new API endpoint or database field is needed.

The table's title, column labels, and row values must be visible text, not
colour-only information. All server-derived strings must continue to reach
the DOM through `textContent`/the existing `element()` helper.

**Verify:** Given visible workers `Ana (United Kingdom, Engineer)`, `Ben
(United Kingdom, Engineer)`, `Chen (India, Engineer)`, and `Dee (India,
Designer)`, plus any external-manager placeholder, the table has these three
data rows: `India | Designer | 1`, `India | Engineer | 1`, and `United
Kingdom | Engineer | 2`. The headline reads `Total people: 4`; the placeholder
appears only in the chart, not in the headline or table.

#### FR-1.2: Recompute the breakdown from the manager-filter visible set

The existing manager checkboxes continue to control the org chart. On every
manager-filter refresh, the headline and Team breakdown are recalculated from
the same visible, non-external worker list. An unchecked manager's excluded
subtree must disappear from both the chart and this breakdown; the manager's
own row remains governed by the Headcount page's existing visibility rule.

When there are visible real workers, the sum of all Count cells equals `Total
people`. If a valid non-empty payload currently has no visible real workers
(for example, only an external root remains after filters), render a table
header and a final `Total | | 0` row rather than stale rows or a second empty
state message.

**Verify:** In an A→B→C hierarchy with A and B managers, deselecting A hides
B and C but leaves A visible. The Team breakdown then contains only A's
location/role row with count 1, and the count sum and headline are both 1.

#### FR-1.3: Ordering and totals are deterministic

Data rows sort by Location ascending using `localeCompare`, then Role
ascending using `localeCompare`. Append one final totals row labelled `Total`
in the Location column, an em dash in the Role column, and the sum in Count.
The totals row is not included in the data-row ordering.

**Verify:** The four-worker fixture in FR-1.1 renders the India rows first,
with Designer before Engineer, then United Kingdom/Engineer; its final row is
`Total | — | 4`.

### ASCII Design

```
Headcount Dashboard

Total people: 42

Team breakdown
+----------------+--------------------------+-------+
| Location       | Role                     | Count |
+----------------+--------------------------+-------+
| India          | Software Engineer II     |     8 |
| India          | Senior Software Engineer |     3 |
| United Kingdom | Software Engineer II     |    19 |
| United States  | Principal Engineer       |     2 |
+----------------+--------------------------+-------+
| Total          | —                        |    42 |
+----------------+--------------------------+-------+

[ Show teams: ☑ Manager A  ☑ Manager B ... ]

[ existing organisation chart ]
```

### Architectural Requirements

#### AR-1.1: Keep aggregation pure and separate from rendering

`public/chart-logic.js` gains a DOM-independent export, for example
`locationRoleBreakdown(visibleEmployees)`, returning an ordered array of
`{ location, role, count }` rows plus a `total` number. Its input has already
been filtered to real workers by `headcount.html`; the function must not
silently classify or manufacture values for external placeholders.

`public/headcount.html`'s existing `renderTotals()` remains thin wiring over
both the existing `positionRegionBreakdown()` export and the new aggregation:
it renders the headline, existing matrix, Team breakdown, and final total
row. The new table must be driven by the exact same visible real-worker list
as those two existing derived views.

#### AR-1.2: Preserve shared Headcount visibility behavior

This feature must not alter `buildTree`, `managerList`, `visibleIds`, the
manager-checkbox labels, the org chart, or the three existing Headcount
messages. The Team breakdown is a report of the existing visible set, not an
independent filter.

---

## Feature 2: Performance Outcome and Rating-Recency Filters

**Who & why:** A manager reviewing Employee Details needs to find people with
specific performance outcomes, while distinguishing the most recent review
from earlier periods. A recent joiner should still appear when their most
recent rating matches even though historical ratings do not yet exist.

### Functional Requirements

#### FR-2.1: Render the two new all-selected checklists

Employee Details adds these fieldsets alongside the existing Position and
Manager filters:

1. **Filter by performance rating**, with exactly these four checkbox labels,
   all selected initially: `Outstanding Performance`, `Very Strong
   Performance`, `Successful Performance`, and `Performance Requires
   Improvement`.
2. **Filter by rating recency**, with exactly these three checkbox labels,
   all selected initially: `Most Recent`, `Prior Rating`, and `Two Year
   Prior Rating`.

Each checkbox represents its displayed canonical category. Checkbox ids use
fixed, DOM-safe identifiers (not an untrusted rating string), and labels
remain clickable through their matching `for` attributes, following the
existing `renderCheckbox()` pattern. The lists remain present even if no
employee currently has one of the four outcomes, so users can set up their
selection before a later import.

**Verify:** On a successful non-empty load, both fieldsets appear with the
exact legends and labels above, all seven boxes checked. Clicking a label
toggles its associated checkbox and refreshes the table.

#### FR-2.2: Selected ratings and selected recencies combine as matched periods

The new filters are evaluated after the existing position and manager
visibility checks. Within either checklist, checked entries are alternatives
(OR). Across the two checklists, the filters combine as AND:

- A checked recency is a period to inspect.
- A non-null rating in an inspected period must map to one of the checked
  canonical performance categories (AR-2.1), or that employee is excluded.
- A null rating in an inspected **historic** period (`Prior Rating` or `Two
  Year Prior Rating`) is allowed; it represents a recent joiner with no
  rating for that period and does not by itself exclude the employee.
- To prevent missing data from producing a match on its own, at least one
  inspected period must have a non-null rating equal to a checked
  performance-rating value.

The most-recent period is the current performance evidence. If `Most Recent`
is checked, a null most-recent rating does not supply the required matching
period; the employee therefore appears only if another selected period has a
matching value and no populated selected period has a non-matching value.

**Verify:** With `Outstanding Performance` selected and all three recencies
selected: (a) an employee rated Outstanding most recently with both historic
ratings null is included; (b) an employee rated Outstanding most recently
but `Successful Performance` in Prior Rating is excluded; (c) an employee
whose selected ratings are all null is excluded; and (d) an employee rated
Successful most recently is excluded. With Outstanding and Successful both
selected, either canonical category satisfies a populated selected period.
Separately, a legacy `Meets Expectations` value maps to `Successful
Performance` and therefore matches that selected checkbox, while the raw
table cell still reads `Meets Expectations`.

#### FR-2.3: Deselected categories do not constrain results

When a performance-rating checklist has no checked values, no employee can
match the performance filter, so the existing `No employees match the current
filters.` message appears. When the recency checklist has no checked periods,
the performance filter is inactive: it imposes no restriction and the table
is determined solely by the existing position and manager filters. This makes
it possible to temporarily disable the rating filter without re-checking all
four rating categories.

**Verify:** With every recency unchecked and at least one position/manager
match, those rows remain visible regardless of ratings. With one or more
recencies selected but every performance rating unchecked, no rows are
visible and the existing no-match message appears.

### Architectural Requirements

#### AR-2.1: Make performance filtering a testable pure-data operation

`public/employeeDetailsLogic.js` gains fixed exports/constants for the four
canonical performance categories and the three `{ key, label }` rating
periods. It also gains a pure `canonicalPerformanceCategory(value)` helper
and a pure helper such as `matchesPerformanceFilters(employee,
selectedRatings, selectedRatingKeys)`. The canonicaliser returns these
categories for the current WorkDay values and backward-compatible aliases:

| Source rating value | Canonical category |
| --- | --- |
| `Outstanding Performance` | `Outstanding Performance` |
| `Very Strong Performance`, `Exceeds`, `Exceeds Expectations` | `Very Strong Performance` |
| `Successful Performance`, `Meets`, `Meets Expectations` | `Successful Performance` |
| `Performance Requires Improvement` | `Performance Requires Improvement` |

Any other non-null string maps to `null` and therefore cannot satisfy a
selected performance category. The helper implements FR-2.2/FR-2.3 and has
no DOM access. `visibleRows` gains two required trailing parameters:

```
visibleRows(
  employees,
  selectedPositions,
  selectedManagerIds,
  rootManagerIds,
  selectedRatings,
  selectedRatingKeys,
)
```

It returns a row only when the existing position/manager condition and the
new performance helper both pass. Every existing unit-test call site must be
updated to supply the default-all-selected performance and recency sets. The
existing fixtures' `Meets Expectations` values map to Successful Performance,
so their existing visibility expectations remain valid.

#### AR-2.2: Keep page wiring declarative and preserve payload validation

`public/employee-details.html` imports the fixed performance-filter metadata
from `employeeDetailsLogic.js`, creates its two `Set` instances once per page
load, renders fieldsets by iterating that metadata, and supplies both sets to
every `visibleRows()` call. This avoids duplicating the labels, object keys,
or matching rules in DOM code.

The existing `/api/employee-details` contract and `isValidPayload()` rating
shape validation remain unchanged. This is a client-only use of the three
already-required nullable rating keys; it does not alter imports, SQLite
schema, server response keys, or rating persistence.

---

## Data Requirements

| Source | Fields | Use |
| --- | --- | --- |
| `GET /api/headcount` | `country`, `position`, `isExternal` | Visible real-worker location/role aggregation |
| `GET /api/employee-details` | `ratings.mostRecent`, `ratings.priorRating`, `ratings.twoYearPriorRating` | Performance-rating and recency matching |

## Integration Points

| Path | Change |
| --- | --- |
| `public/chart-logic.js` | New pure location/role aggregation export; existing position-region helper remains consumed by Headcount. |
| `public/headcount.html` | Render the Team breakdown and total from the existing filtered visible-worker list. |
| `test/dashboard/chartLogic.test.ts` | Unit-test grouping, ordering, zero rows, total, and external-placeholder precondition. |
| `public/employeeDetailsLogic.js` | Add fixed filter metadata, pure performance matcher, and two `visibleRows` parameters. |
| `public/employee-details.html` | Render and maintain the two checklists; pass their state into `visibleRows`. |
| `test/employeeDetails/employeeDetailsLogic.test.ts` | Update existing `visibleRows` calls and add period/rating/null semantics tests. |
| `test/server/headcount.test.ts`, `test/server/employeeDetails.test.ts` | Update served-page assertions if they cover summary/filter markup; endpoint JSON remains unchanged. |
| `specs/docs/domains/headcount-dashboard/index.md`, `specs/docs/domains/employee-details/index.md` | Update living documentation during implementation. |

## Related Specs

| Spec | Relationship | Affected requirements |
| --- | --- | --- |
| [Spec 003: Headcount Dashboard](../003-headcount-dashboard/spec.md) | **Extends** — adds a location/role/count table while reusing visibility and headline-total behavior. | Feature 2, AR-2.2 |
| [Spec 004: Employee Details](../004-employee-details/spec.md) | **Extends** — adds two table filters to its existing position/manager AND filtering. | Feature 2, AR-2.3 |
| [Spec 006: Employee Details & Headcount Refinements](../006-employee-details-and-headcount-refinements/spec.md) | **Extends** — retains its Headcount position-by-region matrix and adds a complementary location/role table; also extends its Employee Details `visibleRows` integration. | Feature 3; AR-1.1 |
| [Spec 007: Contractor Management](../007-contractor-management/spec.md) | **References** — contractors remain real workers included in Headcount counts and use their existing null ratings behavior. | Headcount/Employee Details integration |

## Constraints

- No framework or browser build step; browser modules remain plain ES modules.
- Counts use the raw stored country and position values. There is no location
  bucket, role normalisation, currency conversion, or independent breakdown
  filter.
- Performance filtering uses the closed mapping in AR-2.1. It does not change
  imported or persisted rating text, table display, or the API; it only maps
  known source/legacy values to a filter category in browser logic.
- Existing table sorting runs after all filters and remains unchanged.

## Out of Scope

- A manager-name/team column, drill-down links, CSV export, chart, or
  persistence of the Team breakdown.
- Changing the Headcount org chart, manager-filter semantics, colour legend,
  or endpoint payload.
- Adding rating values beyond the four requested labels or editing historical
  ratings in the application.
- Changing WorkDay import mapping, rating history schema, API shape, or the
  current `—` display for missing ratings.
- Pagination, saved filter selections, and server-side filtering.

## Testing Strategy

- Add pure aggregation tests covering same-role/same-location grouping,
  location-then-role ordering, contractors, zero inputs, and total equality.
- Update Headcount page tests only for changed rendered wording/markup; retain
  all existing endpoint-contract tests.
- Update every existing `visibleRows` unit-test call with default selected
  performance and recency sets, then add cases for OR within each checklist,
  AND across them, a recent joiner with missing historic ratings, populated
  historic mismatch exclusion, all-null exclusion, both empty-set rules, each
  AR-2.1 mapping row, and an unknown value that does not match any category.
- Manually verify the ASCII layout's responsive table remains readable at a
  narrow desktop window; it must retain all three columns without relying on
  colour.

## Assumptions and Risks

- “Team breakdown” is interpreted as a visible-workforce breakdown by the
  requested location, role, and count — not a manager hierarchy report —
  because the request explicitly names those three fields and Headcount
  already supplies the hierarchy separately. It is additive to the existing
  position-by-region matrix because “include” does not authorize removing the
  current report.
- A historic null is treated as unavailable rather than mismatched only for
  the two historic periods. A populated value that does not match the
  selected ratings excludes the row, as requested.
- The reference WorkDay workbook uses the four requested labels directly.
  Legacy/test values are covered by AR-2.1's closed aliases. Unknown future
  values remain visible in the table but do not match a selected rating
  category; add a mapping only through a deliberate future spec update.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — both page changes have concrete
  visible outcomes, deterministic ordering, and worked filter examples.
- [x] **Testing strategy** — pure logic tests cover aggregation, mapping,
  null-period, selection, and empty-set behavior; existing call sites are
  explicitly updated.
- [x] **Existing patterns** — uses the established pure-module/thin-DOM
  split and the existing Headcount visible real-worker set.
- [x] **Dependencies** — no package, API, or schema dependency is added.
- [x] **Architecture & interfaces** — exports, input/output shape, and the
  `visibleRows` signature are defined.
- [x] **Error handling & failure modes** — unknown mappings, no selected
  ratings/periods, historic nulls, and zero breakdown rows are specified.
- [x] **Security review** — no new input surface or endpoint; text remains
  DOM-safe through existing rendering helpers.
- [x] **Performance impact** — all new derivations are linear over the
  visible employee set and run in the existing refresh flow.
- [x] **Rollout & migration** — no persistence change or migration is needed.
- [x] **Assumptions & risks** — the source vocabulary and deliberate legacy
  aliases are explicit and testable.

---

## Change Log

### Update from spec-review.md

**Applied:**

- Added a closed canonical performance-category mapping that preserves raw
  source display values and keeps existing `Meets Expectations` test fixtures
  visible under the default selection.
- Verified that the reference WorkDay workbook already supplies the four
  requested labels directly.
- Added mapping/unknown-value tests and a completeness checklist.

**Rejected:**

- Changing persisted/imported ratings: unnecessary because the existing
  reference report already has the requested vocabulary.

**Reorganized:**

- Integrated the mapping decision into Feature 2's matching and architecture
  requirements rather than adding a separate conversion feature.
