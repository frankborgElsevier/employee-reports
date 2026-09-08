# Domains

What the system is and does.

- [Data Foundation](data-foundation/index.md) — the SQLite schema and
  TypeScript data-access layer for employees, org hierarchy, salary history,
  and rating history.
- [WorkDay Import](workday-import/index.md) — the local web server and
  browser screen that uploads a WorkDay export and reconciles it against
  the Data Foundation database.
- [Headcount Dashboard](headcount-dashboard/index.md) — the read-only org
  chart: colour-coded employee and contractor cards nested by line manager,
  with total-people and per-manager team filters.
- [Employee Details](employee-details/index.md) — the read-only, sortable
  table of each active worker's available detail, with position and
  line-manager filters.
- [Contractor Management](contractor-management/index.md) — the manual-entry
  screen and persistence rules for people absent from a WorkDay import.
