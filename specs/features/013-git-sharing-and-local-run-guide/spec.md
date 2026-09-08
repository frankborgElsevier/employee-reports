# Spec 013: Git Sharing and Local Run Guide

> **Status: CLOSED - IMPLEMENTED** - Verified on 2026-09-08.
> Implementation summary: `specs/features/013-git-sharing-and-local-run-guide/implementation-summary.md`
> Implementation review: `specs/features/013-git-sharing-and-local-run-guide/implementation-review.md`
> Documentation: updated in `specs/docs/`

## Overview

Prepare the WorkDay reporting dashboard for safe source-code sharing through Git without publishing employee data, WorkDay workbook exports, local databases, environment files, installed dependencies, or generated build output. Add a root README that lets a recipient check prerequisites, install dependencies, start the application, and reach it on their own localhost.

## Goals

- Prevent the project's sensitive or machine-local runtime artifacts from entering Git.
- Give a new contributor a reliable, copyable local setup and verification path.
- Make the initial Git repository creation safe and auditable.

## Feature 1: Protect local and sensitive artifacts from Git

**Who & why:** The report owner needs to share the application source with collaborators without exposing employee information, locally generated state, or exported WorkDay data. A collaborator needs Git to contain only the application and its safe development assets.

### Functional Requirements

#### FR-1.1: Exclude environment files

The root `.gitignore` excludes `.env` and all environment-file variants such as `.env.local`, `.env.development`, and `.env.production`. It does not require, create, or commit an environment-file template because the application currently has no runtime environment configuration.

**Verify:** `git check-ignore -v .env .env.local .env.production` identifies `.gitignore` as the excluding rule after Git is initialized, and no environment file is included by `git status --short`.

#### FR-1.2: Exclude WorkDay spreadsheet files

The root `.gitignore` excludes Excel workbook formats used for WorkDay exports, including `.xlsx`, `.xls`, `.xlsm`, and `.xlsb`, everywhere in the repository. The existing `workday_docs_examples/Team_Market_Range_Analysis_for_Managers–_RELX (1).xlsx` file is therefore not staged or committed, and no sanitized example, template, or sample workbook is added to replace it.

**Verify:** `git check-ignore -v 'workday_docs_examples/Team_Market_Range_Analysis_for_Managers–_RELX (1).xlsx'` reports an ignore rule, and an initial `git status --short` does not list that workbook.

#### FR-1.3: Exclude database and runtime state

The root `.gitignore` excludes the `data/` runtime directory and SQLite database files and sidecar files for both SQLite naming conventions: `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, `*.sqlite-journal`, `*.db`, `*.db-wal`, `*.db-shm`, and `*.db-journal`. This preserves the application's existing behavior: `npm start` creates `data/`, `data/tmp-uploads/`, and `data/employees.sqlite` locally on first run, while uploaded workbook data remains only on the user's machine.

**Verify:** Starting the application from a clean checkout creates the local data directory and database, and `git status --short` remains free of files within `data/` and database artifacts using either extension family.

#### FR-1.4: Retain normal dependency and build exclusions

The root `.gitignore` continues to exclude `node_modules/`, `dist/`, and `.DS_Store`, so the repository contains dependency metadata (`package.json` and `package-lock.json`) but not installed packages, generated TypeScript output, or macOS Finder metadata.

**Verify:** After `npm install` and `npm run build`, `git status --short` does not list `node_modules/` or `dist/`, while `package-lock.json` remains eligible for tracking.

#### FR-1.5: Audit before the initial shared commit

Before the first shared commit, initialize Git at the project root if it is not already initialized, inspect both `git status --short` and `git diff --cached --name-only` after staging, and confirm that no `.env*`, Excel workbook, database, `data/` content, `node_modules/`, or `dist/` content is staged. Preserve `package-lock.json` as tracked dependency metadata. If a prohibited file was previously tracked in any future working copy, it must be removed from the Git index without deleting the local file before sharing continues.

**Verify:** `git status --short` and `git diff --cached --name-only` show no prohibited path and include `package-lock.json` when it is staged; the local application still opens with its existing local data after any index-only removal.

### Architectural Requirements

#### AR-1.1: Keep the ignore policy at the repository root

Maintain one root `.gitignore` as the authoritative share-safety policy. Its rules must be path-independent for environment files and WorkDay workbook extensions, while retaining the existing directory-level rule for `data/` that aligns with `src/server/start.ts`.

#### AR-1.2: Do not alter runtime data ownership

Do not change `src/server/start.ts`, `src/server/app.ts`, or the SQLite/import architecture solely for Git packaging. The server remains bound to loopback (`127.0.0.1`) on port `3200`; source control policy protects runtime output rather than moving it to a new location.

## Feature 2: Document a local installation and launch path

**Who & why:** A collaborator receiving the repository needs to determine quickly whether their computer is ready, install only the declared dependencies, and confirm that the local-only dashboard is running. Clear documentation reduces setup failures without requiring access to the report owner's data.

### Functional Requirements

#### FR-2.1: Provide a root README

Add `README.md` at the repository root that identifies the application as a local single-user WorkDay reporting dashboard. It explains that the repository intentionally excludes WorkDay workbooks, local SQLite data, and environment files, and that a user imports their own permitted WorkDay export through the application after starting it.

**Verify:** A new reader can identify the application's purpose, data-handling boundary, and the fact that no workbook sample is supplied by reading only `README.md`.

#### FR-2.2: Include prerequisite checks and installation instructions

The README states the required Node.js major version (`22` or later, matching `package.json`) and npm. It supplies commands to check both installed versions, clone the repository, change into its directory, and run `npm install`. It explains that `npm install` obtains the dependencies declared in `package-lock.json`, including the native SQLite dependency, and directs users to resolve an unsupported Node version before proceeding.

**Verify:** On a machine with Node.js 22+ and npm installed, following the README's install commands creates local dependencies and completes without requiring a committed data file, workbook, or environment file.

#### FR-2.3: Include local launch, access, and first-use instructions

The README instructs users to run `npm start`, explains that the application opens a browser automatically when possible, and gives the explicit fallback URL `http://127.0.0.1:3200`. It states that the app is intentionally accessible only from the same computer because the server binds to `127.0.0.1`, and that first launch creates a local empty SQLite database under `data/`. It directs the user to the Import screen to select their own `.xlsx` WorkDay report and notes that only appropriately authorized data should be imported.

**Verify:** A user can start the server, load `http://127.0.0.1:3200` manually if a browser does not open, see the initial Import experience, and import a permitted workbook without source-control changes.

#### FR-2.4: Include troubleshooting and verification commands

The README includes a concise troubleshooting section covering: an unsupported/missing Node or npm installation; port `3200` already in use; a browser that did not open automatically; and a failed dependency installation. It documents `npm test`, `npm run typecheck`, and `npm run build` as optional verification commands, with their purpose. It does not claim that a remote host, cloud deployment, login, or multi-user sharing is supported.

**Verify:** Each listed command matches a script in `package.json`, and the README's recovery guidance gives a local next step for each documented setup failure.

### Architectural Requirements

#### AR-2.1: Treat package metadata and startup code as documentation sources of truth

README commands and version requirements must match `package.json` scripts and `engines.node`; the localhost URL, port, local-only binding, browser-launch behavior, and data-directory creation must match `src/server/start.ts`. Do not introduce a README command that is absent from the package scripts.

#### AR-2.2: Keep the README dependency-free and platform-neutral

Use plain Markdown and shell commands that work in common terminal environments. Do not add a documentation generator, setup script, environment template, spreadsheet fixture, or third-party dependency for this packaging work.

## Data Requirements

- Git must not contain production or example WorkDay workbooks.
- Git must not contain `data/employees.sqlite`, database files or sidecars using either `.sqlite` or `.db` naming, temporary uploads, or equivalent local database state.
- Git must not contain `.env` files or their variants.
- A recipient creates their own local database on first start and supplies their own authorized import data.

## Integration Points

| Area | Relationship | Requirements |
| --- | --- | --- |
| [Spec 001: Data Foundation](../001-data-foundation/spec.md) | **References** — its SQLite runtime state is retained locally and excluded from Git. | FR-1.3, AR-1.2 |
| [Spec 002: WorkDay Import](../002-workday-import/spec.md) | **References** — its user-supplied workbook import flow is documented without committing a source workbook. | FR-1.2, FR-2.1, FR-2.3 |
| `package.json` | **References** — provides the Node version, install metadata, and verification scripts. | FR-2.2, FR-2.4, AR-2.1 |
| `src/server/start.ts` | **References** — provides the loopback URL, port, local database location, and startup behavior. | FR-1.3, FR-2.3, AR-1.2 |

## Constraints

- The application remains a local, single-user Node.js/TypeScript, Express, and SQLite application.
- The server must remain loopback-only; this work does not expose it on a network interface.
- No WorkDay spreadsheet, sanitized workbook, template, or fixture is added to the repository.
- The existing application behavior and package scripts remain unchanged unless a documentation accuracy correction requires a non-functional adjustment.
- Git initialization and commits are performed only by an authorized user action; this spec defines the safe preparation and audit process.

## Out of Scope

- Remote hosting, cloud deployment, containers, CI/CD, or publication to a package registry.
- Authentication, authorization, multi-user access, or sharing the local dashboard over a network.
- Creating, sharing, or redacting a WorkDay sample spreadsheet.
- Adding runtime environment configuration or an `.env.example` file.
- Migrating, backing up, or distributing a user's local SQLite data.
- Changing WorkDay import mapping, dashboards, contractor behavior, or the database schema.

## Spec Completeness Checklist

- [x] **Scope & acceptance criteria** — FR-1.1–FR-1.5 and FR-2.1–FR-2.4 define the protected artifacts, audit, README content, and verifiable outcomes.
- [x] **Testing strategy** — each FR includes a verification condition; the README additionally documents the existing test, typecheck, and build commands.
- [x] **Existing patterns** — AR-1.2 and AR-2.1 use the established `data/` runtime directory, startup entry point, package scripts, and loopback binding.
- [x] **Dependencies** — AR-2.2 requires no new dependencies; `npm install` uses the existing lockfile.
- [x] **Architecture & interfaces** — AR-1.1–AR-2.2 define the repository-policy boundary and ensure documentation reflects existing runtime interfaces.
- [x] **Error handling & failure modes** — FR-1.5 handles accidental staging and FR-2.4 covers prerequisite, installation, port, and browser-launch failures.
- [x] **Security review** — FR-1.1–FR-1.5 prevent accidental exposure of local configuration, employee data, uploaded exports, and databases; FR-2.3 retains loopback-only access.
- [x] **Performance impact** — this is repository and documentation work; it adds no runtime processing, network traffic, or persistent application data.
- [x] **Rollout & migration** — FR-1.5 defines the initial Git audit and index-only remedy for accidentally tracked files without changing local data.
- [x] **Assumptions & risks** — constraints and out-of-scope sections record the local-only model, no committed workbook decision, and the absence of environment configuration.

---

## Change Log

### Update from critique-consolidated-v-1.md

**Applied:**

- Expanded FR-1.3 and Data Requirements to exclude generic `.db` database files and their sidecars as well as the existing `.sqlite` family.
- Made the first-commit audit require review of both unstaged and staged file lists, while preserving `package-lock.json` as tracked dependency metadata.
- Retained the existing loopback-only, no-environment-file README requirements after verifying them against `src/server/start.ts`.

**Rejected:**

- None.

**Reorganized:**

- Integrated the critique changes into their existing requirements and data section; no structural reorganization was needed.
