# Domain Pitfalls

**Domain:** Node.js vulnerability scanning CLI tool (lockfile parsing, vuln API querying, semver matching, GitHub PR creation, local web UI)
**Researched:** 2026-03-14
**Confidence:** MEDIUM — web access unavailable; findings from deep training-data knowledge of OSV.dev API, semver spec, GitHub API, and security tooling. Flagged where external verification is needed.

---

## Critical Pitfalls

Mistakes that cause incorrect vulnerability reports, data loss, or rewrites.

---

### Pitfall 1: Semver Pre-Release Version Handling

**What goes wrong:** The semver specification treats pre-release versions (e.g., `1.2.3-alpha.1`, `2.0.0-rc.2`) as lower than the release version. A naive string comparison or even a partially correct semver comparison will conclude that `1.2.3-alpha.1` is NOT within the range `>=1.2.0 <1.3.0` — which is correct per spec — but many real-world vulnerability databases define their affected ranges using release versions only. This causes false negatives: a pre-release version that is genuinely vulnerable gets skipped.

**Why it happens:** The `semver` npm package (the canonical implementation) correctly excludes pre-release versions from ranges unless the range itself includes a pre-release tag on the same `[major, minor, patch]` tuple. Security teams define ranges like `<1.4.5` assuming release versions. Pre-release users fall through the check.

**Consequences:** Pre-release versions of packages (which are common in CI pipelines, monorepos, canary channels) appear clean when they are not.

**Prevention:**
- Use the `semver` package's `includePrerelease: true` option explicitly when checking whether an installed version satisfies a vulnerable range: `semver.satisfies(installedVersion, vulnRange, { includePrerelease: true })`.
- Add a dedicated test fixture: a package at version `2.0.0-beta.1` that is covered by a vulnerability range defined as `<2.0.0` — verify the tool flags it.
- Document the behavior for users; some will intentionally want pre-release exclusion.

**Detection warning signs:** Test suite passes but reports on pre-release versions come back empty. OSV.dev results for a package show a vuln range like `< 1.4.0` but scanning `1.4.0-rc.1` shows no finding.

**Phase:** Implement and test during the semver comparison / vulnerability matching phase.

---

### Pitfall 2: Semver Range Operators — OR Ranges and Hyphen Ranges

**What goes wrong:** OSV.dev and NVD return vulnerability ranges in multiple formats. OSV uses its own `events` schema (`introduced`/`fixed`/`last_affected`). NVD uses CPE-based version strings. When you convert these to semver ranges for use with the `semver` package, compound ranges with OR (`||`) and hyphen ranges (`1.0.0 - 2.0.0`) are handled differently from simple ranges. Errors in conversion produce both false positives (flagging safe versions) and false negatives (missing vulnerable ones).

**Why it happens:** Developers write their own OSV-to-semver converter and test only the simple case. OSV's `events` array can have multiple `introduced`/`fixed` pairs representing non-contiguous vulnerable ranges (e.g., vulnerability was fixed, then reintroduced). Each pair is a separate segment that must be joined with OR.

**Consequences:** A version that sits between two non-contiguous vulnerable windows gets flagged or missed depending on which direction the conversion error goes. This is a correctness defect at the core of the tool's value.

**Prevention:**
- Map OSV `events` arrays precisely: each `introduced`/`fixed` pair becomes `>=introduced <fixed`; multiple pairs join with ` || `.
- The `last_affected` event (OSV-specific) means `<=last_affected` not `<last_affected` — off-by-one on the upper bound is a common bug.
- Use a property-based test (e.g., with `fast-check`) that generates random event arrays and verifies the synthesized range matches expected membership.
- Never use string concatenation to build semver ranges — build them programmatically with clear per-pair logic.

**Detection warning signs:** A vulnerability known to affect a specific version does not appear in the report when you test manually.

**Phase:** Semver comparison / vulnerability matching phase. Include range-construction unit tests before any API integration.

---

### Pitfall 3: OSV.dev API — Batch Query vs Single Query at Scale

**What goes wrong:** The OSV.dev `/v1/query` endpoint queries one package at a time. A project with 200 direct + transitive dependencies requires 200 sequential or parallel HTTP requests. Doing these sequentially makes scanning take 30-60 seconds on a moderately-sized project. Doing them all in parallel with `Promise.all` hits the OSV.dev server with a burst and can result in connection resets or 429 responses (rate limiting), even though OSV.dev does not publish a hard rate limit number.

**Why it happens:** The happy path (small project, fast network) works fine in development. The problem surfaces on real codebases with 500+ packages.

**Consequences:** Slow scans annoy users; unhandled rate-limit errors cause the tool to crash mid-scan and report no results or partial results with no indication of incompleteness.

**Prevention:**
- Use OSV.dev's `/v1/querybatch` endpoint, which accepts up to 1000 package queries in a single POST body. This is dramatically more efficient and is the intended API for bulk lookups.
- If `querybatch` payloads exceed 1000, chunk them into batches of 1000 and send sequentially (not concurrently).
- Implement exponential backoff with jitter for any 429 or 5xx response — minimum 3 retries before surfacing an error.
- Show a progress indicator (spinner or progress bar) during batch queries so users know the tool is working.

**Detection warning signs:** Scanning a project with many packages takes >10 seconds. Any test against a large lockfile fixture results in ECONNRESET or 429.

**Phase:** API integration phase.

**Confidence:** MEDIUM — `/v1/querybatch` existence is from training data; verify it is still the recommended endpoint against current OSV.dev docs before implementation.

---

### Pitfall 4: OSV.dev Response Schema — `affected[].ranges` vs `affected[].versions`

**What goes wrong:** The OSV.dev response for a vulnerability includes both `affected[].ranges` (structured `SEMVER` or `ECOSYSTEM` event arrays) and `affected[].versions` (a flat list of known-affected version strings). Teams use the `versions` array for matching because it looks simpler, but it is incomplete — not all OSV entries have fully enumerated `versions`, and newer vulnerabilities are often missing it while the `ranges` field is populated.

**Why it happens:** The `versions` array is convenient for exact-match lookup. Using it without falling back to `ranges` creates false negatives for vulnerabilities whose `versions` list is sparse or empty.

**Consequences:** Real vulnerabilities are silently missed because the installed version isn't in the flat list even though it falls within the vulnerable range.

**Prevention:**
- Implement range-based matching as the primary method using `affected[].ranges` where `type === "SEMVER"`.
- Use `affected[].versions` only as a secondary cross-check or for ecosystem ranges that can't be expressed as semver.
- Handle the case where `ranges` is missing or contains only `GIT` type ranges (not semver-comparable) — mark those as "check manually" rather than reporting clean.

**Detection warning signs:** OSV returns a hit for a package in a browser test but your tool reports clean for the same version.

**Phase:** API integration and vulnerability matching phases.

---

### Pitfall 5: Transitive Dependency Vulnerability Attribution

**What goes wrong:** When `package-lock.json` is parsed, the vulnerability found in a transitive dependency (a package your package depends on, not one you declared) gets reported, but the recommended fix ("bump version X in package.json") is wrong — the package isn't in `package.json` at all. The tool then either creates a PR that adds an unnecessary direct dependency, or it crashes when trying to write the version bump.

**Why it happens:** `package-lock.json` flattens all packages (direct + transitive) into the `packages` object (npm v7+ lockfile format) or `dependencies` (v1/v2). The distinction between direct and transitive is not immediately visible without cross-referencing `package.json`.

**Consequences:** PR is either wrong (adds a spurious direct dependency), a no-op (bumps a transitive you can't control), or the tool crashes.

**Prevention:**
- Classify each vulnerable package as `direct` (present in `package.json` `dependencies`/`devDependencies`) or `transitive` (in lockfile only).
- For transitive vulnerabilities, report them differently: show which direct dependency pulls them in (the "dependency chain"), and recommend upgrading the direct dependency or using `overrides`/`resolutions`.
- Do not attempt to auto-create PRs for transitive-only vulnerabilities in v1 — flag them as "manual action required."
- When reporting, include the dependency path: `your-app → express@4.18.2 → qs@6.5.2 (VULNERABLE)`.

**Detection warning signs:** A PR is opened that adds a package to `package.json` that was not there before.

**Phase:** Lockfile parsing phase and PR creation phase.

---

### Pitfall 6: package-lock.json Format Version Variations

**What goes wrong:** npm has three lockfile formats. `lockfileVersion: 1` (npm 5-6) uses a `dependencies` key with a nested tree. `lockfileVersion: 2` (npm 7-8) uses both `packages` (flat) and `dependencies` (nested, for backwards compatibility). `lockfileVersion: 3` (npm 9+) uses only `packages`. Code that only reads `packages` fails silently on v1 lockfiles; code that reads `dependencies` and `packages` inconsistently produces duplicates.

**Why it happens:** Developers test against their own machine's npm version. Users with older projects or CI that pins npm get broken results.

**Consequences:** Some packages are not scanned, producing false negatives. Or the same package is counted twice, producing duplicate findings.

**Prevention:**
- Read the `lockfileVersion` field at parse time and branch the parsing logic accordingly.
- For v1: parse `dependencies` recursively.
- For v2: prefer `packages` (it's the canonical source), ignore `dependencies`.
- For v3: parse `packages` only.
- The `packages` key uses paths as keys (`node_modules/express`, `node_modules/express/node_modules/debug`) — strip the `node_modules/` prefix to get the package name, and be aware of scoped packages (`@scope/name`).
- Add fixture lockfiles for all three versions in your test suite.

**Detection warning signs:** Running the tool on a project checked out from an older npm version returns far fewer packages than expected.

**Phase:** Lockfile parsing phase.

---

### Pitfall 7: GitHub API Token Scope Insufficiency

**What goes wrong:** `GITHUB_TOKEN` is available in many contexts (GitHub Actions default token, personal access tokens, fine-grained tokens) but with different scope sets. Creating a branch requires `contents: write`. Creating a PR requires `pull-requests: write`. Reading a repo requires `contents: read`. Fine-grained PATs can restrict to specific repositories. If the token lacks the right scope, the GitHub API returns a `403` with a generic `Resource not accessible by integration` message — not a clear "missing scope" error.

**Why it happens:** The tool works for the developer who created a fat PAT with all scopes. Users with minimal-scope tokens get a confusing 403.

**Consequences:** PR creation silently fails or crashes with an opaque error message. Users think the tool is broken when their token is simply scoped too narrowly.

**Prevention:**
- Before attempting branch creation or PR creation, make a preliminary call to `GET /repos/{owner}/{repo}` and check permissions from the response's `permissions` field (`push: true` is required for branch creation).
- If permissions are insufficient, surface a specific, actionable error: "GITHUB_TOKEN lacks 'contents: write' permission. Generate a PAT with repo scope or use a fine-grained token with Contents: read/write and Pull requests: write."
- Document the minimum required token scopes in the README and CLI `--help` output.
- GitHub Actions' default `GITHUB_TOKEN` requires `permissions: pull-requests: write` in the workflow YAML — document this.

**Detection warning signs:** PR creation returns 403 in tests; error message is `Resource not accessible by integration`.

**Phase:** GitHub PR creation phase.

---

### Pitfall 8: Branch Already Exists on Repeated Scans

**What goes wrong:** The fix branch name is deterministic (e.g., `fix/lodash-cve-2021-23337`). If the user runs the scan twice without merging or deleting the first PR, the second attempt to create the branch fails with a `422 Reference already exists` GitHub API error.

**Why it happens:** Branch creation is not idempotent by default.

**Consequences:** Tool crashes mid-PR-creation flow after the user has confirmed they want the fix.

**Prevention:**
- Check whether the branch already exists before creation (`GET /repos/{owner}/{repo}/git/refs/heads/{branch-name}`).
- If it exists, offer the user three options: (a) open the existing PR URL, (b) force-update the branch, (c) abort.
- Alternatively, append a short timestamp or hash suffix to branch names to guarantee uniqueness, but this creates PR sprawl — prefer the explicit check.

**Detection warning signs:** Running the tool twice on the same repo fails on the second run.

**Phase:** GitHub PR creation phase.

---

### Pitfall 9: Local Web Server Port Conflicts and Cleanup

**What goes wrong:** The `--ui` flag starts an HTTP server on a default port (e.g., 3000 or 7777). If that port is in use, the server startup throws `EADDRINUSE` and the process either crashes or starts in a broken state. Worse, if the user Ctrl+C's the CLI, the HTTP server may not be cleaned up, leaving a zombie process on the port.

**Why it happens:** Port conflict checking is not done before binding. `process.on('SIGINT')` / `process.on('SIGTERM')` handlers are not registered.

**Consequences:** Users get a confusing crash or a port that stays occupied across sessions. On Windows, zombie processes require Task Manager to kill.

**Prevention:**
- Before binding, probe the default port with a quick socket connect attempt. If occupied, auto-increment to the next port (up to 10 attempts) and tell the user which port is being used.
- Allow `--ui-port` to override the default.
- Register `process.on('SIGINT')` and `process.on('SIGTERM')` (and `process.on('exit')`) to call `server.close()` before exiting.
- On Windows, `SIGTERM` is not reliably sent — use `process.on('exit')` as the cleanup fallback.

**Detection warning signs:** Starting the tool twice results in an `EADDRINUSE` error on the second run. After Ctrl+C, `lsof -i :PORT` still shows a process.

**Phase:** Web UI implementation phase.

---

### Pitfall 10: Cross-Platform Path Handling

**What goes wrong:** `package-lock.json` parsing uses `path.join` on the `node_modules/` prefix internally, but paths in the lockfile are always POSIX-style (`node_modules/express`). On Windows, `path.join('node_modules', 'express')` produces `node_modules\express`, which doesn't match the lockfile key, so lookups fail.

**Why it happens:** macOS and Linux developers never notice because `path.join` uses `/` on those platforms. Windows-specific bugs only surface on Windows CI or Windows users.

**Consequences:** The entire `packages` map lookup fails on Windows — all packages appear as zero-dependency, zero-vulnerability.

**Prevention:**
- Never use `path.join` or `path.resolve` for constructing or matching lockfile path keys. Use string operations or `path.posix.join` explicitly.
- Add a Windows-specific CI job (GitHub Actions `windows-latest`) early in the project.
- Test lockfile parsing with a fixture that uses scoped packages (`@babel/core`) since the path is `node_modules/@babel/core` — ensure `@` is handled.

**Detection warning signs:** Tool returns zero vulnerabilities on Windows even for a project known to have vulnerable packages.

**Phase:** Lockfile parsing phase; add Windows CI job in initial scaffolding phase.

---

## Moderate Pitfalls

---

### Pitfall 11: NVD API Key Requirement and Rate Limiting

**What goes wrong:** NVD's public API (api.nvd.nist.gov) has strict rate limits: 5 requests per 30 seconds without an API key, 50 requests per 30 seconds with a key. A project with 50+ packages will exhaust the unauthenticated rate limit immediately. NVD also changes its API schema between versions (v1 to v2 migration happened in 2023) — tools built against the old v1 endpoint now get 404s.

**Prevention:**
- Treat NVD as optional/secondary. OSV.dev is the primary source (no key required, generous limits, batch API).
- If NVD is supported, require the user to set `NVD_API_KEY` and implement a request queue with 600ms delay between requests (unauthenticated) or 100ms (authenticated) — do not rely on "retry on 429."
- Target the NVD v2 API (`/rest/json/cves/2.0`) only; document this explicitly.

**Phase:** API integration phase. Verify current NVD v2 endpoint and rate limits against official docs before implementation.

---

### Pitfall 12: False Positive from Version Range Boundary Confusion (fixed vs last_affected)

**What goes wrong:** OSV events use `fixed` to mean "this version is the first non-vulnerable release" (exclusive upper bound) and `last_affected` to mean "this is the last known vulnerable version" (inclusive upper bound). Treating `fixed` as inclusive causes false positives: version `2.3.4` is reported as vulnerable when it is the fix itself.

**Prevention:**
- `fixed` → `< fixed_version` (exclusive)
- `last_affected` → `<= last_affected_version` (inclusive)
- Unit test both: a version equal to `fixed` must be CLEAN; a version equal to `last_affected` must be VULNERABLE.

**Phase:** Vulnerability matching phase.

---

### Pitfall 13: Large Dependency Tree Memory and Performance

**What goes wrong:** Projects with 1000+ packages in their lockfile (common in monorepos or large apps) cause three performance issues: (1) parsing the lockfile JSON is slow for very large files (5MB+), (2) holding all OSV responses in memory simultaneously is memory-intensive, (3) rendering a terminal table with 200 vulnerabilities with full descriptions overflows the terminal.

**Prevention:**
- Stream-parse the lockfile using `JSON.parse` (synchronous, single pass) — do not read it multiple times.
- Process OSV batch responses as they arrive rather than collecting all before processing.
- For terminal output, truncate description text to 80 chars with a `...` and provide a `--verbose` flag for full detail.
- Set a sane memory limit for the Node.js process (`--max-old-space-size=512`) in the CLI shebang or launcher — don't let it silently OOM on massive lockfiles.

**Phase:** Lockfile parsing and output formatting phases.

---

### Pitfall 14: PR Body Version Bump Correctness — devDependencies vs dependencies

**What goes wrong:** A vulnerability in a package listed under `devDependencies` (e.g., a test runner with a known ReDoS vuln) should be treated differently than a production dependency. The PR fix must target the correct section of `package.json`. Tools that blindly write to `dependencies` move a devDependency into production, changing the install footprint for end users of the package.

**Prevention:**
- When classifying packages, track whether the package is in `dependencies`, `devDependencies`, `optionalDependencies`, or `peerDependencies` in `package.json`.
- When writing version bumps in the PR, modify the same section the package was originally in.
- In the vulnerability report, label findings by dependency type so users can assess production risk vs dev-only risk.

**Phase:** PR creation phase.

---

### Pitfall 15: GitHub API Pagination on Large Repository Lists

**What goes wrong:** If NodeGuard adds a feature to list repos for an org or user before scanning, the GitHub API paginates at 30 results by default (max 100 per page). Tools that call `GET /repos` once and assume all repos are returned silently miss repositories beyond page 1.

**Prevention:**
- Use GitHub's `Link` header for pagination — follow `rel="next"` until exhausted, or use Octokit's `paginate()` helper.
- For v1 scope (single-repo scan), this is lower priority, but flag it for future multi-repo scanning features.

**Phase:** Future multi-repo phase; not blocking for v1.

---

## Minor Pitfalls

---

### Pitfall 16: SIGPIPE When Output is Piped

**What goes wrong:** Running `nodeguard | head -20` sends SIGPIPE to the process when `head` exits after reading 20 lines. Node.js does not handle SIGPIPE gracefully by default and throws an `EPIPE` write error to stdout that clutters the output.

**Prevention:**
- Add `process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); })` early in the CLI entry point.

**Phase:** Initial CLI scaffolding phase (one-line fix, do it once and forget).

---

### Pitfall 17: JSON Output Mode Mixing with User-Facing Prompts

**What goes wrong:** When `--json` is passed, downstream tools that consume the JSON (e.g., `jq`, CI scripts) expect stdout to contain only valid JSON. If any prompt, spinner, or log message is written to stdout, the JSON is corrupted and `jq` errors.

**Prevention:**
- Write all user-facing prompts, spinners, and progress text to `stderr`, never `stdout`.
- `stdout` is exclusively for the JSON payload (or the terminal table in default mode).
- Test by running `nodeguard --json | jq .` in a CI fixture — any stdout pollution fails `jq`.

**Phase:** Output formatting phase.

---

### Pitfall 18: Scoped Package Name Parsing in Lockfile

**What goes wrong:** Scoped packages (`@types/node`, `@babel/core`) have names with a `/` in them. When extracting the package name from a `packages` lockfile key like `node_modules/@types/node`, a naive split on `/` that takes `[1]` returns `@types` instead of `@types/node`.

**Prevention:**
- Strip exactly the `node_modules/` prefix, not the entire path structure. Use a known prefix strip: `key.replace(/^node_modules\//, '')`.
- Handle nested paths (workspaces or nested node_modules): `node_modules/a/node_modules/@scope/pkg` — the package name is `@scope/pkg`, the parent context is `a`.

**Phase:** Lockfile parsing phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Lockfile parsing | lockfileVersion format variation (v1/v2/v3) | Branch on `lockfileVersion`; add fixture for each version |
| Lockfile parsing | Scoped package path splitting | Use prefix-strip not position-based split |
| Lockfile parsing | Cross-platform path matching on Windows | Use string ops not `path.join` for lockfile keys |
| Semver matching | Pre-release versions excluded from ranges | Use `{ includePrerelease: true }` option |
| Semver matching | Non-contiguous OSV `events` arrays (multi-window vulns) | Join multiple pairs with `||` correctly |
| Semver matching | `fixed` vs `last_affected` boundary confusion | Treat `fixed` as exclusive, `last_affected` as inclusive |
| API integration | OSV querybatch vs single query at scale | Use `/v1/querybatch` endpoint; chunk at 1000 |
| API integration | `versions` array incompleteness vs `ranges` | Use `ranges` (SEMVER type) as primary; `versions` as secondary |
| API integration | NVD rate limiting and v1 deprecation | Make NVD optional; use v2 API only; enforce key requirement |
| Vuln classification | Transitive deps flagged with wrong fix advice | Distinguish direct vs transitive; show dependency chain |
| Vuln classification | devDeps modified in wrong `package.json` section | Track original dependency section; write to same section |
| PR creation | GitHub token insufficient scope | Pre-flight check permissions endpoint; emit clear error |
| PR creation | Branch already exists on repeated scans | Check before create; offer user options |
| Web UI | Port conflict on `--ui` startup | Probe port before bind; auto-increment; register SIGINT cleanup |
| Web UI | Zombie server process after Ctrl+C | Register SIGINT/SIGTERM/exit handlers; call `server.close()` |
| CLI scaffolding | EPIPE on piped output | Handle `EPIPE` on stdout write error |
| Output formatting | JSON mode polluted with prompts on stdout | All prompts/spinners to stderr; stdout = data only |

---

## Sources

**Note:** Web access was unavailable during this research session. All findings are derived from training knowledge of:
- OSV.dev API specification and schema (knowledge cutoff: August 2025) — MEDIUM confidence; verify `/v1/querybatch` availability and current rate limits against `https://google.github.io/osv.dev/` before implementation
- npm lockfile format specification (versions 1-3) — HIGH confidence; well-documented and stable
- `semver` npm package behavior including `includePrerelease` option — HIGH confidence
- GitHub REST API v3 permissions model — HIGH confidence; verify fine-grained PAT scope names against current GitHub docs
- Node.js process signal handling on Windows — HIGH confidence
- NVD API v2 migration (2023) — MEDIUM confidence; verify current endpoint URL against `https://nvd.nist.gov/developers/vulnerabilities`
