# Architecture

> Created by `/spec-init` on 2026-08-28. Keep this file focused on durable
> system structure and update it when major architecture changes land.

## Overview

A local, single-user WorkDay reporting dashboard app: a Node.js/TypeScript
backend with a SQLite database, a local Express web server, and a
browser-based UI (no frontend framework). Currently implements the data
foundation, the WorkDay import screen, the Headcount Dashboard, the Employee
Details screen, and manual Contractor Management — see
[specs/docs/domains/index.md](docs/domains/index.md) for the full picture.

## Tech Stack

| Area | Technology | Evidence |
| ---- | ---------- | -------- |
| Runtime | Node.js >= 22, TypeScript, ESM (`"type": "module"`) | `package.json` |
| Database | SQLite via `better-sqlite3` | `src/db/`, `package.json` |
| Web server | Express | `src/server/app.ts`, `package.json` |
| File upload | Multer | `src/server/app.ts`, `package.json` |
| Spreadsheet parsing | ExcelJS | `src/import/parseWorkbook.ts`, `package.json` |
| ZIP inspection | yauzl | `src/server/zipPreflight.ts`, `package.json` |
| Browser launch | `open` | `src/server/start.ts`, `package.json` |
| UI | Plain HTML + vanilla JS, no framework | `public/index.html` |
| Tests | Node's built-in `node:test`, run via `tsx` | `package.json`, `test/` |

## Repository Structure

| Path | Purpose |
| ---- | ------- |
| `src/db/` | SQLite schema and typed data-access layer (spec 001) |
| `src/import/` | WorkDay `.xlsx` parsing and database reconciliation (spec 002) |
| `src/server/` | Express app, upload handling, and the `npm start` entry point (spec 002) |
| `public/` | The browser UI: one HTML page per screen, plus DOM-independent logic modules (specs 003, 004) |
| `test/db/`, `test/import/`, `test/server/`, `test/dashboard/`, `test/employeeDetails/`, `test/contractors/` | Tests, one file per feature area |
| `data/` | Runtime SQLite file and temp uploads (gitignored, created on first `npm start`) |
| `specs/` | Spec-driven development workspace |

## Entry Points

| Entry Point | Purpose |
| ----------- | ------- |
| `npm start` (`src/server/start.ts`) | Bootstraps the database and starts the local web server |
| `npm test` | Runs the full test suite |

## Open Questions

- No lint configuration exists yet.
