# Project Research Summary

**Project:** NodeGuard
**Domain:** Node.js dependency vulnerability scanning CLI tool
**Researched:** 2026-03-14
**Confidence:** MEDIUM (versions from training data; architectural decisions HIGH)

## Executive Summary

NodeGuard is a Node.js CLI tool that scans a project's dependency tree for known vulnerabilities and, uniquely among free tools, creates GitHub pull requests to fix them automatically. The recommended approach is a strict pipeline architecture — input → parse → query → match → report → act — where each stage has typed boundaries and no stage knows about stages beyond its immediate predecessor. This design enables independent unit testing of every component and means the optional local web UI is a parallel rendering layer on top of the same pipeline, not a separate system.

The stack is deliberately minimal and modern: commander for CLI parsing, @inquirer/prompts for interactive prompts, chalk/cli-table3/ora for terminal output, native Node.js fetch (Node >= 18 required), the semver package for version matching, @octokit/rest for GitHub operations, and Fastify for the optional local web server. All are ESM-compatible and TypeScript-ready. The tool's key competitive advantage is zero-account-required operation via OSV.dev as its primary vulnerability database, with NVD as an optional secondary source.

The highest risks are correctness-related: semver range construction from OSV.dev's events schema is non-trivial and demands explicit unit tests covering pre-release handling, non-contiguous ranges, and the `fixed` vs `last_affected` boundary distinction. The second major risk is transitive dependency attribution — a vulnerable transitive package cannot be fixed by bumping a version in `package.json`, and attempting to do so produces an incorrect or crashing PR. Both risks must be addressed in the matching and PR phases before any real-world use.

## Key Findings

### Recommended Stack

The stack is well-established with predominantly HIGH confidence. The only areas requiring caution are package versions (must be verified via `npm show <pkg> version` before writing `package.json`) and the Fastify v4/v5 boundary (v5 may be stable by build time — verify). The decision to use native Node.js fetch rather than axios or got is sound: Node 18+ ships stable fetch, and NodeGuard is a developer tool where Node >= 18 is a reasonable floor.

The frontend dashboard for the `--ui` flag should be vanilla JS, not React/Vue/Svelte. The scope is a single read-mostly page (~200 lines of JS), and a framework would require a bundler, a separate build step, and bloat. Chart.js loaded from CDN handles the severity breakdown chart. The TypeScript toolchain (tsx for dev, tsup for production builds) is the current standard for Node.js CLI tools.

**Core technologies:**
- commander ^12.x: CLI framework — most-downloaded Node.js CLI library, zero runtime dependencies, maps directly to NodeGuard's command/option model
- @inquirer/prompts ^3.x: Interactive prompts — modern scoped replacement for legacy inquirer; `confirm` and `checkbox` cover the fix-selection flow
- chalk ^5.x: Terminal colors — industry standard, pure ESM, degrades gracefully
- cli-table3 ^0.6.x: Terminal tables — active fork, handles multi-column vulnerability report layout
- ora ^8.x: Spinner — standard loading indicator for async OSV.dev API calls
- semver ^7.x: Version comparison — the npm reference implementation; non-negotiable
- @octokit/rest ^20.x: GitHub API — official GitHub SDK, typed from OpenAPI spec, pure HTTP (no local git required)
- fastify ^4.x + @fastify/static ^7.x: Local web server — modern TS-native Express alternative
- TypeScript ^5.x + tsx ^4.x + tsup ^8.x: Language and build toolchain
- Vitest ^2.x + msw ^2.x: Testing — ESM-native, fetch-level HTTP mocking

### Expected Features

NodeGuard must cover all table stakes or developers will default to `npm audit`. The core differentiators — GitHub PR creation and no-account-required OSV.dev usage — are what justify building the tool at all.

**Must have (table stakes):**
- package-lock.json parsing (v1/v2/v3 formats) — without lock file traversal you cannot know exact installed versions
- Transitive and direct dependency scanning — most real CVEs live in transitive deps
- CVE/GHSA severity levels (Critical/High/Medium/Low) — triage signal is non-negotiable
- Fix version recommendation — users' first question after finding a vuln
- Terminal table output (default) and JSON output (`--json`)
- Non-zero exit code on vulnerabilities found — required for CI integration
- Minimum severity threshold flag (`--min-severity`) — avoids CI alert fatigue
- Local directory scan (`nodeguard ./my-project`)
- Dev dependency opt-out (`--production` flag)

**Should have (differentiators):**
- GitHub PR creation per vulnerability — the core reason to choose NodeGuard over `npm audit`
- Remote GitHub repo URL scan — no clone required
- OSV.dev as primary data source — zero account/API key requirement
- Interactive confirmation before any writes — builds trust, prevents accidents
- Local web UI dashboard (`--ui`) — visual severity breakdown with one-click PR creation
- npx zero-install UX

**Defer to v2:**
- yarn.lock / pnpm-lock.yaml support
- Monorepo workspace support
- NVD as secondary data source (API key complexity, rate limits)
- SARIF output format (useful for GitHub Advanced Security integration)
- Pre-PR test suite execution
- HTML report output

### Architecture Approach

NodeGuard is a pipeline tool with unidirectional data flow. The pipeline has seven layers, each producing a typed output consumed by the next: types (shared contracts) → input resolver + lockfile parser → vulnerability querier (with disk cache) → semver matcher → report layer (terminal or JSON) → GitHub integration layer. The CLI entry point (`cli.ts`) is pure orchestration — it wires layers together but contains no business logic. The web UI server is a Layer 7 parallel output layer that consumes the same `VulnMatch[]` type produced by the matcher, keeping the core pipeline unchanged.

**Major components:**
1. `src/types.ts` — shared TypeScript interfaces (`DependencyMap`, `VulnMatch`); must be written first to prevent circular imports
2. `src/parser/lockfile.ts` — converts package-lock.json (v1/v2/v3) to a flat `Map<name, version>`; must handle lockfileVersion branching
3. `src/input/resolver.ts` — normalizes local paths and remote GitHub URLs to raw file content; uses GitHub raw content API for remote repos
4. `src/vuln/querier.ts` — single POST to OSV.dev `/v1/querybatch` for all packages; wraps `src/vuln/cache.ts` for 24-hour disk caching
5. `src/semver/matcher.ts` — converts OSV events arrays to semver ranges and calls `semver.satisfies()`; most correctness risk lives here
6. `src/report/table.ts` and `src/report/json.ts` — terminal and JSON output renderers; receive only `VulnMatch[]`, know nothing about API or GitHub
7. `src/github/patch.ts` + `src/github/pr.ts` — in-memory package.json version bumper and Octokit-based branch/commit/PR creator
8. `src/server/` — Fastify server + REST API + pre-built static UI assets (built at publish time, not runtime)
9. `src/cli.ts` — argument parsing and pipeline wiring; written last

### Critical Pitfalls

1. **Semver pre-release false negatives** — a pre-release version (e.g., `2.0.0-beta.1`) does not satisfy a range like `<2.0.0` unless `{ includePrerelease: true }` is passed to `semver.satisfies()`. Always pass this option and add a dedicated test fixture.

2. **OSV events to semver range conversion errors** — non-contiguous vulnerable windows (multiple introduced/fixed pairs) must be joined with ` || `, not treated as a single range. The `last_affected` event is inclusive (`<=`) while `fixed` is exclusive (`<`). An off-by-one here either misses real vulnerabilities or flags clean versions. Build this conversion programmatically and test it with property-based tests.

3. **Transitive dependency PR creation** — a vulnerable transitive package is not in `package.json`, so attempting to bump it will either add a spurious direct dependency or crash. Classify every finding as `direct` or `transitive`, show the dependency chain for transitives, and do not auto-create PRs for transitive-only vulnerabilities in v1.

4. **Lockfile version format branching** — npm 5-6 uses `dependencies` (v1), npm 7-8 uses both (v2, prefer `packages`), npm 9+ uses `packages` only (v3). Code that only handles one format produces silent false negatives. Read `lockfileVersion` first and branch accordingly. Add fixture lockfiles for all three versions.

5. **GitHub token scope 403** — the GitHub API returns a generic `Resource not accessible by integration` 403 when a token lacks `contents: write` or `pull-requests: write`. Do a preflight `GET /repos/{owner}/{repo}` and check the `permissions` field before attempting branch or PR creation. Surface a specific, actionable error message.

## Implications for Roadmap

Based on the component build order from ARCHITECTURE.md and the pitfall phase warnings from PITFALLS.md, five phases emerge naturally from the dependency graph of the pipeline layers.

### Phase 1: Project Scaffolding and Core Pipeline Foundation
**Rationale:** Types and parsing are the foundation everything else depends on. This phase must be complete before any network code can be meaningfully tested. Cross-platform concerns (Windows path handling, SIGPIPE handling) are trivially cheap to address at scaffold time and expensive to retrofit.
**Delivers:** Working TypeScript project with lockfile parsing that produces a `DependencyMap` from local package-lock.json files; shebang CLI entry point; EPIPE handler.
**Addresses:** table stakes features — local directory scan, `--production` flag, dev/prod dependency classification
**Avoids:** lockfileVersion v1/v2/v3 format bug (Pitfall 6), Windows path handling bug (Pitfall 10), scoped package name parsing bug (Pitfall 18)

### Phase 2: Vulnerability Query and Semver Matching
**Rationale:** This is the correctness-critical core of the tool. The semver matching logic must be fully tested in isolation before any output or GitHub integration is built on top of it. Failures here silently produce wrong results.
**Delivers:** OSV.dev batch query via `/v1/querybatch`, 24-hour disk cache, semver range construction from OSV events, `VulnMatch[]` output; all matching logic covered by unit tests including pre-release and non-contiguous range fixtures.
**Uses:** native fetch, semver, msw (for HTTP mocking in tests), Vitest
**Implements:** vuln/querier.ts, vuln/cache.ts, semver/matcher.ts
**Avoids:** serial query performance bug (Pitfall 3), `versions` array incompleteness bug (Pitfall 4), pre-release false negatives (Pitfall 1), range operator conversion errors (Pitfall 2), `fixed` vs `last_affected` boundary confusion (Pitfall 12)

### Phase 3: CLI Output and Terminal UX
**Rationale:** With a working `VulnMatch[]`, the report layer and CLI wiring can be completed. This phase delivers a fully functional scan-and-report tool that passes CI integration requirements, which represents the minimum viable product.
**Delivers:** Terminal table output, JSON output mode, exit codes, `--min-severity` filter, ora spinner; `nodeguard ./path` and `nodeguard --json` work end to end.
**Uses:** chalk, cli-table3, ora, commander
**Implements:** report/table.ts, report/json.ts, cli.ts (core wiring)
**Avoids:** JSON mode stdout pollution from prompts (Pitfall 17)

### Phase 4: GitHub PR Creation
**Rationale:** GitHub integration depends on the full scan pipeline (Phase 2 + 3) being stable. Direct vs transitive classification must be solid before any PR is written. The interactive confirmation prompt and preflight token check are required for correctness and user safety.
**Delivers:** Authenticated GitHub PR creation per vulnerability, in-memory package.json version bumping, interactive confirmation prompt, GITHUB_TOKEN preflight scope check, branch-already-exists handling.
**Uses:** @octokit/rest, @inquirer/prompts
**Implements:** github/client.ts, github/patch.ts, github/pr.ts, input/resolver.ts (remote URL support)
**Avoids:** transitive dependency wrong-fix bug (Pitfall 5), devDependency section confusion (Pitfall 14), token scope 403 (Pitfall 7), branch already exists crash (Pitfall 8)

### Phase 5: Local Web UI Dashboard
**Rationale:** The `--ui` flag is a differentiator but not a gating requirement for the tool to be useful. It depends on the complete pipeline and the GitHub PR creation flow. Building it last means the API contract (`VulnMatch[]`) is stable.
**Delivers:** Fastify local server, `/api/vulns` and `/api/fix/:pkg` REST endpoints, pre-built vanilla JS dashboard with Chart.js severity breakdown, one-click PR creation from browser, auto-port selection, SIGINT/SIGTERM server cleanup.
**Uses:** fastify, @fastify/static, Chart.js (CDN), vanilla JS
**Implements:** server/index.ts, server/api.ts, src/ui/
**Avoids:** port conflict EADDRINUSE crash (Pitfall 9), zombie server process after Ctrl+C (Pitfall 9)

### Phase Ordering Rationale

- Types and parsing first because every downstream component depends on `DependencyMap` and `VulnMatch` interfaces. Changing these types later is expensive.
- Vulnerability matching second because it is the highest correctness risk in the pipeline and must be tested in isolation before output or action layers depend on it.
- CLI output third because it completes the minimum viable scan-and-report tool and validates the full pipeline end to end.
- GitHub integration fourth because it is the core differentiator but depends on stable scan output; doing it earlier means testing an unstable interface.
- Web UI last because it is additive and depends on GitHub PR creation being stable (it calls the same flow).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Vulnerability Query):** Verify OSV.dev `/v1/querybatch` is still the recommended bulk endpoint and that the response schema for `affected[].ranges` events has not changed. Confidence is MEDIUM (training data, no live verification).
- **Phase 4 (GitHub PR Creation):** Verify current GitHub fine-grained PAT scope names — `contents: write` and `pull-requests: write` are correct as of August 2025 but GitHub's PAT UI has changed multiple times. Also verify that Octokit ^20.x method signatures (`git.createRef`, `repos.createOrUpdateFileContents`) match current REST API.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Scaffolding):** TypeScript + tsup + commander toolchain is thoroughly documented and stable.
- **Phase 3 (CLI Output):** chalk + cli-table3 + ora are stable, extensively documented.
- **Phase 5 (Web UI):** Fastify v4 local server with static file serving is a well-documented pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (architecture) / MEDIUM (versions) | Package choices are well-justified; all versions are from training data (cutoff August 2025) and must be verified with `npm show <pkg> version` before writing package.json |
| Features | MEDIUM | Based on training knowledge of npm audit, Snyk CLI, OSV-Scanner, Dependabot; web research unavailable. Feature set is directionally correct but competitor capabilities may have evolved. |
| Architecture | HIGH | OSV.dev batch API, npm lockfile format, Octokit REST, semver — all stable, well-documented systems. Pipeline pattern is well-established for this class of tool. |
| Pitfalls | HIGH (logic/parsing) / MEDIUM (API behavior) | semver spec and lockfile format are stable. OSV.dev rate limits, batch endpoint limits, and GitHub PAT scope names need live verification. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **OSV.dev batch endpoint limits:** The `/v1/querybatch` endpoint has no publicly documented per-request item limit as of the knowledge cutoff. The architecture recommends chunking at 500 items as a defensive measure. Verify against current OSV.dev docs before implementing the querier.
- **nock vs msw for native fetch mocking:** nock historically patches Node's `http`/`https` modules and may not intercept native `fetch`. msw v2 is recommended as the safer alternative, but msw's Node.js MSW setup for CLI testing (not browser) requires specific setup. Verify msw v2 `setupServer` for Node usage before committing to it in Phase 2.
- **Fastify v4 vs v5:** Fastify v5 was in RC as of mid-2025 and may be stable by build time. Verify before pinning to v4 in Phase 5.
- **NVD API key requirement:** NVD is deferred to v2 in the feature plan. If it surfaces during Phase 2 planning, note that the NVD v1 API was deprecated in 2023; v2 is the only supported endpoint.

## Sources

### Primary (HIGH confidence)
- npm lockfile format: `https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json` — v1/v2/v3 structure and `packages` key format
- semver npm package: `https://github.com/npm/node-semver` — `satisfies()` API and `includePrerelease` option
- Octokit REST: `https://octokit.github.io/rest.js/` — `git.createRef`, `repos.createOrUpdateFileContents`, `pulls.create`
- Node.js 18 fetch: `https://nodejs.org/en/blog/announcements/v18-release-announce` — stable unflagged fetch API

### Secondary (MEDIUM confidence)
- OSV.dev REST API: `https://google.github.io/osv.dev/post-v1-query/` — batch query endpoint, response schema, semver range events format; needs live verification
- Fastify v4 docs: `https://www.fastify.io/docs/latest/` — MEDIUM confidence on v4 vs v5 status at build time
- msw v2 docs: `https://mswjs.io/docs/` — fetch-level interception; Node.js `setupServer` usage needs verification
- npm download statistics (commander ~130M/week, chalk ~200M/week) — directionally reliable from training data

### Tertiary (LOW confidence)
- NVD API v2 endpoint and rate limits: `https://nvd.nist.gov/developers/vulnerabilities` — MEDIUM on endpoint URL, LOW on current rate limit numbers; requires live verification before NVD integration
- OSV.dev `/v1/querybatch` item limit — not publicly documented; 500-item chunking is a defensive assumption

---
*Research completed: 2026-03-14*
*Ready for roadmap: yes*
