# Project Guidelines

> Created by `/spec-init` on 2026-08-28. Update this file when project rules,
> commands, or conventions change.

## Development Commands

| Task | Command | Notes |
| ---- | ------- | ----- |
| Install | `npm install` | |
| Start | `npm start` | Runs `src/server/start.ts` — bootstraps `data/employees.sqlite` and opens `http://127.0.0.1:3200`, which lands on Headcount when active people exist and Import otherwise |
| Test | `npm test` | Node's built-in test runner via the `tsx` loader (`test/**/*.test.ts`) |
| Lint | `TBD` | No lint configuration exists yet |
| Build | `npm run build` | `tsc -p tsconfig.json` |
| Typecheck | `npm run typecheck` | `tsc --noEmit` |

## Working Rules

- Follow existing code patterns before introducing new abstractions.
- Keep changes scoped to the requested feature or spec.
- Do not overwrite user work or unrelated local changes.
- Document spec deviations in the relevant spec folder.

## Testing Expectations

- Establish the current test baseline before implementation work.
- Add or update tests for changed behavior where the project has a test pattern.
- Record commands and results in implementation summaries.

## Spec Workflow

- Jira-backed features may optionally use `/scope-feature <issue>` to gather
  delivery issue, Epic, PRD, and estate context before spec writing. It responds in-chat
  unless `--write` is explicitly requested.
- Feature specs are created by `/spec-write` under
  `specs/features/{number}-{short-title}/spec.md`.
- Architecture context lives in `specs/ARCHITECTURE.md`.
- Project rules live in `specs/PROJECT_GUIDELINES.md`.
- Implementation summaries live beside their spec as `implementation-summary.md`
  until `/spec-close --consolidate` optionally rewrites their vital outcomes
  into a concise as-built `spec.md`.
- Completed implementations are reviewed beside their spec in
  `implementation-review.md` before closure; vital review outcomes may also be
  curated into `spec.md` during consolidation.

## Open Questions

- No lint configuration exists yet.
