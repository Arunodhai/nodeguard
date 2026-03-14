# Requirements: NodeGuard

**Defined:** 2026-03-14
**Core Value:** Developers can find and fix vulnerable Node.js dependencies in seconds — from scan to merged PR — without leaving the terminal or writing a single line of code.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Scanning

- [ ] **SCAN-01**: User can scan a local Node.js project directory by passing a path (`nodeguard ./my-project`)
- [ ] **SCAN-02**: User can scan a remote GitHub repository by passing a URL without cloning (`nodeguard https://github.com/user/repo`)
- [ ] **SCAN-03**: Tool parses `package-lock.json` v1, v2, and v3 formats to extract all dependencies with exact installed versions
- [ ] **SCAN-04**: Tool scans direct dependencies (listed in `package.json`)
- [ ] **SCAN-05**: Tool scans transitive (indirect) dependencies from the lockfile

### Vulnerability Data

- [ ] **VULN-01**: Tool queries OSV.dev batch API (`/v1/querybatch`) as primary vulnerability data source — no API key required
- [ ] **VULN-02**: Tool queries NVD API as secondary vulnerability data source when `NVD_API_KEY` env var is present
- [ ] **VULN-03**: Tool compares installed versions against vulnerable version ranges and records matches with severity (Critical/High/Medium/Low), CVE/GHSA ID, and recommended fix version
- [ ] **VULN-04**: Tool correctly handles pre-release versions and non-contiguous vulnerability windows in version range matching

### Reporting

- [ ] **RPRT-01**: Tool outputs a formatted terminal table showing package name, severity, CVE/GHSA ID, installed version, and fix version
- [ ] **RPRT-02**: User can get machine-readable JSON output with `--json` flag
- [ ] **RPRT-03**: Tool labels each finding as `direct` or `transitive` and shows the dependency chain for transitive vulnerabilities

### GitHub Integration

- [ ] **GITH-01**: Tool authenticates with GitHub via `GITHUB_TOKEN` environment variable
- [ ] **GITH-02**: Tool performs a preflight check that the GitHub token has `contents: write` and `pull-requests: write` permissions and shows a specific, actionable error message if not
- [ ] **GITH-03**: User is shown the full vulnerability report and can select which vulnerabilities to fix before any changes are made
- [ ] **GITH-04**: For each confirmed direct-dependency fix, tool creates a branch (e.g. `fix/lodash-cve-2021-xxxx`), bumps the version in `package.json`, commits, and opens a GitHub PR
- [ ] **GITH-05**: Tool does not attempt to auto-fix transitive-only vulnerabilities via PR — it reports them with the dependency chain but does not modify files

### Web UI

- [ ] **UI-01**: User can launch a local web dashboard with `--ui` flag that starts a local server and opens the browser automatically
- [ ] **UI-02**: Browser dashboard shows all vulnerabilities grouped by severity with a severity breakdown chart

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### CLI Polish

- **CLI-01**: Tool exits with non-zero exit code when vulnerabilities are found (CI pipeline integration)
- **CLI-02**: `--min-severity` flag filters report and exit code to a minimum severity level (avoids alert fatigue)
- **CLI-03**: `--production` flag excludes devDependencies from scan results
- **CLI-04**: 24-hour disk cache for OSV.dev and NVD API responses (faster re-runs)

### Web UI

- **UI-03**: One-click PR approval in browser dashboard (replaces CLI confirm step)

### Extended Ecosystem

- **SCAN-06**: Support for `yarn.lock` files
- **SCAN-07**: Support for `pnpm-lock.yaml` files
- **SCAN-08**: Monorepo / npm workspace support
- **RPRT-04**: SARIF output format (`--sarif`) for GitHub Advanced Security integration
- **RPRT-05**: HTML report output
- **GITH-06**: Run project's own test suite (`npm test`) before opening PR; abort if tests fail

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hosted/cloud SaaS version | Adds backend, auth, database complexity — local-only for v1 |
| GitHub App OAuth installation | GITHUB_TOKEN env var is sufficient for v1 |
| Auto-merging PRs | User must merge manually — prevents unreviewed changes landing |
| Direct commit to default branch | Branch + PR is the safe, reviewable default |
| yarn.lock / pnpm-lock.yaml (v1) | npm only for v1 — lockfile formats differ significantly |
| NVD without API key | NVD v2 rate limits unauthenticated requests to 5/30s — unusable at scale |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCAN-01 | Phase 1 | Pending |
| SCAN-02 | Phase 4 | Pending |
| SCAN-03 | Phase 1 | Pending |
| SCAN-04 | Phase 2 | Pending |
| SCAN-05 | Phase 2 | Pending |
| VULN-01 | Phase 2 | Pending |
| VULN-02 | Phase 2 | Pending |
| VULN-03 | Phase 2 | Pending |
| VULN-04 | Phase 2 | Pending |
| RPRT-01 | Phase 3 | Pending |
| RPRT-02 | Phase 3 | Pending |
| RPRT-03 | Phase 3 | Pending |
| GITH-01 | Phase 4 | Pending |
| GITH-02 | Phase 4 | Pending |
| GITH-03 | Phase 4 | Pending |
| GITH-04 | Phase 4 | Pending |
| GITH-05 | Phase 4 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 after initial definition*
