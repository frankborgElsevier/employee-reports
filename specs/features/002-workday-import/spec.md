# Spec 002: WorkDay Import Screen

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-08-31.
> Implementation summary: `specs/features/002-workday-import/implementation-summary.md`
> Implementation review: `specs/features/002-workday-import/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

A local web screen where the user uploads the WorkDay "Team Market Range
Analysis for Managers" `.xlsx` export (a reference copy lives in
`workday_docs_examples/`) and the app parses it, maps its columns onto the
schema from [Spec 001: Data Foundation & SQLite Schema](../001-data-foundation/spec.md),
and reconciles the database with the file's contents — updating employees who
remain, adding new ones, and soft-inactivating anyone no longer present,
without losing salary or rating history for anyone. This spec assumes the
database holds one manager's team at a time (see Constraints); a mechanism
for safely importing multiple teams into the same database is future work.
This is also the first spec to stand up a running app: a startup command, a
web server, and a browser-based UI, since none of that has existed until now.

## Goals

- Turn a WorkDay export file into fully-populated `employees`,
  `salary_history`, and `rating_history` rows, using a fixed, automatic
  column mapping (no manual field-mapping step).
- Make re-running the import safe and idempotent: importing the same file
  twice, or a file with only minor changes, must not duplicate rows or
  destroy history for employees who are still present.
- Fail the entire import, with no partial writes, when the uploaded file is
  malformed or contains invalid data — a bad import must never leave the
  database in a half-updated state.
- Establish the app's first working screen and its web-based UI foundation
  (a local server + browser), since no UI stack existed before this spec.

---

## Feature 1: WorkDay Report Parsing & Field Mapping

**Who & why:** The person running this import is an HR/people-ops user, not
a developer — they should be able to export the report from WorkDay and
upload it as-is, without hand-mapping columns each time. WorkDay always
produces the same column layout for this report, so the mapping can be fixed
and automatic; without one, a spreadsheet row can't become a database record
at all.

### Functional Requirements

#### FR-1.1: Accepted file format and header-based column matching

If the uploaded file cannot be opened as a valid Excel workbook at all (a
corrupted file, or a non-`.xlsx` file that bypassed the browser's
client-side filter), the import is rejected immediately with a clear error,
surfaced through the same on-screen error path as every other rejection in
this feature (FR-4.3) — no header or row processing is attempted. Otherwise,
the importer reads the file's first worksheet, treating row 1 as column
headers, and matches columns by header text — case-sensitive, trimmed of
leading/trailing whitespace — rather than position, so a reordering of
columns between WorkDay exports doesn't break the mapping. The following
headers are required to be present, each exactly once: `Employee ID`,
`Preferred Name`, `Business Title`, `Location Country`,
`Direct Supervisor ID`, `Worker Currency`, `Worker Total Base Pay Amount`,
`Worker Total Target Cash Amount`, `Performance Rating - Most Recent`,
`Performance Rating - Prior Rating`, and
`Performance Rating - Two Year Prior Rating`. The import is rejected before
any row is read if any required header is missing (naming every missing
header) or if any required header's trimmed text appears more than once in
row 1 (an ambiguous mapping). A file with a valid header row but zero data
rows is also rejected, rather than treated as a normal empty import —
FR-2.3 soft-inactivates any active employee absent from the file, so a
truly empty file (an accidental blank export, or one filtered down to
nothing) would otherwise be read as "everyone currently in the database has
left."
**Verify:** Uploading the reference file in `workday_docs_examples/`
successfully matches every required header; uploading a copy of that file
with the `Direct Supervisor ID` column header renamed or deleted is rejected
with an error that names `Direct Supervisor ID`, before any row is
processed; uploading a `.csv` file renamed to `.xlsx` is rejected with a
"could not be opened" error rather than a header-mapping error; uploading a
copy of the reference file with two columns both headed `Employee ID` is
rejected as ambiguous; uploading a copy of the reference file with every
data row deleted (header row only) is rejected rather than accepted as a
no-op.

#### FR-1.2: Column-to-field mapping

Each data row maps onto spec 001's `employees` fields as: `id` ← `Employee
ID`, `name` ← `Preferred Name`, `position` ← `Business Title`, `country` ←
`Location Country` (not `Location Description` — see spec 001's Out of Scope
on color-bucket derivation, which needs country-level, not site-level,
values). `Direct Supervisor ID` is used via `reassignManager` (FR-2.2), not
passed to `upsertEmployee`, matching spec 001's `upsertEmployee` having no
`manager_id` field. Columns not listed anywhere in this spec (`Time Type`,
`Job Code`, `Job Family`, `Compensation Grade Profile`, the `Zone -
*` columns, etc.) are read from the file but not persisted. Every text
field this spec reads — `name`, `position`, `country`, `currency`
(FR-1.5), and the three rating values (FR-3.1), in addition to the
identifiers covered by FR-1.3 — must be an ExcelJS plain string
`cell.value`; a formula-result object, rich-text object, error cell, or any
other non-string type is treated as invalid data (FR-5.1), the same as a
non-numeric salary cell (FR-1.5).
**Verify:** Importing the reference file's first data row (Employee ID
`00000015867`) produces an `employees` row with `id`, `name`, `position`,
and `country` matching that row's `Employee ID`, `Preferred Name`, `Business
Title`, and `Location Country` cell values exactly; a copy of the reference
file with a `Preferred Name` cell replaced by a formula aborts the import
(FR-5.1) rather than importing whatever ExcelJS's formula-result object
happens to stringify to.

#### FR-1.3: Identifier values are preserved as literal strings

`Employee ID` and `Direct Supervisor ID` cells must be text-formatted in the
source file (confirmed against the reference file: both columns are stored
as inline strings, not numbers) — the importer reads ExcelJS's `cell.value`
and requires it to already be a string; a cell ExcelJS reports as a `number`
type is treated as invalid data (FR-5.1) rather than reformatted back into a
zero-padded string, since guessing the original width would risk silently
fabricating a wrong id — shown to the user as, for example, "row 5: Employee
ID must be text, not a number." Values are trimmed of surrounding whitespace before
use, reusing spec 001's own blank-field check (FR-1.2) — beyond that, no
additional length, case, or character-set restriction is imposed, consistent
with spec 001's own decision not to constrain `id`'s format ahead of real
data (spec 001 Constraints).
**Verify:** An `Employee ID` cell containing `00000015867` is stored and
retrievable via `getEmployeeById` as exactly `"00000015867"`, not
`"15867"`; a copy of the reference file with an `Employee ID` cell
reformatted as a plain number (losing its leading zeros) aborts the
import (FR-5.1) rather than importing a shortened id.

#### FR-1.4: Duplicate Employee ID within one file is rejected

If the uploaded file contains two or more rows with the same (trimmed)
`Employee ID`, the import is rejected as invalid before any row is written,
naming the duplicated id — rather than silently keeping only the
last-processed row's values, which would discard data with no indication
anything was lost.
**Verify:** Uploading a copy of the reference file with a second row's
`Employee ID` changed to duplicate an existing row's id is rejected with an
error naming that id, and results in zero database changes.

#### FR-1.5: Salary snapshot mapping

Each row also produces a salary snapshot written via `upsertSalaryRecord`:
`currency` ← `Worker Currency`, `baseSalary` ← `Worker Total Base Pay
Amount`, `bonus` ← `Worker Total Target Cash Amount` minus `Worker Total
Base Pay Amount` (this is 0 for a row with no bonus plan, since WorkDay
reports `Worker Total Target Cash Amount` equal to base pay in that case —
see the reference file's row 4). `effectiveYear` is not read from the file
at all — the report has no field for it — and is instead set to the year
component of this import's captured reference date (AR-5.3). Both
amount cells are read as ExcelJS's plain numeric `cell.value`; a cell that
is instead a string, a formula-result object, blank, or any other
non-numeric type for either field is treated as invalid data (FR-5.1). A row
where the derived `bonus` would be negative (`Worker Total Target Cash
Amount` less than `Worker Total Base Pay Amount`) is also treated as invalid
data via spec 001's existing non-negative-bonus validation — it is not
clamped to zero.
**Verify:** Importing the reference file's row 2 (base pay `151604.94`,
target cash `166765.43`) produces a `salary_history` row with `baseSalary =
151604.94` and `bonus` equal to `166765.43 − 151604.94` (rounded to 2
decimals per spec 001's AR-2.3); a row with no bonus plan (target cash
equal to base pay) produces `bonus = 0`; a row where target cash is edited
to be less than base pay aborts the entire import (FR-5.1) rather than
importing a zero or negative bonus.

### Architectural Requirements

#### AR-1.1: XLSX parsing library

[ExcelJS](https://github.com/exceljs/exceljs) (v4.x, requires Node.js
`>=8.3`, compatible with this project's Node `>=22` engine) reads the
uploaded workbook via `workbook.xlsx.readFile`/`workbook.xlsx.load`, and
rows are read via `worksheet.eachRow`/`row.getCell`, matched to the header
row from FR-1.1. ExcelJS is chosen over the SheetJS/`xlsx` npm package,
which has a history of unpatched security advisories (prototype pollution,
ReDoS) on the versions published to npm, versus ExcelJS's actively
maintained npm releases.

---

## Feature 2: Reimport (Employee Lifecycle)

**Who & why:** This import runs repeatedly as WorkDay data changes over
time. There is no explicit termination-date field in the source report (see
spec 001's Change Log, 2026-08-31 update), so this feature is how the app
infers departure — from absence in the latest file — without ever
destroying history just because someone is temporarily missing from one
import. An earlier version of this spec tried to also make it safe to mix
*different* managers' teams into the same database by inferring each
import's "team boundary" from the manager hierarchy; that mechanism turned
out not to work (an external supervisor id is never actually written as
anyone's `manager_id`, so it can't be used to bound a search — see this
spec's Change Log), so this feature instead reconciles against the *whole*
database and this spec adopts a documented constraint instead: it assumes
the database holds one manager's team at a time (see Constraints).

### Functional Requirements

#### FR-2.1: Upsert employees present in the new file, reactivating anyone returning

For every row in the uploaded file, the importer calls `upsertEmployee` with
the fields from FR-1.2 and `endDate` explicitly `null`, which updates the
existing row if that `id` already exists — clearing any `end_date` previously
set by FR-2.3, so an employee who was soft-inactivated and has since
reappeared is reactivated — or creates a new row otherwise. This step
preserves the employee's `id`, and therefore their linked
`salary_history`/`rating_history` rows, across imports, and does not touch
`manager_id` (see FR-2.2).
**Verify:** Re-importing a file where an existing employee's `Business
Title` changed updates their `position` without creating a duplicate row or
disturbing their existing `salary_history`/`rating_history` rows;
re-importing a file containing an employee whose `end_date` was previously
set by FR-2.3 clears it back to `null`.

#### FR-2.2: Manager reassignment

After every row in the file has been upserted (FR-2.1), the importer sets
each file employee's manager as follows, for every row in the file: if
`Direct Supervisor ID` is blank, call `reassignManager(employeeId, null)`
directly — there is no id to look up. Otherwise, the importer first checks
whether that id corresponds to an existing employee via `getEmployeeById`
(this covers both an employee upserted earlier in this same import, FR-2.1,
and one already in the database from a previous import), and only then
decides what to pass to `reassignManager`: the resolved id if found, or
`null` if not. The importer never calls `reassignManager` with an id it
hasn't already confirmed exists — spec 001's `reassignManager` throws
`NotFoundError` for a nonexistent `newManagerId`
([mutations.ts](/Users/borgf/Documents/employee_reports/src/db/mutations.ts:77)),
so passing an unresolved external id directly would abort the whole import
(FR-5.1), not silently succeed. An external, unresolvable supervisor id is
an expected, common case, not a data-quality problem: this report is scoped
to one manager's team, so the report-running manager's own record is not a
row in their own export, and every one of their direct reports has a
`Direct Supervisor ID` that resolves to nobody at all (confirmed against
the reference file — e.g. `Frank Borg`, id `00000270149`, is the supervisor
of several rows but was never imported as an employee himself).
**Verify:** Importing the reference file leaves every employee whose
`Direct Supervisor ID` is `00000270149` (Frank Borg — never an employee
record) with `managerId = null`, without the import aborting; an employee
whose `Direct Supervisor ID` resolves to another employee (in this file or
already in the database) has that employee's `id` as their `managerId`; an
employee with a blank `Direct Supervisor ID` cell has `managerId = null`
without any lookup being attempted.

#### FR-2.3: Soft-inactivate employees no longer present

After FR-2.2, the importer reads every *currently active* employee (via
`getAllEmployees()`, which defaults to active-only per spec 001's FR-1.2)
and soft-inactivates any whose id is absent from the uploaded file — the
importer reads their current record via `getEmployeeById` and calls
`upsertEmployee` again with the same `name`/`position`/`country` and
`endDate` set to this import's captured reference date (see AR-5.3),
preserving their `salary_history`/`rating_history` exactly as spec 001
intends for inactive employees (FR-1.2), rather than deleting them. An
employee who is *already* inactive (`end_date` already set) is left
untouched even if also absent from the file — soft-inactivation only ever
transitions active → inactive, never rewrites an existing `end_date`,
so a genuine departure's original date is never overwritten by a later
import that still doesn't include them.
**Verify:** Importing a file that previously included employee X, then
re-importing a version of that file with X removed, sets X's `end_date` to
this import's date and leaves X's `salary_history`/`rating_history` rows
intact — X is not deleted. Re-importing a third time, with X still absent,
leaves X's `end_date` exactly as FR-2.3 set it the first time (not bumped
forward to the third import's date).

---

## Feature 3: Performance Rating Import

**Who & why:** The three rating columns this report provides
(`Performance Rating - Most Recent`, `- Prior Rating`, `- Two Year Prior
Rating`) are relative labels, not calendar years — WorkDay gives no year or
date for any of them anywhere in this report. Spec 001's `rating_history`
currently requires an integer `rating_year`, which this report cannot
supply; this feature defines how ratings are keyed instead.

### Functional Requirements

#### FR-3.1: Rating column mapping to labeled rows

Each of the three rating columns is written as one `rating_history` row per
employee, keyed by the report's own label text — `"Most Recent"`,
`"Prior Rating"`, and `"Two Year Prior Rating"` respectively — instead of a
calendar year (see AR-3.1 for the schema change this requires). A blank
rating cell is not written as a row, matching spec 001's existing
"don't pad" behavior for employees with fewer than three recorded ratings.
**Verify:** Importing a row with all three rating columns populated creates
exactly 3 `rating_history` rows for that employee, keyed `"Most Recent"`,
`"Prior Rating"`, and `"Two Year Prior Rating"`; importing a row with
`Performance Rating - Two Year Prior Rating` blank creates only 2 rows for
that employee.

#### FR-3.2: Ratings are replaced, not accumulated, per import

Because the three labels are relative to "now" rather than fixed years,
each import's values for the three labels overwrite the same three keyed
rows for that employee (via upsert-by-unique-key), rather than accumulating
a new row every import. For an employee present in the current import, the
database never holds more rating history than that import's row shows —
this doesn't apply to a soft-inactivated employee (FR-2.3), whose last-known
ratings are deliberately preserved indefinitely, the same as their salary
history.
**Verify:** Importing the same employee's unchanged data twice results in
exactly 3 `rating_history` rows for that employee, not 6.

#### FR-3.3: Stale ratings are removed when a period goes blank on reimport

If an employee's `rating_history` has an existing row for a given
`rating_period`, but the current import's row for that employee has a blank
cell for that same period's column, the existing row is deleted rather than
left in place — otherwise a rating that legitimately ages out of the
report's 3-period window would remain in the database indefinitely,
contradicting FR-3.2's "never holds more than the source currently shows."
**Verify:** An employee with an existing `"Two Year Prior Rating"` row whose
current import row has that column blank has that row deleted, leaving only
the periods still present in the current file.

### Architectural Requirements

#### AR-3.1: Required schema and query changes to Spec 001 (prerequisite)

FR-3.1–FR-3.3 require three changes to spec 001, none of which this spec's
import logic can work around on its own — **this spec cannot be implemented
until spec 001 is updated (via `/spec-update`, per this skill's rule
against modifying existing specs directly) to make all three:**

1. Replace `rating_history`'s `rating_year` column and its
   `[1990, current year + 1]` range validation with a `rating_period` `TEXT`
   column constrained to the three label values in FR-3.1, with the unique
   constraint moved to (`employee_id`, `rating_period`).
2. Redefine `getLastRatings` for period-based data: "descending by year"
   has no meaning for three fixed relative labels, so it should instead
   return an employee's rating rows in a fixed period order (`"Most
   Recent"`, then `"Prior Rating"`, then `"Two Year Prior Rating"`),
   omitting any period with no row, rather than sorting by a year that no
   longer exists.
3. Add a delete-by-period write function (e.g. `deleteRatingRecord(employeeId,
   ratingPeriod)`) to spec 001's data-access layer, since FR-3.3 needs to
   remove a specific existing row and no such function exists today.

Spec 001's schema is created via `CREATE TABLE IF NOT EXISTS`
([schema.ts](/Users/borgf/Documents/employee_reports/src/db/schema.ts:1)),
which does nothing to a table that already exists with the old
`rating_year` column — and spec 001 is a *closed, implemented* spec, not a
blank slate. In practice, no persisted `data/employees.sqlite` exists
anywhere yet (this spec's own AR-4.4 is what first creates one; spec 001's
tests only ever use disposable temp-file databases), so there is no real
data to migrate today. Spec 001's update should still add an explicit
startup guard — e.g. checking for the old `rating_year` column and failing
loudly with a clear message — rather than silently misbehaving against a
database created before this change, since spec 001 has no migration
framework by design (spec 001 Constraints).

---

## Feature 4: Local Web UI & Import Trigger

**Who & why:** No UI stack has existed until this spec — the project has
only been a SQLite data-access layer with a test suite. The user needs one
concrete way to run an import: a command that opens a screen, rather than
hand-editing files or running scripts against the database directly.

### Functional Requirements

#### FR-4.1: Startup command launches the UI

Running `npm start` starts a local Node.js HTTP server bound to `127.0.0.1`
on an available port and automatically opens the user's default web browser
to it, using the `open` package (v11.x, ESM-only — matching this project's
existing `"type": "module"` setup, Node `>=20` required, compatible with
this project's Node `>=22` engine). No manual URL entry is required.
**Verify:** Running `npm start` results in a browser window opening to the
running server's URL within a few seconds, with no address typed by hand.

#### FR-4.2: Import screen file upload

The browser UI shows a single "Import WorkDay Report" screen with a file
picker that defaults to filtering for `.xlsx` files (`accept=".xlsx"`) and
an "Import" button. Selecting a file and clicking Import uploads it via a
`multipart/form-data` `POST` to the server, which runs Features 1–3's
parsing, mapping, and reconciliation logic against it — but only as a
preview (FR-4.3); nothing is committed to the database by this step alone.
**Verify:** Selecting the reference file and clicking Import successfully
submits it to the server and produces a preview (FR-4.3), with no database
row yet changed; the `accept` attribute is a picker hint, not enforcement —
a file of another type selected via "all files" is still rejected, but by
FR-1.1's server-side check, not by the browser.

#### FR-4.3: Preview before commit

Uploading a file (FR-4.2) never writes to the database directly. The
server runs the full reconciliation (Features 1–3, validated per Feature
5) inside AR-5.1's transaction, computes the result, and always rolls that
transaction back — nothing is committed by this step. If the reconciliation
would succeed, the server retains the uploaded file and its computed
result, keyed by a short-lived token, and the screen displays a preview
with a "Confirm Import" button: **added** (employee ids in the file with no
prior record), **updated** (employee ids that already existed and would be
re-upserted by FR-2.1 — counted whether or not any field value actually
changed, since every present row is always re-upserted), and
**inactivated** (employees that would be soft-inactivated by FR-2.3).
There is no threshold or size-based exemption from this preview step —
every import, however small its effect, requires the same explicit
confirmation (FR-4.4), since an accidental wrong-file upload is exactly as
costly whether it affects 3 employees or 300. If the reconciliation would
instead fail (FR-5.1), the screen shows that specific error and no Confirm
button is offered — there is nothing to confirm. Every error message shown
is a specific, pre-defined validation or parsing failure (e.g. a named
missing column, or "row 12: Employee ID is blank") rendered as plain text —
never a raw exception stack trace, file-system path, or other internal
detail, and never interpreted as HTML, so content from the uploaded file
can't be reflected as markup. The server responds `200` whenever it
successfully computes a preview outcome — whether that outcome is "this
would succeed, here are the counts" or "this would fail, here's why";
either way, the preview step itself did its job, and the response body
distinguishes the two cases. `400` is reserved for a request the server
couldn't even attempt to preview (missing file, wrong field name,
malformed workbook — FR-1.1's parse-level rejections). `403` is a rejected
cross-origin request (AR-4.3), `409` a request made while another import is
in flight (FR-5.2, which now spans the whole preview-to-confirm window),
and `413` a request exceeding AR-4.5/AR-4.6's limits.
**Verify:** Uploading the reference file as a re-import (no data changed)
shows a preview of "0 added, 43 updated, 0 inactivated" with a Confirm
button, and zero database rows have changed at this point; uploading a
file with one row missing a required `Employee ID` shows that specific
error with no stack trace or file path visible, and no Confirm button.

#### FR-4.4: Confirming commits the previewed import

Clicking "Confirm Import" sends a request referencing FR-4.3's token. The
server re-runs the identical reconciliation against the retained file —
in case anything relevant changed since the preview was computed — and
this time commits the transaction (AR-5.1) instead of rolling it back. The
screen then shows the same success message FR-4.3 already displayed
(the counts cannot have changed, since nothing else can have run against
the database during the preview-to-confirm window per FR-5.2), or, in the
rare case the re-run now fails, the same abort-error presentation FR-4.3
defines. After a commit or a final failure, the retained file is deleted
(AR-4.2) and the token is invalidated; an expired or unknown token is
rejected with `400`.
**Verify:** Clicking Confirm after a successful preview commits exactly
the previewed added/updated/inactivated counts to the database; clicking
Confirm with an expired or already-used token returns `400` without
writing anything.

### Architectural Requirements

#### AR-4.1: Web server framework

Express (v5.x per its published npm registry version, requiring Node
`>=18`, compatible with this project's Node `>=22` engine) serves the HTTP
server and the file-upload endpoint — mature, minimal, and avoids
introducing a heavier full-stack framework for what is currently a
single-screen app.

#### AR-4.2: File upload handling

Multer (v2.x, requiring Node `>=10.16`) handles the `multipart/form-data`
upload as Express middleware, using disk storage to a temporary upload
directory, configured for exactly one file per request (see AR-4.5 for size
limits). Because FR-4.3/FR-4.4's preview-then-confirm flow retains the
uploaded file between the two requests, it is deleted only once that flow
concludes — a commit (FR-4.4), a failed preview with nothing to confirm
(FR-4.3), or the token expiring unconfirmed — not immediately after the
initial upload request returns. An unexpected server error at any point
also triggers cleanup. Because a crash or `SIGKILL` can bypass all of this,
the server also sweeps the temporary upload directory once at startup
(AR-4.4), deleting anything left over from a previous run, so temporary
files never accumulate indefinitely even across a hard failure.

#### AR-4.3: Localhost-only binding

The HTTP server binds to `127.0.0.1` only, never `0.0.0.0`, since this is a
single-user local tool handling compensation and performance data (matching
spec 001's AR-4.2 rationale) and has no authentication layer (see Out of
Scope). Because binding to localhost alone doesn't stop another page open in
the same browser from submitting a cross-site form to this endpoint, the
import endpoint also rejects any request whose `Origin` header is missing
or doesn't match the server's own origin, with `403` — the single
concession this local-only tool makes to the assumption that "local" still
shares a browser with untrusted web pages.

#### AR-4.4: Database bootstrap

On startup, the server ensures the `data/` directory exists — via
`fs.mkdirSync(dir, { recursive: true })`, which is idempotent and safe even
if another process creates the directory in the same instant, unlike an
`existsSync`-then-`mkdir` check-then-act pair — before calling
`initDatabase` against `data/employees.sqlite`, once, before accepting any
HTTP requests. This is required because spec 001's `initDatabase` does not
create a missing parent directory — it throws (spec 001's FR-4.2) — so this
spec's startup code owns creating it first. This same startup sequence also
performs AR-4.2's stale-upload-directory sweep, before the server begins
accepting requests.

#### AR-4.5: Upload size and row limits

Multer is configured with a 25 MB *compressed* file-size limit (the
reference file is ~16 KB; 25 MB gives generous headroom while bounding
upload size) and a maximum of 1 file per request. After FR-1.1's header row
is confirmed, a file with more than 5,000 non-blank data rows is rejected
before the row-processing loop runs (a blank row — one `worksheet.eachRow`
visits with no non-empty cells — is skipped and not counted toward this
cap). A request exceeding either limit is rejected with a clear error via
FR-4.3's error path, before the full file is processed.

#### AR-4.6: ZIP-bomb preflight, before ExcelJS ever opens the file

Because `.xlsx` is a ZIP container, a small compressed file can still
decompress to something much larger (a zip bomb) — and AR-1.1's chosen
ExcelJS API (`workbook.xlsx.readFile`/`.load`) decompresses every entry
into memory as part of opening the file, with no hook to inspect size
first. Checking size "as ExcelJS reads it" is therefore not achievable
with that API; the check must happen *before* ExcelJS is invoked at all.
[yauzl](https://github.com/thejoshwolfe/yauzl) (v3.x, requires Node.js
`>=12`, compatible with this project's Node `>=22` engine) opens the
uploaded file and reads its central directory only — via
`yauzl.open(path, { lazyEntries: true })`, iterating entries without
decompressing any of them — checking each entry's declared
`uncompressedSize`, the sum of `uncompressedSize` across all entries, and
`entryCount`. The import is rejected, before ExcelJS is ever invoked, if
any single entry's declared uncompressed size exceeds 50 MB, the total
declared uncompressed size across all entries exceeds 250 MB, or
`entryCount` exceeds 200 (the reference file has 10 entries; ordinary
multi-sheet `.xlsx` exports have a few dozen at most). This preflight
trusts the ZIP central directory's declared sizes rather than verifying
every byte of the compressed stream — an appropriate bound for this
spec's threat model (a corrupted or unexpected file on a single local
machine), not a defense against a determined adversary crafting a
stream that lies about its own declared size (see Constraints).

---

## Feature 5: Import Validation & Atomicity

**Who & why:** The data this app holds — compensation and performance
ratings — is sensitive enough that a silently half-updated database from a
bad or unexpected file is worse than a clearly failed import. A corrupted
export, or one produced from a different report template, must never leave
some employees updated and others not.

### Functional Requirements

#### FR-5.1: Whole-import abort on any invalid row

If any row in the uploaded file fails spec 001's existing field validation
(blank `id`/`name`/`position`/`country`, malformed `currency`, negative or
non-finite `baseSalary`/`bonus`, a blank `Worker Total Target Cash Amount`
that FR-1.5's bonus derivation cannot compute, etc.), or the file's
supervisor relationships would create a cycle (spec 001's `CycleError`,
raised via `reassignManager`, FR-1.4) — the entire import is aborted and no
database writes from that upload are retained, even if only one row out of
many is invalid. This check happens once, during FR-4.3's preview
computation, inside AR-5.1's whole-import transaction, not as a separate
pre-validation pass; confirming (FR-4.4) cannot itself fail this check
again except in the rare case something changed between preview and
confirm.
**Verify:** Uploading a 43-row file where only one row has a blank
`Employee ID` results in a preview showing that error, not a success
preview, and zero database changes; a file whose supervisor relationships
would create a cycle is rejected the same way, with the `CycleError`'s
message shown, not an unhandled exception.

#### FR-5.2: Single in-flight import

Because the data-access layer holds one shared database connection per
process (spec 001's AR-4.3), the server rejects a second import request
(HTTP 409) while one is already in flight — from the moment a preview
(FR-4.3) is computed until it is either confirmed (FR-4.4), fails, or its
token expires — rather than allowing a second upload to preview or commit
concurrently with the first. An unconfirmed preview's token expires 5
minutes after it's issued, releasing the guard and deleting the retained
file (AR-4.2), so an abandoned upload doesn't block imports indefinitely.
This guard is scoped to a single running server process (matching spec
001's single-connection model, AR-4.3) — this spec assumes only one `npm
start` instance runs against a given database at a time; two independently
started instances would each hold their own guard and could still race.
**Verify:** Starting a second import while the first has an unconfirmed
preview returns an HTTP 409 response and does not start a second preview;
letting a preview's token sit unconfirmed for 5 minutes releases the guard
and a subsequent upload succeeds; a completed commit (FR-4.4) or a failed
preview (FR-5.1) also releases the guard immediately, without waiting for
the timeout.

### Architectural Requirements

#### AR-5.1: Whole-import transaction

The entire reconciliation for one uploaded file — Feature 2's upserts,
reassignments, and soft-inactivations, and Feature 3's rating writes — runs
inside a single `better-sqlite3` transaction, wrapped via a new
`runInTransaction(fn)` function exposed from spec 001's data-access layer
(see AR-5.2 — not the internal `getConnection()`, which isn't part of that
layer's public API). `better-sqlite3` supports this kind of nesting
automatically via savepoints, so calling spec 001's own mutation functions
(each already wrapped in their own `.transaction()`) from inside this outer
transaction is safe. If any row's write throws partway through, every write
made earlier in that same import is rolled back. FR-4.3's preview uses this
exact same transaction — the only difference between a preview and a
confirmed commit (FR-4.4) is whether the transaction is rolled back
unconditionally at the end (preview) or allowed to commit (confirm); the
reconciliation logic itself never has two versions. This is the concrete
answer to the open question spec 001's Integration Points section left for
this spec: rather than "tolerate a transiently inconsistent org topology"
if a batch import is interrupted between an employee's `upsertEmployee` and
`reassignManager` calls, this spec wraps the whole batch in one transaction
so that no interruption can leave a partial result at all.

#### AR-5.2: Required data-access API addition to Spec 001 (prerequisite)

This spec needs a way to wrap its whole reconciliation in one transaction
without reaching into spec 001's internals: `src/db/connection.ts` exports
`getConnection()`, but spec 001's public barrel (`src/db/index.ts`) does
not re-export it — only the higher-level query and mutation functions are
public. **This spec cannot be implemented until spec 001 is updated (via
`/spec-update`) to add a new exported function — e.g. `runInTransaction<T>(fn:
() => T): T` — that wraps the given function in a single `better-sqlite3`
transaction using the shared connection, without exposing the raw
connection object itself.** This is a second, independent prerequisite
alongside AR-3.1's schema change.

#### AR-5.3: Single captured import timestamp

At the start of processing an upload, the importer captures one reference
instant (the system clock, evaluated in UTC, matching spec 001's AR-2.2
convention) and reuses it for every date/year written by that import —
FR-1.5's `effectiveYear` and FR-2.3's inactivation `endDate` both derive
from this same captured value, rather than each reading the clock
independently. This keeps a single import internally consistent even if it
runs across a UTC-midnight boundary.

---

## Data Requirements

### Modified `rating_history` schema (prerequisite — see AR-3.1)

This spec depends on spec 001's `rating_history` table being changed to:

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | INTEGER | Primary key, autoincrement |
| `employee_id` | TEXT | Not null, foreign key → `employees.id`, `ON DELETE CASCADE` |
| `rating_period` | TEXT | Not null — one of `"Most Recent"`, `"Prior Rating"`, `"Two Year Prior Rating"` |
| `rating_value` | TEXT | Not null |

Unique constraint on (`employee_id`, `rating_period`), replacing the
current (`employee_id`, `rating_year`) constraint. This spec does not
create or alter this table itself — it is a prerequisite change to spec
001 (AR-3.1), alongside `getLastRatings`'s redefinition and the new
`deleteRatingRecord` function (also AR-3.1).

### Required new data-access function (prerequisite — see AR-5.2)

Spec 001 needs one new exported function: `runInTransaction<T>(fn: () =>
T): T`, wrapping the given function in a single transaction on the shared
connection. This spec does not implement it — it is a prerequisite change
to spec 001 (AR-5.2).

## Integration Points

- **Spec 001 (Data Foundation & SQLite Schema):** this spec is the first
  caller of spec 001's write API (`upsertEmployee`, `reassignManager`,
  `upsertSalaryRecord`, `upsertRatingRecord`) and read API
  (`getEmployeeById`, `getAllEmployees`), and requires two prerequisite
  changes before it can be implemented: the `rating_history` schema/query
  changes (AR-3.1) and the new `runInTransaction` export (AR-5.2). This spec
  does not call `deleteEmployee` or `getDescendants` at all — departures are
  soft-inactivated (FR-2.3) against the whole active-employee set, not
  scoped via the hierarchy.
- **Future Headcount Dashboard and Employee Details specs:** this spec
  establishes the app's only running process — the local web server started
  by `npm start` (FR-4.1) — which those future screens will extend with
  additional routes/pages rather than each standing up their own server.

## Related Specs

| Spec | Relationship | Affected Requirements |
| --- | --- | --- |
| Spec 001: Data Foundation & SQLite Schema | **Depends on** — requires the full data-access layer (queries, mutations) to exist | All features |
| Spec 001: Data Foundation & SQLite Schema | **Modifies** — requires `rating_history.rating_year` (INTEGER) replaced with `rating_period` (TEXT), `getLastRatings` redefined for periods, and a new `deleteRatingRecord` function, before this spec can be implemented | FR-3.1–FR-3.3, AR-3.1 |
| Spec 001: Data Foundation & SQLite Schema | **Modifies** — requires a new exported `runInTransaction` function before this spec can be implemented | AR-5.1, AR-5.2 |

## Constraints

- This spec's mapping is fixed to the "Team Market Range Analysis for
  Managers" report layout (reference file in `workday_docs_examples/`).
  Other WorkDay report types or layouts are out of scope until a real
  export of that type is available to map against (consistent with spec
  001's existing "format not yet known" stance on fields it hasn't seen).
- FR-2.2's external-supervisor handling assumes this report is
  manager-scoped and that the report-running manager's own record is never
  a row in their own export — confirmed against the reference file, not a
  general guarantee for every possible WorkDay report configuration.
- **This spec assumes the database holds exactly one manager's team at a
  time.** FR-2.3 soft-inactivates any currently-active employee absent from
  the uploaded file, checked against the *whole* database — there is no
  mechanism to bound that check to "this file's team" (an earlier version
  of this spec attempted one via the manager hierarchy; it didn't work,
  since an external supervisor id is never actually written as anyone's
  `manager_id` and so can't be used to find their reports — see Change
  Log). Importing a *different* manager's team into a database that already
  holds another team's employees would incorrectly soft-inactivate that
  other team. Safely supporting multiple teams in one database needs an
  explicit, persisted ownership marker per employee — a larger change,
  deferred until it's actually needed.
- No authentication or authorization on the web server (AR-4.3) — matches
  spec 001's single-user, local-only stance.
- Import is manually triggered by the user clicking Import in the browser
  (FR-4.2); there is no scheduled or automatic import.
- `rating_period` values are fixed to the three exact label strings this
  report currently produces; a WorkDay report that renames these columns
  (e.g. a different rating-cycle terminology) is out of scope until
  observed.
- Implementing this spec requires adding five new dependencies (ExcelJS,
  Express, Multer, `open`, `yauzl`) and a `start` script to `package.json`,
  none of which exist in the project today.
- AR-4.6's ZIP preflight trusts the declared sizes in the uploaded file's
  ZIP central directory rather than independently verifying every byte of
  the compressed stream. This is a reasonable bound for this spec's actual
  threat model — a corrupted or unexpected file on a single local machine —
  but is not a defense against a determined adversary who crafts a stream
  whose actual decompressed output disagrees with its own declared size.

## Out of Scope

- Any WorkDay report type other than "Team Market Range Analysis for
  Managers" (Constraints).
- Scheduled or automatic (non-manual) imports.
- Undoing or rolling back a *successful* import — FR-5.1's abort-before-
  commit is the only safety net; once an import completes successfully,
  reverting it means re-importing a prior file.
- The Headcount Dashboard and Employee Details screens (future specs) —
  this spec only builds the Import screen and the server that will host
  them.
- Authentication, authorization, or multi-user access control.
- Any navigation shell or multi-page UI framework — this is a single
  screen; a navigation pattern is deferred until a second screen exists.
- Anniversary-lookup data (hire dates) — already out of scope per spec
  001's 2026-08-31 Change Log update; this report has no hire-date field
  either.
- Automatic recovery from a hung or crashed import request — FR-5.2's
  in-flight guard clears on process restart, which is the accepted recovery
  path; there is no separate stuck-import detection or timeout.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — scope is parsing one fixed report
  layout, reconciling it against spec 001's schema, and a single Import
  screen (Overview, Features 1–5); each FR has a Verify line.
- [x] **Testing strategy** — each FR's Verify line implies a test against
  the reference file in `workday_docs_examples/` and/or modified copies of
  it (e.g. a copy with a header removed, a copy with a blank required
  field); follows spec 001's existing pattern of tests against a real
  temp-file SQLite database (`test/db/helpers.ts`'s `withFreshDatabase`).
- [x] **Existing patterns** — reuses spec 001's data-access layer
  (`getEmployeeById`, `upsertEmployee`, `reassignManager`,
  `upsertSalaryRecord`, `upsertRatingRecord`, `getAllEmployees`) rather than
  writing SQL directly; reuses spec 001's `.transaction()` pattern (AR-5.1,
  via the new `runInTransaction` prerequisite in AR-5.2) and umask/
  permission approach is inherited unchanged from spec 001's `initDatabase`.
- [x] **Dependencies** — ExcelJS (AR-1.1), Express (AR-4.1), Multer
  (AR-4.2), `open` (FR-4.1), and `yauzl` (AR-4.6) are each justified against
  alternatives and version-checked against this project's Node `>=22`
  engine; Constraints notes these are net-new `package.json` additions.
- [x] **Architecture & interfaces** — the modified `rating_history` shape
  and the new `runInTransaction` function are in Data Requirements; the
  whole-import transaction and its preview-vs-commit rollback distinction
  are in AR-5.1; the preview/confirm token lifecycle is in FR-4.3/FR-4.4;
  the single captured import timestamp is in AR-5.3; the server bootstrap
  sequence (including the stale-upload sweep) is in AR-4.4.
- [x] **Error handling & failure modes** — missing/duplicate required
  headers, unparseable files, and zero-row files (FR-1.1), non-string
  identifier and text-field cells (FR-1.2, FR-1.3), duplicate Employee IDs
  (FR-1.4), non-numeric/negative-bonus salary cells (FR-1.5), manager
  reassignment that always verifies existence before writing (FR-2.2), a
  source hierarchy cycle (FR-5.1), soft-inactivation that never overwrites
  an existing departure date (FR-2.3), stale ratings on a period going
  blank (FR-3.3), any invalid row (FR-5.1), an expired/unknown confirm
  token (FR-4.4), and concurrent/abandoned imports spanning the whole
  preview-to-confirm window (FR-5.2) are all explicitly defined. An
  explicit HTTP status contract (FR-4.3) covers every failure mode.
- [x] **Security review** — the server is localhost-only and requires a
  matching `Origin` header, rejecting both missing and mismatched ones
  (AR-4.3); has no authentication (Constraints — explicitly out of scope,
  matching spec 001); uploads are bounded by compressed size and row count
  (AR-4.5), with a ZIP-bomb preflight (AR-4.6) that inspects the central
  directory *before* ExcelJS ever decompresses anything (replacing the
  earlier, infeasible "check as ExcelJS reads it" approach); temp files are
  cleaned up on every exit path and swept at startup as a crash backstop
  (AR-4.2); and nothing is reflected into error output as anything but
  sanitized plain text (FR-4.3). The preflight's declared-size trust
  assumption is stated explicitly (Constraints). Revisit if this app is
  ever exposed beyond a single local user.
- [x] **Performance impact** — bounded explicitly by AR-4.5 (25 MB
  compressed / 5,000 row caps) and AR-4.6 (250 MB total declared
  uncompressed / 50 MB per entry / 200 entries) rather than left open; the
  reference file (43 rows, ~16 KB, 10 entries) is far within all of these
  limits, and behavior at each cap is a test case (Testing strategy) rather
  than an unmeasured assumption.
- [x] **Rollout & migration** — no persisted database exists yet for this
  app (this spec's own AR-4.4 creates the first one), so there is no real
  data to migrate; AR-3.1 requires spec 001's update to add an explicit
  startup guard against an old-shape database anyway, since spec 001 has no
  migration framework and `CREATE TABLE IF NOT EXISTS` cannot alter an
  existing table.
- [x] **Assumptions & risks** — key assumptions are stated inline: the
  report layout is fixed to one known export (Constraints), the
  external-supervisor case assumes a manager-scoped report (Constraints,
  FR-2.2), `rating_period` assumes WorkDay's three current label strings
  don't change (Constraints), this spec assumes the database holds exactly
  one manager's team at a time — mitigated, not eliminated, by FR-4.3's
  mandatory preview-and-confirm step, since a user can still confirm a
  genuine mistake — the earlier hierarchy-based scoping attempt didn't work
  and was replaced (Constraints, Change Log), FR-5.2's guard assumes a
  single running server process, AR-4.6's ZIP preflight trusts declared
  sizes rather than verifying every byte (Constraints), and this spec is
  blocked on two independent spec 001 changes it cannot make itself
  (AR-3.1, AR-5.2, Related Specs).

---

## Change Log

### Update from critique-consolidated-v-1.md

**Applied:**

- **Rewrote Feature 2 (renamed "Scoped Reimport") to fix an unsafe
  reconciliation scope** — the original FR-2.3 hard-deleted every employee
  absent from the uploaded file, which would wipe out a *different*
  manager's team on the next import and destroyed history spec 001 exists
  to preserve. Replaced with scope-bounded soft-inactivation: FR-2.2 now
  detects this import's "scope roots" (external supervisor ids with no row
  in the file), FR-2.3 bounds the absence-check to `getDescendants` of
  those roots, and absent employees get `end_date` set (soft-inactivate)
  instead of being deleted. This also eliminates the old leaf-to-root
  deletion algorithm entirely — soft-inactivation has no FK-ordering
  concerns, and `deleteEmployee` is no longer called by this spec at all.
  FR-2.1 now also explicitly reactivates (clears `end_date` on) a returning
  employee.
- Expanded AR-3.1 (renamed to cover query changes too) to require, as
  prerequisites to spec 001: `getLastRatings` redefined for fixed period
  order (not "descending by year," which has no meaning for labels), and a
  new `deleteRatingRecord` function — needed by new FR-3.3, which deletes a
  rating row when its period goes blank on reimport (ratings were
  previously upsert-only, so a stale rating could never be removed).
- Added AR-5.2: `AR-5.1` referenced `getConnection()`, which is not exported
  from spec 001's public barrel (`src/db/index.ts`) — verified against
  `src/db/connection.ts` and `src/db/index.ts`. Replaced with a second,
  independent spec 001 prerequisite: a new `runInTransaction` export.
- Added FR-1.4: duplicate `Employee ID` within one file is now explicitly
  rejected, rather than silently keeping the last occurrence.
- Expanded FR-1.1: an unparseable/non-`.xlsx` file is now explicitly
  rejected before header matching; header matching is now explicitly
  case-sensitive/trimmed; a duplicated required header is now explicitly
  rejected as ambiguous.
- Expanded FR-1.5 (salary mapping): numeric cells that aren't plain numbers
  (formula results, strings) are now explicitly invalid; a negative derived
  bonus is now explicitly invalid rather than left to be inferred.
- Expanded FR-4.3: defined "added"/"updated"/"inactivated" counts precisely
  (an idempotent re-import counts as "updated," not zero), and required
  error messages to be sanitized plain text with no stack traces or
  file-system paths.
- Added AR-4.5: explicit 25 MB file-size and 5,000-row caps, replacing the
  previously-open Performance checklist item with a stated limit.
- Expanded AR-4.2 (cleanup covers every exit path, not just success) and
  AR-4.3 (added an `Origin`-check requirement against cross-site form
  submission to the localhost server).
- Expanded FR-5.2: defined the in-flight guard's lifecycle explicitly (clears
  on every exit path; no separate timeout; a hung handler is a
  process-restart concern, now stated in Out of Scope).
- Added a Constraints note that Express/Multer/ExcelJS/`open` and a `start`
  script are net-new `package.json` additions this spec's implementation
  must make.
- Updated Data Requirements, Integration Points, and Related Specs to
  reflect both spec 001 prerequisites (rating schema/query changes,
  `runInTransaction`) and the removal of `deleteEmployee` from this spec's
  dependencies.
- Updated the Spec Completeness Checklist: Performance moved from `[ ]` to
  `[x]` (explicit caps now exist), Security and Error handling notes
  expanded to cite the new requirements.

**Rejected:** none — every finding from the consolidated critique was
either directly actionable or already reflected in the fixes above.

**Reorganized:**

- Renumbered Feature 1's FRs so the newly-inserted duplicate-ID check
  (FR-1.4) sits before the salary mapping FR (now FR-1.5), preserving
  numeric/logical order, and updated every cross-reference to FR-1.5's new
  number (FR-5.1's body, the Error handling checklist note).

### Update from critique-consolidated-v-2.md

All three critique adapters (main-agent, codex, claude) independently
converged on the same finding: v1's "scope root" mechanism — detect an
external supervisor id, bound soft-inactivation to `getDescendants` of that
id — cannot work, because an external id like Frank Borg's is never
actually written as anyone's `manager_id` (the FK constraint on
`employees.manager_id` prevents it), so `getDescendants` of that id finds
nobody. Applied **direction 2** from the two options the critique proposed:
simplify to whole-database reconciliation with a documented single-team
constraint, rather than adding a third spec 001 prerequisite (a persisted
ownership marker) to make multi-team scoping actually work.

**Applied:**

- **Removed the "scope root" mechanism entirely.** Feature 2 renamed from
  "Scoped Reimport" back to "Reimport." FR-2.2 no longer detects or records
  scope roots. FR-2.3 no longer calls `getDescendants` — it reconciles
  against every currently-active employee in the database
  (`getAllEmployees()`), soft-inactivating any absent from the file. Added
  an explicit Constraint: this spec assumes the database holds one
  manager's team at a time; importing a second team into the same database
  would incorrectly affect the first. A real fix (persisted per-employee
  ownership) is deferred until multi-team import is actually needed.
- **Fixed FR-2.2's `reassignManager` contradiction.** Verified against
  [mutations.ts](/Users/borgf/Documents/employee_reports/src/db/mutations.ts:77):
  `reassignManager` throws `NotFoundError` for a nonexistent manager id, so
  the previous FR-2.2 (call it directly with an external id) would have
  crashed, not gracefully left `manager_id` null. FR-2.2 now explicitly
  checks `getEmployeeById` before deciding what to pass to
  `reassignManager`, and separately handles a blank `Direct Supervisor ID`
  (no lookup attempted at all) versus a non-blank one that doesn't resolve
  (looked up, not found, passes `null`).
- **Fixed the soft-inactivation overwrite bug** (found independently by
  main-agent and claude): FR-2.3 now only soft-inactivates a *currently
  active* employee; an already-inactive employee's `end_date` is never
  rewritten by a later import that still doesn't include them.
- **Added a zero-row-file guard to FR-1.1**: now that FR-2.3 reconciles
  against the whole database, an empty (header-only) file would otherwise
  read as "everyone has left." Rejected explicitly, before any processing.
- **Added AR-5.3**: a single captured import timestamp, reused by both
  FR-1.5's `effectiveYear` and FR-2.3's inactivation date, so one import
  can't write inconsistent dates across a UTC-midnight boundary (codex).
- **Added a migration/compatibility note to AR-3.1** (codex): spec 001's
  `CREATE TABLE IF NOT EXISTS` cannot alter an existing table, and spec 001
  is closed/implemented, not a blank slate. No real database exists yet
  (this spec's AR-4.4 creates the first one), but spec 001's update should
  still add an explicit old-schema startup guard rather than assume no
  database will ever predate the change.
- **Closed the decompression-bomb gap in AR-4.5** (codex): added a 250 MB
  uncompressed-size limit alongside the existing 25 MB compressed-file
  limit, since `.xlsx` is a ZIP container.
- **Tightened AR-4.3's Origin check** (codex): now rejects a *missing*
  Origin header too, not just a mismatched one.
- **Tightened FR-1.3** (codex): identifier cells must be ExcelJS-string-typed;
  a cell ExcelJS reports as numeric (which may have already lost leading
  zeros) is treated as invalid data rather than reformatted.
- **Added an explicit HTTP status contract to FR-4.3** (codex): `200`,
  `400`, `403`, `409`, `413` for each defined failure mode.
- Updated Integration Points, Related Specs prose, and the Spec
  Completeness Checklist (Existing patterns, Error handling, Security,
  Performance, Rollout & migration — moved from `[N/A]` to `[x]`, and
  Assumptions & risks) to reflect all of the above.

**Rejected:** none — every finding was either directly actionable or
resolved as a consequence of the Feature 2 redesign.

**Reorganized:**

- Feature 2's "Who & why" rewritten to explain, briefly, why the earlier
  scope-root approach was abandoned, so a future reader doesn't wonder why
  a seemingly-reasonable idea (bound reconciliation to one team) isn't
  present — the reasoning is preserved in-line rather than only in this
  Change Log.

### Update from critique-consolidated-v-3.md

All three critiques re-verified the v2 fixes hold (`reassignManager`
sequencing, the overwrite-prevention, the removed scope-root mechanism) and
this round additionally verified, directly against `better-sqlite3`'s
published documentation, the nested-transaction/savepoint claim AR-5.1 had
repeated across three rounds without confirmation — it's accurate. Two real
issues surfaced: AR-4.5's decompression-bomb guard couldn't work with the
chosen ExcelJS API (confirmed three ways, including a codex-cited security
advisory), and codex identified that the single-team constraint, while
honestly documented, had no safeguard against an accidental cross-team
upload silently succeeding.

**Applied:**

- **Replaced AR-4.5's infeasible uncompressed-size check with a real ZIP
  preflight (new AR-4.6).** `workbook.xlsx.readFile`/`.load` decompress the
  whole archive before any code can inspect it — there's no "check as it
  reads" hook. AR-4.6 now uses `yauzl` to read the ZIP central directory
  (entry sizes, entry count) *before* ExcelJS ever opens the file, rejecting
  anything exceeding declared-size or entry-count bounds without
  decompressing a single entry. AR-4.5 keeps only the compressed-file-size
  and row-count limits, which its buffer-based checks can actually enforce.
- **Added a mandatory preview-and-confirm step (new FR-4.3, FR-4.4)** to
  close the accidental-cross-team-import gap codex identified: uploading a
  file (FR-4.2) now only computes a preview — the full reconciliation runs
  inside AR-5.1's transaction, which is always rolled back — and the user
  must explicitly click "Confirm Import" (against a short-lived token,
  5-minute expiry) before anything commits. No threshold or size exemption:
  every import requires confirmation, since a wrong-file mistake is equally
  costly at any size. FR-5.2's in-flight guard now spans the whole
  preview-to-confirm window, not just one request.
- Scoped FR-3.2's "never holds more than the source shows" claim to
  employees present in the current import — it doesn't apply to a
  soft-inactivated employee's preserved ratings (FR-2.3).
- Extended FR-1.2's text-field validation to `name`/`position`/`country`/
  `currency`/rating values, not just the identifiers FR-1.3 already covered.
- Added cycle handling to FR-5.1: a source hierarchy cycle (`CycleError`,
  via `reassignManager`) now aborts through the same defined path as any
  other invalid row, rather than surfacing as an incidental exception.
- Softened FR-4.2's Verify wording: `accept=".xlsx"` is a picker hint, not
  enforcement — FR-1.1's server-side check is what's actually authoritative.
- Added a startup stale-upload sweep to AR-4.2 (crash/`SIGKILL` backstop)
  and switched AR-4.4 to `fs.mkdirSync(..., { recursive: true })`, removing
  a TOCTOU race in the directory-creation check.
- Noted FR-5.2's guard is scoped to a single running server process.
- Minor wording: FR-1.3 now shows an example error message; FR-2.2 already
  covered the blank-supervisor case clearly enough on review, no change
  needed there.
- Updated Constraints (yauzl dependency, the preflight's declared-size
  trust assumption), and the Spec Completeness Checklist (Dependencies,
  Architecture & interfaces, Error handling, Security, Performance,
  Assumptions & risks) throughout.

**Rejected:** none.

**Reorganized:**

- What was a single "Import result feedback" FR (old FR-4.3) split into
  "Preview before commit" (FR-4.3) and "Confirming commits the previewed
  import" (FR-4.4), since upload and commit are no longer the same step —
  splitting keeps each FR describing one testable transition (upload →
  preview; confirm → commit) rather than one FR describing two.
