# Repository Sharing

The project is a local, single-user application. Git contains portable source,
dependency metadata, documentation, and tests—not local WorkDay data or
runtime state.

## Shareable and local-only files

The root [.gitignore](../../../.gitignore) excludes installed dependencies and
build output, the complete `data/` runtime directory, environment-file
variants, WorkDay Excel workbook formats, SQLite files and sidecars using
either `.sqlite` or `.db`, macOS Finder metadata, and the local Claude
permission file. `package.json` and [package-lock.json](../../../package-lock.json)
remain tracked so a collaborator can reproduce the declared dependencies.

Before an initial shared commit, stage the intended project files, inspect
`git status --short` and `git diff --cached --name-only`, and confirm that no
local-only path is staged. If a local-only path is already tracked, remove it
from the Git index without deleting the local file.

## Local setup

[README.md](../../../README.md) is the user-facing setup guide. It requires
Node.js 22 or later and npm, then uses `npm install` and `npm start`. The
application attempts to open a browser and is available at
`http://127.0.0.1:3200`; [src/server/start.ts](../../../src/server/start.ts)
binds only to that loopback address and creates the local `data/` directory and
SQLite database on first launch.

No environment file or sample WorkDay workbook is required or provided. Users
import their own authorized `.xlsx` export through the running application.

## Provenance

- [Spec 013: Git Sharing and Local Run Guide](../../features/013-git-sharing-and-local-run-guide/spec.md)
