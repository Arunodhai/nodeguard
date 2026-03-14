# NodeGuard

## What This Is

NodeGuard is an open-source CLI tool that scans Node.js repositories for known security vulnerabilities by analyzing `package.json` and `package-lock.json` against vulnerability databases (OSV.dev, NVD). It reports vulnerable packages with severity and fix versions, then (with user confirmation) creates a GitHub PR with the version bump applied. Optionally, the CLI can launch a local web UI for a visual dashboard and one-click PR approval.

## Core Value

Developers can find and fix vulnerable Node.js dependencies in seconds — from scan to merged PR — without leaving the terminal or writing a single line of code.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] CLI accepts a local directory path or a GitHub repo URL as input
- [ ] Parses `package.json` and `package-lock.json` to extract all dependencies and exact installed versions
- [ ] Queries OSV.dev and/or NVD for known vulnerabilities matching those versions
- [ ] Compares installed versions against vulnerable version ranges; records matches with severity and recommended fix version
- [ ] Outputs a vulnerability report as a formatted terminal table (default) or JSON (`--json` flag)
- [ ] Prompts user to confirm which vulnerabilities to fix before any changes are made
- [ ] On confirmation, creates a fix branch (e.g. `fix/lodash-cve-2021-xxxx`), bumps the version in `package.json`, commits, and opens a GitHub PR
- [ ] GitHub authentication via `GITHUB_TOKEN` environment variable
- [ ] CLI can launch a local web server (`--ui` flag) that serves a vulnerability dashboard
- [ ] Browser UI shows vulnerabilities grouped by severity with charts/breakdown
- [ ] Browser UI allows one-click PR approval per vulnerability (replaces CLI confirm step)

### Out of Scope

- Running the project's own test suite before opening a PR — deferred to v2
- GitHub App OAuth installation — using GITHUB_TOKEN env var is sufficient for v1
- Hosted/cloud SaaS version — local-only for v1
- Support for yarn.lock, pnpm-lock.yaml — npm only for v1
- Auto-merging PRs — user merges manually

## Context

- Targets Node.js projects using npm as their package manager
- Vulnerability data sourced from OSV.dev (free, REST API) and optionally NVD (requires API key)
- CLI-first: the browser UI is an optional enhancement, not the primary interface
- Intended as an open-source tool that developers install globally (`npm install -g nodeguard`) or run via npx

## Constraints

- **Platform**: Node.js CLI — must work cross-platform (macOS, Linux, Windows)
- **Auth**: GitHub token passed via `GITHUB_TOKEN` env var — no OAuth flow in v1
- **Package manager**: npm only (package-lock.json) in v1
- **UI**: Local web server only — no remote hosting or persistent state

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| OSV.dev as primary vuln database | Free, no API key required, good coverage, REST API | — Pending |
| Report-then-confirm flow | Prevents unwanted PRs; user stays in control | — Pending |
| Local web server for UI (not hosted) | Keeps the tool self-contained; no auth/hosting complexity | — Pending |
| npm only in v1 | Scope control — yarn/pnpm lockfile formats differ significantly | — Pending |

---
*Last updated: 2026-03-14 after initialization*
