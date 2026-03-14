# Roadmap: NodeGuard

## Overview

NodeGuard ships as a five-phase pipeline build. Each phase delivers a coherent, independently testable capability: the typed foundation and lockfile parser come first because every other component depends on them; vulnerability querying and semver matching come second because they are the highest-correctness-risk stage; CLI output third to complete a working scan-and-report MVP; GitHub PR creation fourth as the core differentiator; and the optional local web UI last because it depends on the full pipeline being stable.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - TypeScript project scaffolding, shared types, and local lockfile parsing
- [ ] **Phase 2: Vulnerability Engine** - OSV.dev querying, semver matching, and transitive dependency attribution
- [ ] **Phase 3: CLI Output** - Terminal table, JSON output, and end-to-end scan-and-report MVP
- [ ] **Phase 4: GitHub Integration** - Authenticated PR creation per vulnerability with interactive confirmation
- [ ] **Phase 5: Web UI** - Local Fastify dashboard with severity chart and PR trigger

## Phase Details

### Phase 1: Foundation
**Goal**: A working TypeScript project that accepts a local path, reads and parses `package-lock.json` in all three format versions, and produces a typed dependency map ready for the vulnerability engine.
**Depends on**: Nothing (first phase)
**Requirements**: SCAN-01, SCAN-03
**Success Criteria** (what must be TRUE):
  1. User can run `nodeguard ./my-project` and the tool locates and reads `package.json` and `package-lock.json` without error
  2. The tool correctly extracts all dependencies from lockfile v1, v2, and v3 formats (verified by running against test fixture projects)
  3. The TypeScript project builds without errors and the CLI binary is executable on macOS, Linux, and Windows paths
**Plans**: TBD

### Phase 2: Vulnerability Engine
**Goal**: The tool queries OSV.dev for all extracted packages, constructs correct semver ranges from OSV events arrays, matches installed versions against vulnerable ranges, and produces a typed `VulnMatch[]` result including direct/transitive classification.
**Depends on**: Phase 1
**Requirements**: SCAN-04, SCAN-05, VULN-01, VULN-02, VULN-03, VULN-04
**Success Criteria** (what must be TRUE):
  1. Tool queries OSV.dev in a single batch call and returns vulnerability matches for a known-vulnerable test project
  2. Each match includes severity (Critical/High/Medium/Low), CVE/GHSA ID, installed version, and recommended fix version
  3. A pre-release version (e.g., `2.0.0-beta.1`) is correctly flagged as vulnerable when it falls in a known range
  4. A non-contiguous vulnerable range (multiple introduced/fixed pairs) is correctly handled without false negatives or false positives
  5. Each finding is classified as `direct` or `transitive` and transitive findings include the dependency chain
**Plans**: TBD

### Phase 3: CLI Output
**Goal**: The tool produces a readable terminal table by default and machine-readable JSON with `--json`, completing the scan-and-report flow end to end from local path to formatted output.
**Depends on**: Phase 2
**Requirements**: RPRT-01, RPRT-02, RPRT-03
**Success Criteria** (what must be TRUE):
  1. Running `nodeguard ./my-project` against a known-vulnerable project prints a formatted table with package name, severity, CVE/GHSA ID, installed version, and fix version
  2. Running `nodeguard ./my-project --json` outputs valid JSON to stdout and no spinner or color codes pollute the output
  3. Transitive vulnerabilities show the `transitive` label and the dependency chain in the report
**Plans**: TBD

### Phase 4: GitHub Integration
**Goal**: Users can select which vulnerabilities to fix, confirm, and have the tool create a GitHub PR per fix — with a preflight token check, interactive selection, branch creation, `package.json` version bump, and commit — for direct dependencies only.
**Depends on**: Phase 3
**Requirements**: SCAN-02, GITH-01, GITH-02, GITH-03, GITH-04, GITH-05
**Success Criteria** (what must be TRUE):
  1. User can scan a GitHub repo URL directly (`nodeguard https://github.com/user/repo`) without cloning locally
  2. Tool refuses to create PRs when `GITHUB_TOKEN` is missing or lacks required permissions, and shows a specific actionable error message
  3. User sees the full vulnerability report, can select which direct-dependency vulnerabilities to fix, and no changes are made before confirmation
  4. For each confirmed fix, a branch is created, `package.json` is updated with the new version, and a GitHub PR is opened
  5. Transitive-only vulnerabilities appear in the report but the tool does not attempt to create a PR for them
**Plans**: TBD

### Phase 5: Web UI
**Goal**: Users can launch a local browser dashboard with `--ui` that visualizes all vulnerabilities grouped by severity with a chart and allows PR creation per vulnerability from the browser.
**Depends on**: Phase 4
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. Running `nodeguard ./my-project --ui` starts a local server and automatically opens the browser dashboard
  2. The dashboard shows all vulnerabilities grouped by severity and includes a severity breakdown chart
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/TBD | Not started | - |
| 2. Vulnerability Engine | 0/TBD | Not started | - |
| 3. CLI Output | 0/TBD | Not started | - |
| 4. GitHub Integration | 0/TBD | Not started | - |
| 5. Web UI | 0/TBD | Not started | - |
