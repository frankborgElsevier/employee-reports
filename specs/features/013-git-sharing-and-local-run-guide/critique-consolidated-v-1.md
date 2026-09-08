# Spec 013: Consolidated Critique (v1)

## Overview

**Critiques received from:** Main-agent critique

**Critiques missing:** Codex CLI critique — the nested read-only invocation could not use its state database and then refused because this directory has not yet been initialized as a trusted Git repository. Claude CLI critique — the installed client is not logged in.

## Executive Summary

The spec accurately captures the requested local-only sharing model and the current application startup behavior. One material hardening change is needed before implementation: the ignore policy must cover generic `.db` database files and their sidecars in addition to the existing `.sqlite` family, because the user explicitly requires that databases not be shared. The implementation should also make the first staging audit explicit and retain the lockfile.

## Consolidated Requirements Feedback

### Database-file coverage

**Issue:** FR-1.3 names `*.sqlite` and its sidecars but does not explicitly exclude generic SQLite files ending in `.db`.

**Agreement:** The user has clearly required that the database not be shared; the current database happens to be `employees.sqlite`, but the policy should remain safe if the filename or test/runtime convention changes.

**Divergence:** None.

**Recommendation:** Amend FR-1.3 and the matching verification rule to add `*.db`, `*.db-wal`, `*.db-shm`, and `*.db-journal` to the ignore policy. Retain the broader `data/` rule as the primary protection for the current runtime location.

### Initial staging audit

**Issue:** The required audit is described but a hurried implementation could stage all files without reviewing exactly what Git will receive.

**Agreement:** `package-lock.json` is source metadata and should remain tracked, while installed packages and generated output must remain ignored.

**Divergence:** None.

**Recommendation:** Use `git status --short` and `git diff --cached --name-only` after staging, alongside the `git check-ignore -v` checks in the spec. Explicitly inspect the staged result before the first shared commit.

### README accuracy

**Issue:** Generic Node setup documentation often adds an `.env` setup step or accidentally describes a network-reachable server.

**Agreement:** The current app requires neither an environment file nor remote access. It binds to `127.0.0.1:3200`, creates its own local database, and opens the browser when possible.

**Divergence:** None.

**Recommendation:** State that no environment file is required today, preserve the instruction that future `.env*` files are local-only, and use the literal fallback URL `http://127.0.0.1:3200`.

## Additional Requirements Identified

- Add generic `.db` and `.db` sidecar patterns to the `.gitignore` requirements and acceptance checks.

## Ambiguities Requiring Clarification

None. The user has decided that no sanitized workbook, sample spreadsheet, or template should be committed.

## Summary of Required Changes

1. Add `*.db`, `*.db-wal`, `*.db-shm`, and `*.db-journal` to the planned ignore policy and verification criteria.
2. During implementation, inspect the exact staged file list before the initial shared commit and preserve `package-lock.json`.
3. Keep the README's setup and access statements aligned with the loopback-only, no-`.env` runtime behavior.
