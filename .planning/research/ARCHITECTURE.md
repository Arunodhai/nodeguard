# Architecture Patterns

**Project:** NodeGuard
**Domain:** Node.js security/vulnerability CLI tool
**Researched:** 2026-03-14
**Confidence:** HIGH (OSV.dev API, npm lockfile format, GitHub API, semver — all stable, well-documented systems)

---

## Recommended Architecture

NodeGuard is a pipeline-oriented CLI tool. Data flows in one direction: **input → parse → query → match → report → act**. The optional web UI is a parallel rendering layer on top of the same data pipeline, not a separate system.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                          │
│  src/cli.ts   (argument parsing, command routing, env loading)  │
└────────────────────────────┬────────────────────────────────────┘
                             │ resolved InputSpec
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Input Resolver                            │
│  src/input/resolver.ts  (local path | GitHub repo URL → disk)   │
└────────────────────────────┬────────────────────────────────────┘
                             │ { packageJson, lockfile } raw text
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Lockfile Parser                            │
│  src/parser/lockfile.ts  (package-lock.json → DependencyMap)    │
└────────────────────────────┬────────────────────────────────────┘
                             │ DependencyMap: Map<name, version>
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Vulnerability Query Layer                     │
│  src/vuln/querier.ts   (batch POST to OSV.dev /v1/querybatch)   │
│  src/vuln/cache.ts     (filesystem cache, TTL-based)            │
│  src/vuln/nvd.ts       (optional NVD fallback, requires key)    │
└────────────────────────────┬────────────────────────────────────┘
                             │ RawVulnResponse[]
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Version Comparison Engine                     │
│  src/semver/matcher.ts  (semver ranges → VulnMatch[])           │
└────────────────────────────┬────────────────────────────────────┘
                             │ VulnMatch[]: { pkg, installedVer,
                             │   cve, severity, fixedIn }
                             ▼
┌──────────────────────┬──────────────────────────────────────────┐
│   CLI Report Layer   │        Web UI Server (optional)          │
│  src/report/table.ts │  src/server/index.ts  (Express/Fastify)  │
│  src/report/json.ts  │  src/server/api.ts    (/api/vulns)        │
│  (terminal output)   │  src/ui/             (Vite + React SPA)  │
└──────────┬───────────┴──────────────────────────────────────────┘
           │ user selection (CLI prompt OR web UI action)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Integration Layer                     │
│  src/github/client.ts  (Octokit REST wrapper)                   │
│  src/github/pr.ts      (branch → commit → PR)                   │
│  src/github/patch.ts   (package.json version bumper)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Input | Output | Communicates With |
|-----------|---------------|-------|--------|-------------------|
| `cli.ts` | Parse argv, load env, route commands | `process.argv`, env | `InputSpec` | Input Resolver, Report Layer, Server |
| `input/resolver.ts` | Normalize local path or clone GitHub URL to temp dir | `InputSpec` | `{ packageJson, lockfile }` as strings | Lockfile Parser |
| `parser/lockfile.ts` | Parse `package-lock.json` into flat dependency map | Raw `package-lock.json` JSON | `DependencyMap` | Vuln Query Layer |
| `vuln/querier.ts` | Batch-query OSV.dev API for all packages | `DependencyMap` | `RawVulnResponse[]` | Cache, NVD fallback |
| `vuln/cache.ts` | Cache API responses on disk with TTL | Cache key + TTL | Cached or null | Querier |
| `vuln/nvd.ts` | Optional NVD API fallback for additional coverage | Package + version | NVD advisory data | Querier (called if NVD key present) |
| `semver/matcher.ts` | Match installed versions against vulnerable semver ranges | `DependencyMap` + `RawVulnResponse[]` | `VulnMatch[]` | Report Layer, GitHub Layer |
| `report/table.ts` | Render terminal table of vulnerabilities | `VulnMatch[]` | Formatted stdout | CLI entry point |
| `report/json.ts` | Serialize vulnerability findings to JSON | `VulnMatch[]` | JSON string | CLI entry point |
| `server/index.ts` | Launch local HTTP server, serve static UI | `VulnMatch[]` | HTTP server handle | CLI entry point |
| `server/api.ts` | REST endpoints for UI to consume | HTTP requests | JSON responses | UI frontend |
| `ui/` | React SPA: charts, severity grouping, PR button | `/api/vulns` JSON | DOM / POST to API | Server API |
| `github/client.ts` | Authenticated Octokit instance | `GITHUB_TOKEN` | Octokit client | PR module, Patch module |
| `github/patch.ts` | Bump version strings in `package.json` | `VulnMatch`, file path | Patched file content | PR module |
| `github/pr.ts` | Create branch, commit patched file, open PR | Octokit client + patched content | PR URL | CLI report layer, Web UI API |

---

## Data Flow

### Core Pipeline (CLI mode)

```
process.argv
  → [cli.ts]            parse flags: --json, --ui, --fix, target path/URL
  → [resolver.ts]       read local files OR clone remote repo to temp dir
  → [lockfile.ts]       parse package-lock.json v2/v3 → Map<name, semver>
  → [querier.ts]        POST /v1/querybatch to OSV.dev (batch all packages)
  → [cache.ts]          check disk cache (keyed by pkg@version) before HTTP
  → [matcher.ts]        for each advisory: check installed ver against ranges
  → [VulnMatch[]]       structured findings: pkg, installedVer, cve, severity, fixedIn
  → [report/table.ts]   render to terminal OR [report/json.ts] output JSON
  → [cli prompt]        user selects which vulns to fix (inquirer/prompts)
  → [patch.ts]          rewrite package.json with bumped versions
  → [pr.ts]             git branch → commit → GitHub PR via Octokit
  → stdout: PR URL
```

### Web UI Mode (--ui flag)

```
[cli.ts] --ui flag detected
  → run core pipeline through [matcher.ts] to get VulnMatch[]
  → [server/index.ts]  start Express/Fastify on random available port
  → [server/api.ts]    expose GET /api/vulns → VulnMatch[] as JSON
                        expose POST /api/fix/:pkg → triggers [pr.ts]
  → [ui/]              Vite-built React SPA served from server's static dir
  → browser auto-opens to localhost:PORT
  → user clicks "Create PR" in browser → POST /api/fix/:pkg
  → [pr.ts] runs → returns PR URL → UI displays it
```

### OSV.dev API Contract

The query layer uses the batch endpoint for efficiency:

```
POST https://api.osv.dev/v1/querybatch
Content-Type: application/json

{
  "queries": [
    { "package": { "name": "lodash", "ecosystem": "npm" }, "version": "4.17.20" },
    { "package": { "name": "express", "ecosystem": "npm" }, "version": "4.17.1" }
    // ... one entry per installed package
  ]
}
```

Response: `{ "results": [ { "vulns": [...] }, { "vulns": [] } ] }` — array aligned positionally with queries.

Each vuln contains `affected[].ranges[]` with semver ranges for matching.

---

## Patterns to Follow

### Pattern 1: Pipeline with Typed Boundaries

**What:** Each stage has a clear TypeScript interface for its input and output. No stage knows about the one before its immediate predecessor.

**When:** Any multi-stage data transformation.

**Why:** Enables independent unit testing of each stage. Parser tests don't need a real API. Matcher tests don't need a real lockfile.

```typescript
// src/types.ts — shared contracts
export type DependencyMap = Map<string, string>; // name → installed version

export interface VulnMatch {
  package: string;
  installedVersion: string;
  advisoryId: string;        // CVE or GHSA id
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  fixedIn: string | null;    // null if no fix available
  summary: string;
  references: string[];
}
```

### Pattern 2: Batch API Queries, Not Per-Package

**What:** Collect all packages first, then issue one `POST /v1/querybatch` request rather than N serial requests.

**When:** Always — the batch endpoint is purpose-built for this.

**Why:** A typical `package-lock.json` has 200-500 packages. Serial requests would take 10-50 seconds and risk rate limiting. One batch request returns in under 2 seconds.

```typescript
// src/vuln/querier.ts
async function queryAll(deps: DependencyMap): Promise<RawVulnResponse[]> {
  const queries = [...deps.entries()].map(([name, version]) => ({
    package: { name, ecosystem: 'npm' },
    version,
  }));
  const { data } = await axios.post('https://api.osv.dev/v1/querybatch', { queries });
  return data.results; // positionally aligned with queries
}
```

### Pattern 3: Filesystem Cache with TTL

**What:** Cache OSV.dev responses in `~/.nodeguard/cache/` keyed by `pkg@version`, with a 24-hour TTL.

**When:** Any repeated invocation on the same project.

**Why:** Vulnerability databases don't change minute-to-minute. Re-querying the same `lodash@4.17.20` on every run wastes network time and risks rate limits during CI runs. A 24h TTL keeps data fresh enough while being dramatically faster.

```typescript
// Cache key: sha256(`${name}@${version}`) → JSON file in ~/.nodeguard/cache/
// On read: check mtime, discard if > 24h old
// On write: write JSON + update mtime
```

### Pattern 4: Semver Range Matching via the `semver` Library

**What:** Use the npm `semver` package (the canonical semver implementation) for all version comparisons.

**When:** Matching installed versions against OSV.dev's `affected[].ranges[]`.

**Why:** OSV.dev vulnerability ranges can be expressed as `SEMVER` type ranges or `ECOSYSTEM` type (which for npm is semver). The `semver` library handles edge cases (pre-release, build metadata, partial versions) that manual string comparison misses.

```typescript
import semver from 'semver';

// OSV.dev range: { type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }
// Translate to semver range string: '>=0.0.0 <4.17.21'
// Then: semver.satisfies(installedVersion, range)
```

### Pattern 5: GitHub Integration via Octokit, Not `git` CLI

**What:** Use `@octokit/rest` for all GitHub operations (create branch, create/update file, open PR).

**When:** All GitHub PR creation.

**Why:** Octokit is the official GitHub SDK for Node.js. It avoids a dependency on the `git` binary being installed, works identically across platforms, and does not require a git clone of the target repo — all operations are pure API calls. This is critical because the user may be pointing NodeGuard at a remote repo they have not cloned locally.

```typescript
// Branch creation:  octokit.git.createRef(...)
// File update:      octokit.repos.createOrUpdateFileContents(...)
// PR creation:      octokit.pulls.create(...)
```

### Pattern 6: Web UI as Embedded Static Build

**What:** Build the React SPA with Vite at publish time. Bundle the `dist/` output into the npm package. The local server serves files from `path.join(__dirname, '../ui/dist')`.

**When:** --ui flag is passed.

**Why:** This avoids runtime build steps. The user should not need Vite or React dev tooling installed. The server starts instantly by serving pre-built static files.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Per-Package Serial API Queries

**What:** Issuing one HTTP request per dependency.

**Why bad:** 300 packages = 300 requests. At 200ms per request = 60 seconds. OSV.dev provides a batch endpoint specifically to avoid this.

**Instead:** Collect all packages, issue one `POST /v1/querybatch`.

### Anti-Pattern 2: Mutating package.json In-Place Before User Confirmation

**What:** Patching the package.json file before asking the user which fixes to apply.

**Why bad:** Leaves the repo in a dirty state if the user cancels. Unrecoverable without git.

**Instead:** Stage all patches in memory. Only write to disk (or commit via API) after explicit user confirmation per vulnerability.

### Anti-Pattern 3: Coupling Report Layer to Delivery Mechanism

**What:** `report/table.ts` calls `github/pr.ts` directly, or the server calls the parser.

**Why bad:** Makes the pipeline untestable in isolation. A unit test for the reporter would trigger GitHub API calls.

**Instead:** The CLI entry point orchestrates all stages. Stages only know their immediate data contract. The CLI wires them together.

### Anti-Pattern 4: Spawning a Child Process for Git Operations

**What:** Using `child_process.exec('git commit ...')` or `simple-git` to perform GitHub operations.

**Why bad:** Requires a local git clone of the target repo. Fails on Windows if git is not in PATH. Not viable when the input is a remote GitHub URL.

**Instead:** Use Octokit REST API for all branch/commit/PR operations. Pure HTTP, no local git required.

### Anti-Pattern 5: Parsing package-lock.json v1 Only

**What:** Writing the lockfile parser against the v1 structure (`dependencies` flat object).

**Why bad:** npm 7+ generates v2/v3 lockfiles with a `packages` flat map as the primary structure (the old `dependencies` key is retained for backwards compat but deprecated). New projects only have `packages`.

**Instead:** Read `lockfileVersion` field first. Use `packages` for v2/v3, fall back to `dependencies` for v1. Primary key in `packages` is `"node_modules/packagename"` — strip the prefix to get the package name.

---

## Component Build Order

Build order is determined by dependency direction in the pipeline. Each layer can only be built after the layers it depends on.

```
Layer 0 (Foundation — no dependencies):
  src/types.ts            — shared TypeScript interfaces

Layer 1 (Parsing — depends on types only):
  src/parser/lockfile.ts  — lockfile → DependencyMap
  src/input/resolver.ts   — path/URL → raw file strings

Layer 2 (Data Acquisition — depends on types):
  src/vuln/cache.ts       — filesystem cache
  src/vuln/querier.ts     — OSV.dev API (uses cache)
  src/vuln/nvd.ts         — NVD API (optional, uses cache)

Layer 3 (Matching — depends on types + querier output):
  src/semver/matcher.ts   — VulnMatch[] from DependencyMap + RawVulnResponse[]

Layer 4 (Output — depends on VulnMatch[]):
  src/report/table.ts     — terminal table renderer
  src/report/json.ts      — JSON serializer

Layer 5 (Action — depends on VulnMatch[] + GitHub token):
  src/github/client.ts    — Octokit factory
  src/github/patch.ts     — package.json version bumper
  src/github/pr.ts        — branch + commit + PR creation

Layer 6 (Orchestration — depends on all layers):
  src/cli.ts              — argument parsing + pipeline wiring

Layer 7 (Optional UI — depends on Layer 3 output, parallel to Layer 4/5):
  src/server/index.ts     — Express/Fastify server setup
  src/server/api.ts       — REST API endpoints
  src/ui/                 — React + Vite SPA (built separately)
```

**Rationale for this order:**
- `types.ts` first: prevents circular imports and gives every other module a stable contract to code against.
- Parser and Input Resolver before Querier: the querier's input type (`DependencyMap`) is defined by the parser's output.
- Cache before Querier: querier wraps cache, not the reverse.
- Matcher before Report: report renders what matcher produces.
- GitHub Client before PR: PR module is a consumer of the client.
- CLI last in core pipeline: it is pure orchestration — no logic, just wiring.
- Web UI last and parallel: it is the optional enhancement layer. Its API contract (`VulnMatch[]`) is defined by Layer 3, so it can be developed after the core pipeline works.

---

## Scalability Considerations

| Concern | At 50 packages | At 500 packages | At 5000 packages |
|---------|----------------|-----------------|------------------|
| OSV.dev query | 1 batch request (~300ms) | 1 batch request (~600ms) | Batch endpoint has no documented limit; may need chunking at ~1000 |
| Cache hit rate | Low (first run) | High after 1st run | Very high — most packages stable |
| Memory (VulnMatch[]) | Negligible | ~1MB | ~10MB — still fine |
| Terminal table render | Instant | Instant | Pagination needed |
| Web UI render | Instant | Instant | Virtualized list recommended |

**Critical note on OSV.dev batch limits:** OSV.dev `/v1/querybatch` does not publicly document a per-request item limit as of the knowledge cutoff. As a defensive measure, chunk inputs at 500 packages per request and issue multiple parallel batch calls if the dependency count exceeds that threshold. This prevents unexpected 400/413 responses on large monorepos.

---

## Directory Structure

```
nodeguard/
  src/
    cli.ts                  # Entry point, argument parsing (commander)
    types.ts                # Shared interfaces: DependencyMap, VulnMatch, etc.
    input/
      resolver.ts           # Local path or GitHub URL → raw file content
    parser/
      lockfile.ts           # package-lock.json → DependencyMap
    vuln/
      querier.ts            # OSV.dev batch API client
      cache.ts              # Disk cache with TTL
      nvd.ts                # Optional NVD fallback
    semver/
      matcher.ts            # Version range matching → VulnMatch[]
    report/
      table.ts              # Terminal table (cli-table3 or ink)
      json.ts               # JSON serializer
    github/
      client.ts             # Octokit factory (reads GITHUB_TOKEN)
      patch.ts              # package.json version bumper (in-memory)
      pr.ts                 # Branch + commit + PR via Octokit REST
    server/
      index.ts              # Express/Fastify setup, static file serving
      api.ts                # /api/vulns, /api/fix/:pkg endpoints
  src/ui/                   # Vite + React SPA (built to src/ui/dist/)
    src/
      App.tsx
      components/
        VulnTable.tsx
        SeverityChart.tsx
        PRButton.tsx
  bin/
    nodeguard.js            # Shebang wrapper → src/cli.ts
  package.json
  tsconfig.json
```

---

## Sources

Note: External tools (WebSearch, WebFetch) were unavailable during this research session. The following sources represent well-established, stable systems documented through August 2025 — HIGH confidence.

- OSV.dev API: `https://google.github.io/osv.dev/post-v1-query/` — batch query endpoint, response schema, semver range format
- npm lockfile format: `https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json` — v1/v2/v3 structure, `packages` vs `dependencies` fields
- Octokit REST: `https://octokit.github.io/rest.js/` — `git.createRef`, `repos.createOrUpdateFileContents`, `pulls.create`
- semver package: `https://github.com/npm/node-semver` — canonical npm semver implementation, `satisfies()` API
- npm audit architecture: reference implementation for the batch-query + semver-match pipeline pattern
- NVD API v2: `https://nvd.nist.gov/developers/vulnerabilities` — requires API key, provides CVSS scores
