# Feature Landscape

**Domain:** Node.js dependency vulnerability scanning CLI tool
**Project:** NodeGuard
**Researched:** 2026-03-14
**Confidence note:** Web search and WebFetch tools were unavailable during this research session. All findings draw from training knowledge (cutoff August 2025) of npm audit, Snyk CLI, Socket.dev, OSV-Scanner, OWASP Dependency-Check, and Dependabot. Confidence is MEDIUM unless otherwise noted.

---

## Table Stakes

Features users expect in any vulnerability scanner. Missing one of these and developers will reach for npm audit or Snyk instead.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Direct dependency scanning | Every scanner does this; it is the baseline | Low | Parse package.json, query vuln DB |
| Transitive (indirect) dependency scanning | Most real CVEs live in transitive deps (e.g., lodash buried 3 levels deep) | Medium | Requires full lock-file traversal, not just top-level package.json |
| Dev dependency scanning (opt-in/opt-out) | Developers expect control over this; CI pipelines often exclude devDeps | Low | `--production` flag to exclude, scan all by default |
| CVE/GHSA severity levels (Critical/High/Medium/Low) | Users need triage signal — all scanners show CVSS severity | Low | Map OSV severity to CVSS scale |
| Fix version recommendation | "What version should I upgrade to?" is the first question after finding a vuln | Low | OSV.dev `fixed` ranges provide this |
| Terminal table output (default) | Developers expect human-readable output at the terminal without extra flags | Low | columnar table with package, severity, CVE ID, fix version |
| JSON output flag | Required for CI pipelines and scripting (`--json`) | Low | Machines consume this; humans use table |
| Exit code on vulnerabilities found | CI integration requires non-zero exit on findings — npm audit does this | Low | Exit 1 when vulns found, 0 when clean |
| Minimum severity threshold flag | `--min-severity high` to fail CI only on High/Critical | Low | Filter both output and exit code |
| Scan a local directory | Core use case: `nodeguard ./my-project` | Low | Accept path arg |
| package-lock.json parsing | Lock file gives exact installed versions — without it you can't be precise | Medium | npm lock format v2/v3 differ slightly |

---

## Differentiators

Features that set NodeGuard apart from running `npm audit` or `snyk test`. These are the reasons a developer would install this tool instead.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| GitHub PR creation from CLI | npm audit tells you there's a problem; NodeGuard fixes it — scan to PR in one command | High | Requires GitHub API, branch management, commit authoring |
| Scan a remote GitHub repo URL | No clone required — `nodeguard https://github.com/org/repo` | Medium | Fetch package.json + package-lock.json via GitHub raw content API |
| Interactive confirmation before any writes | Prevents accidents; builds trust with cautious developers | Low | tty prompt listing what will be changed before touching anything |
| Per-vulnerability PR (one PR per CVE) | Granular — reviewer can approve/reject individual fixes rather than a bundled mega-PR | Medium | Requires branching strategy; contrast with Dependabot's grouped PRs |
| OSV.dev as primary data source (no API key) | npm audit requires npm registry; Snyk requires account; OSV.dev is free and keyless | Low | Lower barrier to adoption; works in air-gap-adjacent scenarios |
| Local web UI dashboard (`--ui` flag) | Visual severity breakdown with charts; one-click PR approval via browser | High | Local Express/Fastify server + minimal SPA; no hosted infra needed |
| Dual database (OSV.dev + NVD) | OSV has better npm coverage; NVD has CVSS scores and broader enterprise recognition | Medium | NVD requires API key; make it opt-in |
| Severity breakdown chart in UI | At a glance: how many Critical vs High vs Medium — answers "how bad is this repo?" | Medium | Pie/bar chart in browser UI; not available in CLI peers |
| npx zero-install UX | `npx nodeguard .` — no global install required | Low | Package structure must support clean npx invocation |

---

## Anti-Features

Features to deliberately NOT build in v1 — either scope traps, complexity sinks, or things that undermine the tool's focus.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-merge PRs | Removes human review step; dangerous if fix version introduces breaking changes | Open PR and stop — user merges |
| yarn.lock / pnpm-lock.yaml support | Fundamentally different lock-file formats; adds significant parsing complexity with no v1 benefit | npm only; document clearly; add in v2 |
| Hosted/cloud SaaS dashboard | Turns a CLI tool into a product company — auth, data residency, uptime, billing | Local-only web server |
| GitHub App OAuth flow | Complex setup UX; enterprise OAuth has edge cases | GITHUB_TOKEN env var is universally understood |
| Running the project's test suite before PR | Adds dependency on the target project's environment; out of scope for a vulnerability tool | Defer to v2; CI will run tests on the PR anyway |
| License compliance scanning | Separate domain (license risk vs security risk); different databases; scope creep | Out of scope entirely |
| Code-level vulnerability scanning (SAST) | Entirely different technology (AST analysis); not a dependency scanner | Out of scope entirely |
| Bundled vulnerability database (offline mode) | DB goes stale immediately; maintenance burden is enormous | Always query OSV.dev live |
| Slack/Teams/webhook notifications | Useful in theory; adds integration surface area for little CLI benefit | Not needed for v1; OSV.dev already has feeds |
| Monorepo workspace support | npm workspaces require recursive scanning across subpackages; significant complexity | Single-package npm project only in v1 |

---

## Feature Dependencies

```
parse package-lock.json
    → extract all installed versions (direct + transitive)
        → query OSV.dev API (per package)
            → compare versions to vulnerable ranges
                → build vulnerability report (severity, fix version, CVE ID)
                    → terminal table output (default)
                    → JSON output (--json flag)
                    → exit code (non-zero if vulns found)
                    → severity threshold filter (--min-severity)
                    → interactive confirmation prompt
                        → create fix branch + bump version + commit
                            → open GitHub PR via API
                    → launch local web UI (--ui flag)
                        → browser dashboard with severity chart
                        → one-click PR trigger (calls same PR creation flow)

scan remote GitHub repo URL
    → fetch package.json + package-lock.json via GitHub API
        → (same flow as local scan from parse step onward)

NVD integration (optional)
    → requires GITHUB_TOKEN equivalent for NVD
    → augments OSV.dev results with CVSS scores
    → NOT a replacement for OSV.dev, an addition
```

---

## MVP Recommendation

Build in this priority order to deliver value at each milestone boundary:

**Must ship in v1 (table stakes + core differentiator):**
1. package-lock.json parsing — transitive + direct deps
2. OSV.dev vulnerability query
3. Terminal table report with severity
4. JSON output (`--json`)
5. Exit code on findings
6. Minimum severity threshold (`--min-severity`)
7. Interactive confirmation prompt
8. GitHub PR creation per vulnerability
9. Remote GitHub repo URL scan

**Ship in v1 if capacity allows (differentiators):**
10. Local web UI dashboard (`--ui`)
11. NVD as optional secondary source

**Defer to v2:**
- yarn/pnpm support
- Monorepo workspace support
- Pre-PR test suite run
- SARIF output format (useful for GitHub Advanced Security integration)
- HTML report output

---

## Comparator Feature Matrix

How NodeGuard compares to existing tools on planned features:

| Feature | npm audit | Snyk CLI | Socket.dev | OSV-Scanner | NodeGuard (planned) |
|---------|-----------|----------|------------|-------------|---------------------|
| Transitive dep scan | Yes | Yes | Yes | Yes | Yes |
| Terminal table output | Yes | Yes | Yes | Yes | Yes |
| JSON output | Yes | Yes | Yes | Yes | Yes |
| Exit code on vulns | Yes | Yes | Yes | Yes | Yes |
| Severity threshold | Yes | Yes | Yes | Yes | Yes |
| Remote GitHub URL scan | No | No | Yes (via web) | No | Yes |
| Auto PR creation | No | Yes (Fix PRs) | No | No | Yes |
| Local web UI | No | No | Yes (cloud only) | No | Yes (local only) |
| No account required | Yes | No | No | Yes | Yes |
| OSV.dev data source | No | No | No | Yes | Yes |
| SARIF output | No | Yes | No | Yes | No (v2) |
| Monorepo support | Yes | Yes | Yes | Yes | No (v2) |

---

## SARIF Output — Deferred Feature Note

SARIF (Static Analysis Results Interchange Format) is the output format consumed by GitHub Advanced Security (Code Scanning). OSV-Scanner and Snyk both emit it. It is useful for surfacing vulnerability findings inline in GitHub pull request reviews. NodeGuard should add this in v2 when the core scan + PR flow is stable. The complexity is low (it is just a JSON schema), but it is not critical for the CLI's primary value proposition.

---

## Sources

All findings based on training knowledge (cutoff August 2025) of the following tools. Web research was unavailable during this session. Confidence: MEDIUM throughout.

- npm audit CLI (npm v10 documentation — docs.npmjs.com)
- Snyk CLI documentation (snyk.io/docs/snyk-cli)
- Socket.dev feature set (socket.dev)
- Google OSV-Scanner (github.com/google/osv-scanner)
- OWASP Dependency-Check documentation
- GitHub Dependabot documentation
- OSV.dev REST API (osv.dev)
- NVD API v2.0 documentation (nvd.nist.gov)
