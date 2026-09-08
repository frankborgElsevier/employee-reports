# Conventions

How the repo usually does things.

- [Data Access Layer](data-access-layer.md) — module layout, error handling,
  and testing pattern for SQLite-backed data modules, established by
  `src/db/`.
- [Browser Screens](browser-screens.md) — how client-side code in `public/` is
  written: no framework or build step, logic split from DOM wiring, and the
  `textContent`-only rule for untrusted text.
- [Repository Sharing](repository-sharing.md) — the Git boundary for local
  data and the reproducible local setup path.
