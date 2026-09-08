# Architectural Decision Records: 013-git-sharing-and-local-run-guide

## ADR-001: Exclude local Claude permission settings from the shared repository

- **Date:** 2026-09-08
- **Status:** Accepted
- **Context:** The first staged-file audit found `.claude/settings.local.json`. It contains machine-specific tool-permission paths and commands, so it is not application source or portable project configuration.
- **Decision:** Add an exact root `.gitignore` rule for `/.claude/settings.local.json` and remove the already staged copy from Git's index without deleting the local file.
- **Rationale:** The user requested a shareable Git package and instructed that ignore rules be added as needed. Excluding this local permission configuration prevents disclosure of workstation-specific paths and avoids imposing one user's assistant permissions on collaborators.
- **Consequences:** Each contributor keeps their own local Claude permission settings. No shared Claude configuration is provided by this repository.
