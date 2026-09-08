# Spec 005: Headcount Dashboard Manager Context

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-08-31.
> Implementation summary: `specs/features/005-headcount-manager-context/implementation-summary.md`
> Implementation review: `specs/features/005-headcount-manager-context/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

The Headcount Dashboard (spec 003) shows an org-chart tree built from the imported WorkDay data, but it currently gives no sense of team scale and breaks visibly at the top of the org: any manager whose own record was never exported (most notably the person who ran the report, e.g. Frank Borg) simply disappears, and their direct reports render as several disconnected root cards instead of one team. This spec adds a team-size indicator to every manager's card, restores a placeholder card for managers who exist only as an unresolved reference, and reorders each team's cards so managers are grouped ahead of individual contributors.

## Goals

- Show each manager's total (not just direct) team size on their card.
- Represent a manager who has no employee row of their own (an "external manager", e.g. Frank Borg) as a named card on the dashboard, so their reports nest under a real node instead of appearing as disconnected roots.
- Order cards within each team, and among root-level cards, with managers before non-managers.

## Initiative Context

None — this repository has no Cyclops initiative workspace (`specs/cyclops/` / `.cyclops/` do not exist).

---

## Feature 1: Team size on manager cards

**Who & why:** Anyone reading the Headcount Dashboard today has to manually count nested cards to know how big a manager's org is. Managers and their peers need to see team scale at a glance, without opening Employee Details or counting boxes, especially for managers with deep, multi-level teams where direct-report count alone understates the real size.

### Functional Requirements

#### FR-1.1: Team size badge on manager cards

Every card for an employee who has at least one active direct report (i.e. an existing manager, per `chart-logic.js`'s `managerList` definition) displays `[TeamSize: X]` next to their name, where `X` is the count of **all** active employees below them in the tree at any depth (direct and indirect reports combined). `X` reflects the roster as returned by the single `GET /api/headcount` call that populated the page — like every other figure on this screen, it does not update live if the underlying data changes without a page reload, and it always uses the full roster, never the checkbox-filtered "visible" subset.
**Verify:** for a manager with 2 direct reports, one of whom has 3 direct reports of their own, the manager's card shows `[TeamSize: 5]`.

#### FR-1.2: No badge for individual contributors

A card for an employee with no active direct reports shows no `TeamSize` text at all.
**Verify:** an IC's rendered card contains a name, position, and country line, and no `TeamSize` text.

#### FR-1.3: Inactive employees excluded from the count

`X` counts only active employees (the same active-only set `getAllEmployees()` already returns to `/api/headcount` — inactivated employees are never included in the payload in the first place, so no separate filtering is needed).
**Verify:** re-running the count after an employee is soft-inactivated and re-imported no longer includes them in any ancestor's `TeamSize`.

### Architectural Requirements

#### AR-1.1: Computed as part of the existing tree build

`public/chart-logic.js`'s `buildTree(employees)` gains a fourth return field, `teamSizes: Map<id, number>`, computed with one additional bottom-up (post-order) pass over the `childrenOf` map it already builds — one pass, O(n), independent of and in addition to the existing O(n log n) sibling-sorting cost `buildTree` already has today. No new API call or server-side query is introduced: `/api/headcount` already returns the full active roster in one payload, so the count is derivable entirely from data the client already has. `teamSizes` is not a separately-exported function with its own parameter contract — callers that need it call `buildTree` once, exactly as they call it today for `roots`/`childrenOf`/`byId`, and read the fourth field.

#### AR-1.2: Rendering stays in `headcount.html`

`renderCard` in `public/headcount.html` gains the `[TeamSize: X]` line only when `teamSizes` has an entry for that employee's id, following the existing pattern of building elements via `element(...)` and appending `textContent` only (AR-1.4 of spec 003 — no `innerHTML`).

---

## Feature 2: External manager placeholder cards

**Who & why:** When a WorkDay export scopes to one manager's organization, that manager's own row is never in the file — only their `Direct Supervisor ID` appears on their reports' rows, and it doesn't resolve to anyone in the database. Today, `buildTree`'s `isRoot` (public/chart-logic.js:63-65) treats every one of those reports as an independent root, so a manager who actually has, say, 11 reports shows up on the dashboard as 11 unrelated top-level cards with no card, name, or grouping tying them together. The person running the report (e.g. Frank Borg) needs to see their own name and team represented, even though they were never a row in the spreadsheet.

**Design note (why a new `external_manager_id` column, not a bare side table):** `employees.manager_id` has an `ON DELETE RESTRICT` foreign key to `employees(id)` (`src/db/schema.ts`), and `src/import/reconcile.ts:62` already sets it to `null` whenever a supervisor id doesn't resolve — it can never legally hold an id that only exists in a new `external_managers` table. This feature therefore adds a **second, separate** nullable column on `employees`, `external_manager_id`, with its own foreign key to the new `external_managers` table. `manager_id` continues to behave exactly as it does today (untouched, still null for an unresolved reference); `external_manager_id` carries the additional link when a name was recoverable. The two are unified into the single `managerId` field the client already understands only at the `/api/headcount` read boundary (FR-2.6), so `manager_id`'s existing FK constraint is never at risk of violation and `buildTree`/`isRoot`/`visibleIds` need no logic changes (AR-2.6).

### Functional Requirements

#### FR-2.1: Capture the external manager's name at import, as an optional column

`src/import/parseWorkbook.ts` treats `Direct Supervisor Name` as an optional column, detected the same way headers are already discovered (the `headerToColumn` map built from row 1): if the column is present, its value for each data row is read with the same `isBlankCell` / `requireNonBlankString` pattern already used for `Direct Supervisor ID` (blank or whitespace-only → `null`, otherwise the trimmed string) and mapped onto `ImportRow.supervisorName: string | null` (a new field added to `src/import/types.ts`). If the column is absent, `supervisorName` is `null` for every row and the import proceeds exactly as it does today — the column is not added to `REQUIRED_HEADERS`. If the column appears more than once, the import is rejected with the same "Column header(s) appear more than once" error `parseWorkbook.ts` already raises for a duplicated *required* header (the duplicate-header check is generalized to cover this one optional header as well as `REQUIRED_HEADERS`).
**Verify:** mapping a row with `Direct Supervisor ID = 00000270149` and `Direct Supervisor Name = Frank Borg` produces `{ supervisorId: "00000270149", supervisorName: "Frank Borg" }`; mapping the same file with the column removed produces `supervisorName: null` for every row without rejecting the import; a file with two `Direct Supervisor Name` columns is rejected before any row is mapped.

#### FR-2.2: Aggregate a name per unresolved supervisor id before writing anything

Reconciliation (`src/import/reconcile.ts`) resolves external manager names in a dedicated pass that runs **before** the existing manager-reassignment loop (FR-2.2 of spec 002): for every row in the batch whose `supervisorId` does not resolve via `getEmployeeById` and whose `supervisorName` is non-null, group by `supervisorId` and pick the name that occurs most often for that id among that group; a tie is broken by keeping the value that sorts first via case-sensitive `localeCompare` on the full trimmed string. Exactly one `external_managers` row is then written per distinct unresolved id that has a winning name — never one write per row.
**Verify:** importing the reference file's 11 rows referencing `00000270149` / `Frank Borg` results in exactly one stored external manager record for id `00000270149` with name `Frank Borg`; two rows sharing an unresolved id, one with `supervisorName = "F. Borg"` and one with `supervisorName = "Frank Borg"` occurring equally often, resolve deterministically to `"F. Borg"` (it sorts first).

#### FR-2.3: Link each report to its external manager, without touching `manager_id`

In the existing per-row manager-reassignment loop, for a row whose `supervisorId` does not resolve to a real employee: `manager_id` is reassigned to `null` exactly as today (spec 002 FR-2.2, unchanged), and in addition the employee's `external_manager_id` is set to `supervisorId` **only if** that id received a winning name in FR-2.2's pass (i.e. now has an `external_managers` row); otherwise `external_manager_id` is set to `null`, matching today's plain-root behavior exactly. For a row whose `supervisorId` resolves to a real employee (active or, per FR-2.2 of spec 002, previously-inactive-but-existing), `external_manager_id` is set to `null` regardless of any past external link — a manager who was external in one import and is imported as a real employee in a later one has their reports' external links cleared and `manager_id` reassigned normally on that later import.
**Verify:** re-importing a file where the previously-unresolved supervisor id now has a matching real employee row clears `external_manager_id` for all of that manager's reports and sets `manager_id` to the real employee's id instead.

#### FR-2.4: External managers appear in the Headcount Dashboard payload

`GET /api/headcount` includes one entry per `external_managers` row that is currently referenced by at least one active employee's `external_manager_id` column (determined by reading the persisted column directly, not by re-deriving it from import-time state), alongside the real employee entries in the same `employees` array. Each real employee entry's `managerId` in the response is the employee's `manager_id` if non-null, otherwise their `external_manager_id` (which is itself `null` if neither applies) — a single effective-parent value, so the response shape gains no new "which kind of link is this" field on employee entries. Each real employee entry also gains `isExternal: false`; each external manager entry is `{ id, name, managerId: null, position: null, country: null, isExternal: true }`. Real employee entries keep today's `id ASC` order and position in the array; external manager entries are appended after them, ordered by `id ASC`. As a defensive guard against an id coinciding with a real active employee's id (which reconciliation's FR-2.3 self-healing should already prevent in steady state), the route skips emitting an external-manager entry whose id matches any real employee entry already in the array.
**Verify:** after importing the reference file, the `/api/headcount` response contains, after all real employee entries, `{ id: "00000270149", name: "Frank Borg", managerId: null, position: null, country: null, isExternal: true }`.

#### FR-2.5: External managers render as a named card with nested reports

On the Headcount Dashboard, an external manager entry renders as a root-level card. `renderCard` omits the position and country lines entirely for it (rather than rendering them empty), shows the name with a fixed visible label immediately after it, `(not in imported data)`, and applies a distinct CSS class (`card external`, alongside the existing `card blue/red/green`) with its own fixed background/border style — the text label, not the styling, is what makes the state accessible to a screen reader, per FR-1.7's existing "meaning must be conveyed as text" rule. Their reports nest underneath exactly as any other manager's team, including the `[TeamSize: X]` badge from Feature 1. `managerList()` (spec 003 FR-2.3) is unmodified and, because an external manager entry has at least one child once it is present in the `employees` array, automatically includes it in the "Show teams" checkbox filter, labeled by name like any other manager — this is the intended, emergent behavior of Feature 2, not a change to `managerList()` itself.
**Verify:** importing the reference file produces one `card external`-styled card showing "Frank Borg (not in imported data)" whose nested team contains the 11 employees who reference that id, whose own card shows `[TeamSize: 11]`, and which appears as a checkbox option in "Show teams".

#### FR-2.6: External managers excluded from headcount totals

`headcount.html` filters `isExternal: true` entries out of the array it passes to `totals()` before rendering "Total headcount" and the position breakdown; `totals()` itself (`chart-logic.js`) is unchanged. An external manager card is visible on the tree but is not counted as headcount and contributes no row to the position breakdown, since they were never part of the imported roster.
**Verify:** total headcount after import matches the real row count from the spreadsheet and does not increase when an external manager card is added.

### Architectural Requirements

#### AR-2.1: New `external_managers` table and a new `employees` column

`src/db/schema.ts` gains `external_managers (id TEXT PRIMARY KEY, name TEXT NOT NULL)`, and `employees` gains a new nullable column `external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL`. `src/db/types.ts`'s `Employee` interface gains `externalManagerId: string | null`; `src/db/queries.ts`'s `toEmployee` row mapper is updated to include it.

#### AR-2.2: Reconciliation writes inside the existing transaction, in FK-safe order

The new aggregation pass (FR-2.2) and per-row link (FR-2.3) both run inside `doReconcile`'s existing transaction (AR-5.1's commit-or-rollback boundary, unchanged). The aggregation pass's `external_managers` upserts run before the per-row loop that sets `external_manager_id`, so a referenced parent row always exists by the time a child row references it — required because `PRAGMA foreign_keys = ON` is already active on this connection (`src/db/connection.ts`). A new mutation, e.g. `upsertExternalManager(id, name)`, performs an insert-or-replace of the name (fully replacing, not merging, so a stale name from an earlier import cannot outlive an updated one); a new mutation, e.g. `setExternalManager(employeeId, externalManagerId)`, is the only function that may write `external_manager_id`, mirroring `reassignManager`'s existing role for `manager_id`.

#### AR-2.3: New query and route wiring

`src/db/queries.ts` gains a read function (e.g. `getAllExternalManagers()`, returning every stored `{ id, name }`, since the table is bounded by the number of distinct external ids ever seen across all imports and is never large enough to need a filtered query), re-exported from `src/db/index.ts` alongside the existing `getAllEmployees`/`getDescendants`, following that module's existing naming and export conventions. `src/server/app.ts`'s `/api/headcount` handler (lines 91-113) computes the set of `externalManagerId` values present among the already-fetched active employees, filters `getAllExternalManagers()` to that set in application code (no dynamic SQL `IN` clause, no new injection surface), and merges the two into one `employees` array per FR-2.4, preserving the handler's existing try/catch and generic 500 error behavior (AR-3.4 of spec 003).

#### AR-2.4: No changes to `buildTree`/`isRoot`/`visibleIds`/`managerList`

Because an external manager entry has `managerId: null` like any other root and a real `id` that its reports' effective `managerId` (FR-2.4) already points to, `public/chart-logic.js`'s existing `buildTree`, `isRoot`, `managerList`, and `visibleIds` functions require no logic changes beyond AR-1.1's `teamSizes` addition — the external manager simply becomes a normal root node once it is present in the `employees` array the client already builds its tree from. Only `renderCard` (FR-2.5) needs a branch for the missing position/country, the visible label, and the `card external` class, and `headcount.html`'s totals-rendering call site needs the `isExternal` filter from FR-2.6.

---

## Feature 3: Managers-first ordering on the Headcount Dashboard

**Who & why:** Within a team, or among root-level cards, siblings currently sort purely alphabetically (`byNameThenId` in `chart-logic.js`), interleaving managers and individual contributors. Scanning a large team for its sub-managers means reading every card. Grouping managers first lets a reader find the structure of a team before its individual members.

### Functional Requirements

#### FR-3.1: Managers sort before non-managers at every level

On the Headcount Dashboard tree only, at the root level and within every manager's team, cards for employees who themselves have at least one active direct report (including external manager entries from Feature 2, which per FR-2.4 only ever appear in the payload when they have at least one active report) are ordered before cards for employees with none. Within each of those two groups, the existing alphabetical-by-name, then-id-tie-break order (`byNameThenId`) is unchanged.
**Verify:** a team of 5 people where 2 have their own direct reports renders those 2 first (in existing alphabetical order relative to each other), followed by the other 3 (also in existing alphabetical order).

#### FR-3.2: Scope limited to the Headcount Dashboard tree's sort order

Only the sibling order within `renderChart`'s tree (`buildTree`'s `roots` and each `childrenOf` list) changes. The "Show teams" checkbox filter list (`managerList()`, spec 003 FR-2.3) keeps its own existing alphabetical order and mechanism unchanged — it independently and correctly gains the external manager entry as one of its options once Feature 2 ships (FR-2.5), which is a change to the filter's *content*, not its *ordering rule*. The Employee Details table (spec 004) is entirely unaffected by this spec.
**Verify:** the checkbox filter list's ordering and the Employee Details table's default order are unchanged before and after this feature is implemented.

### Architectural Requirements

#### AR-3.1: New comparator, existing comparator untouched

`buildTree` in `public/chart-logic.js` (lines 40-60) takes a manager-aware comparator for its two `.sort(byNameThenId)` call sites (root siblings and each team's children), e.g. `byManagerThenNameThenId(childrenOf)`, which checks `childrenOf.get(employee.id).length > 0` before falling back to the existing `byNameThenId` ordering. `byNameThenId` itself is not changed and continues to be used unmodified by `managerList()` (FR-3.2), so the checkbox filter's order is unaffected by this feature.

---

## Data Requirements

- New table `external_managers(id TEXT PRIMARY KEY, name TEXT NOT NULL)` in `src/db/schema.ts` (AR-2.1).
- New column `employees.external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL` (AR-2.1); `manager_id` and its existing `ON DELETE RESTRICT` FK are untouched.
- `Employee` (`src/db/types.ts`) gains `externalManagerId: string | null` (AR-2.1).
- `ImportRow` (`src/import/types.ts`) gains `supervisorName: string | null` (FR-2.1).
- `GET /api/headcount` response: every entry gains `isExternal: boolean`; an entry with `isExternal: true` has `position: null` and `country: null` and `managerId: null`; an entry with `isExternal: false` has its usual non-null `position`/`country` and a `managerId` that is the effective parent id described in FR-2.4.

## Integration Points

- `src/import/parseWorkbook.ts`, `src/import/types.ts` — optional-column detection and mapping (FR-2.1).
- `src/import/reconcile.ts` — new aggregation pass and per-row external link (FR-2.2, FR-2.3).
- `src/db/schema.ts`, `src/db/types.ts`, `src/db/queries.ts`, `src/db/mutations.ts`, `src/db/index.ts` — new table, column, mutations, and query (AR-2.1-AR-2.3).
- `src/server/app.ts` (`/api/headcount`) — merged payload (FR-2.4, AR-2.3).
- `public/chart-logic.js` — `teamSizes` as a fourth `buildTree` field (Feature 1), manager-aware comparator (Feature 3); `isRoot`/`visibleIds`/`managerList` reused unchanged (AR-2.4).
- `public/headcount.html` — `renderCard` gains the `TeamSize` line and the external-manager rendering branch; the totals call site gains the `isExternal` filter (FR-2.6).

## Related Specs

| Spec | Relationship | Affected Requirements |
| ---- | ------------- | ---------------------- |
| Spec 003: Headcount Dashboard | **Modifies** — adds team-size badges, external-manager cards, and manager-first ordering to the existing tree, filter, and totals logic | FR-1.2, FR-1.3, FR-1.4, FR-1.7, FR-2.1, FR-2.3, FR-2.6, AR-1.4, AR-1.5, AR-2.3, AR-3.4 |
| Spec 002: WorkDay Import | **Modifies** — mapping and reconciliation capture and persist an external manager's name for previously-discarded unresolved supervisor references | FR-1.1, FR-1.2, FR-2.2 |
| Spec 001: Data Foundation | **Extends** — adds a new `external_managers` table and a new `employees.external_manager_id` column alongside the existing schema | Schema requirements in spec 001 |
| Spec 004: Employee Details | **References** — reuses `visibleIds`/`buildTree` from `chart-logic.js` unchanged; its own manager filter and table ordering are explicitly out of scope for this spec (FR-3.2) | None |

## Constraints

- No new API call is introduced for team size; it is derived entirely from the existing `/api/headcount` payload (AR-1.1).
- The `Direct Supervisor Name` column is treated as optional input, not added to `REQUIRED_HEADERS` — a file that lacks it must continue to import exactly as it does today (FR-2.1).
- `manager_id` and its `ON DELETE RESTRICT` foreign key are never written to for an unresolved reference — that behavior is unchanged from spec 002. Only the new `external_manager_id` column carries the additional link (design note under Feature 2).
- An `external_managers` row whose id stops being referenced by any active employee (because that manager's reports all leave, or because the manager is later imported as a real employee, per FR-2.3) is left in the table rather than deleted; it simply stops appearing in `/api/headcount` (FR-2.4). The table is bounded by the number of distinct external ids ever seen, which is expected to remain small, so this is treated as harmless, not a bug to fix here.

## Out of Scope

- Capturing supervisor names beyond the immediate ("Direct Supervisor") level — e.g. the file's "3rd/4th/5th/6th Level Leader Name" columns are not read or persisted by this spec.
- An employee whose supervisor reference resolves to a real employee who is currently *inactive* (soft-inactivated, still present in the `employees` table). `getEmployeeById` resolves inactive employees too, so `manager_id` is set to that real id and no external-manager link is created — but `/api/headcount`'s active-only projection still excludes the inactive manager themselves, so their reports still render as disconnected roots today. This is a pre-existing gap distinct from the "never-imported" case this spec fixes, and this spec does not address it.
- Any change to the Employee Details screen (spec 004): its manager filter, table, and default sort order are unaffected, and an employee whose manager is an unresolved external reference still shows no manager name there, exactly as today.
- Any change to the "Show teams" checkbox filter's own sort order (spec 003 FR-2.3) — it remains alphabetical; only its content gains the external manager option (FR-2.5).
- Export, print, CSV/XLSX generation, or any output artifact — there is no report-generation feature in this codebase, and this spec does not add one. All three features are on-screen changes to the existing Headcount Dashboard.
- Reconstructing an external manager's position, country, or any other attribute — only their name is captured and shown.
- Retroactively backfilling `external_managers`/`external_manager_id` from data already in the database before this feature ships; the new columns/table populate only from imports that happen after this spec is implemented (a re-import of the current file will populate them going forward).
- Deleting or garbage-collecting stale, unreferenced `external_managers` rows (Constraints).

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — each FR has a concrete Verify line; Out of Scope enumerates eight explicit exclusions.
- [x] **Testing strategy** — `test/import/parseWorkbook.test.ts` (FR-2.1's optional-column detection and duplicate-header rejection), `test/import/reconcile.test.ts` (FR-2.2's aggregation-before-write ordering and tie-break, FR-2.3's link/clear behavior), `test/server/headcount.test.ts` (FR-2.4's payload shape, ordering, and collision guard), `test/dashboard/chartLogic.test.ts` (FR-1.1's `teamSizes`, FR-3.1's comparator) — one file per touched module, following this project's existing one-file-per-area convention.
- [x] **Existing patterns** — every FR/AR is anchored to a specific existing file, function, and line range; the design note under Feature 2 explains why a second column, not a bare side table, was chosen given the existing FK constraint on `manager_id`.
- [x] **Dependencies** — no new libraries; reuses `better-sqlite3`, `exceljs` parsing already in place.
- [x] **Architecture & interfaces** — AR-2.1-AR-2.4 fully specify the schema, mutation, query, and route changes, including FK write ordering (AR-2.2) and the application-side (not SQL `IN`) filtering approach (AR-2.3); AR-1.1-AR-1.2 specify `teamSizes`' exact signature (a `buildTree` return field, not a separate function) and rendering split.
- [x] **Error handling & failure modes** — FR-2.1 defines optional-column graceful degradation, whitespace-only-name handling, and duplicate-optional-header rejection; FR-2.2 defines a fully deterministic tie-break; FR-2.3 defines both the unresolved-without-name case (unchanged from today) and the later-becomes-real-employee case (self-healing).
- [x] **Security review** — no new input surface beyond an existing optional spreadsheet column already covered by spec 002's upload validation (`RowValidationError` on non-string cells, same as every other text field); no authentication exists anywhere in this app by design (spec 001/`ARCHITECTURE.md`), and this feature adds one more employee-derived name string to the same already-unauthenticated, read-only `/api/headcount` endpoint — no new trust boundary is crossed. All new employee-derived text (the external manager's name) reaches the DOM through `textContent` only, per the existing `AR-1.4` rule, extended explicitly to this new field. All new queries use parameter binding via `better-sqlite3` prepared statements or in-memory JS filtering (AR-2.3) — no string-concatenated SQL is introduced.
- [x] **Performance impact** — `teamSizes` is an O(n) pass, independent of `buildTree`'s existing O(n log n) sort; the `external_managers` table lookup is one additional query against a table bounded by the number of distinct external ids ever seen (expected to stay well under the 5000-row `MAX_DATA_ROWS` cap), filtered in application code rather than via a dynamic SQL clause.
- [x] **Rollout & migration** — `src/db/connection.ts:82` runs `db.exec(SCHEMA_SQL)` on every connection open, and `SCHEMA_SQL` uses `CREATE TABLE IF NOT EXISTS`; `ALTER TABLE employees ADD COLUMN external_manager_id ...` (also idempotent-safe if guarded, e.g. checked against `PRAGMA table_info` before running, or wrapped so a second run is a no-op) needs to run alongside the existing schema application so an existing `data/employees.sqlite` gains the column on next `npm start`, with no separate manual migration step. AR-2.2 states the FK-safe write order (parent `external_managers` row before any `external_manager_id` reference) needed given `PRAGMA foreign_keys = ON`.
- [x] **Assumptions & risks** — FR-2.2's tie-break, FR-2.1's optional-column and whitespace handling, FR-2.3's self-healing behavior, and the Out of Scope inactive-manager gap and no-backfill/no-cleanup notes are all stated explicitly as assumptions or known limitations.
