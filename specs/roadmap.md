# Roadmap

> Draft roadmap of candidate specs derived from the initial product brief
> (2026-08-28: WorkDay reporting dashboard app). This is a planning aid, not a
> spec — use `/spec-write` to expand any item below into a full spec under
> `specs/features/{number}-{short-title}/spec.md`.

## Source Brief (summary)

An app that imports WorkDay reports into a local SQLite database and presents
three screens: a Headcount dashboard (org-structure view of managers/reports
as color-coded cards), an Employee Details screen (tabular employee data with
filters and an anniversary lookup), and a WorkDay Import screen (deferred —
specific reports to be named later).

## Suggested Sequence

1. Data Foundation & SQLite Schema
2. WorkDay Import Screen (stub/deferred)
3. Headcount Dashboard Screen
4. Employee Details Screen

Rank 1 is a prerequisite for 2–4: both dashboard screens and the import
screen all read/write the same employee, position, org-hierarchy, and
location data, so the schema should be settled first even though the import
screen's report-specific mapping is still unknown.

## Candidate Specs

### 1. Data Foundation & SQLite Schema

- **Scope:** Core SQLite schema and data-access layer for employees,
  positions, line-manager/org-hierarchy relationships, location/country,
  salary (currency, base, bonus), historical performance ratings (at least
  last three end-of-year ratings per employee), and employment dates
  (start date, for anniversary calculations).
- **Depends on:** none.
- **Why first:** every other screen reads or writes this data; deciding the
  shape now avoids rework later.
- **Open questions:**
  - Is "Everywhere" (green card) a real WorkDay location value, or a
    catch-all bucket for any country not UK/US/India?
  - How is the org hierarchy represented — a manager-id self-reference on
    employee, a separate relationship table, or something WorkDay already
    encodes in its export?
  - What happens when an employee has fewer than three end-of-year ratings
    (e.g. new hire)?
  - Should salary be stored/displayed only in its native currency, or also
    normalized to a common currency for aggregate views?

### 2. WorkDay Import Screen

- **Scope:** Screen/flow to load WorkDay report exports and populate the
  SQLite DB from spec 1's schema.
- **Depends on:** Data Foundation & SQLite Schema.
- **Status:** explicitly deferred — you noted the specific WorkDay reports
  will be named later. This spec should stay a stub (target: populate the
  DB; file format and field mapping TBD) until those reports are known.
- **Note:** Re-import strategy is decided in principle — diff-based: upsert
  employees present in the new file (preserving `id` so `salary_history`/
  `rating_history` stay linked), and hard-delete only employee ids absent
  from the new file (their history cascades away per the data foundation
  spec's delete behavior). This also removes the need for an explicit
  termination-date field — absence from the latest import means inactive.
  `salary_history.effective_year` has no source field in the WorkDay report
  (see `workday_docs_examples/`), so it is stamped from the import run's
  date — current calendar year, as of the day the import runs — rather than
  derived from report data. Full field-level mapping is still TBD until
  this spec is written.
- **Open questions:**
  - Which WorkDay reports/exports (format: CSV? Excel? API?) will feed this?
  - Manual file upload vs. scheduled/automatic pull?

### 3. Headcount Dashboard Screen

- **Scope:** Total headcount, totals by position, org-chart-style layout of
  line managers over their reports, one card per employee (name + position),
  cards color-coded by location (UK/US = blue, India = red, everywhere else
  = green), and checkboxes to select which line managers' teams are shown
  (all selected by default).
- **Depends on:** Data Foundation & SQLite Schema.
- **Note:** Color-coding source data is available — the WorkDay report's
  `Location Country` field (see `workday_docs_examples/`) gives country-level
  values suitable for the UK/US/India/other buckets. The exact mapping table
  (which raw country values map to which bucket) is deferred to spec time;
  not a blocker for this roadmap.
- **Open questions:**
  - How many levels of the org hierarchy render at once — direct reports
    only, or the full chain down?
  - What counts as "position" for the totals-by-position breakdown — job
    title, job level/grade, or a WorkDay-specific field?
  - How is a manager who has reports in multiple countries represented —
    does their own card use their personal location, independent of their
    team's mix?

### 4. Employee Details Screen

- **Scope:** Tabular list of all employees (employee id, name, position,
  salary currency, base salary, bonus, last three end-of-year ratings,
  start date), with checkbox filters by position and by line manager, plus
  an anniversary lookup (pick a date range, return employees whose work
  anniversary falls within it).
- **Depends on:** Data Foundation & SQLite Schema.
- **Open questions:**
  - Do the position/line-manager filters combine as AND or OR when both are
    used?
  - Does "anniversary" mean the calendar start-date (month/day) recurring
    each year, regardless of the year in the selected range?
  - Any sort/pagination expectations for a potentially large employee list?

## Not Yet Scoped

These came up implicitly in the brief but have no candidate spec yet because
they need a decision first:

- **Tech stack** — no framework, language, or hosting choice has been made.
- **Access/auth** — brief doesn't mention login or permissions; unclear if
  this is single-user/local-only or needs access control.
- **App shell/navigation** — how the three screens are wired together
  (routing, shared layout) isn't scoped as its own spec; likely folds into
  whichever screen spec is implemented first, or becomes its own thin spec
  if it grows non-trivial.

## Next Step

Run `/spec-write` against one of the candidate specs above — recommended
starting point is **Data Foundation & SQLite Schema**, since specs 3 and 4
both depend on it.
