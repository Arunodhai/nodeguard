# Technology Stack

**Project:** NodeGuard
**Researched:** 2026-03-14
**Research mode:** Training data only — WebSearch, WebFetch, and Bash were unavailable during this session. All versions must be verified against npm before use.

---

## Confidence Disclaimer

All version numbers come from training data (cutoff August 2025). They are directionally correct but may be one minor revision behind. Before writing a package.json, run `npm show <package> version` to confirm the latest stable release. Confidence levels reflect architectural confidence, not version accuracy.

---

## Recommended Stack

### CLI Framework

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| commander | ^12.x | Command parsing, flags, help text | Most downloaded Node.js CLI framework (~130M weekly downloads as of mid-2025). Zero runtime dependencies. Excellent TypeScript types. The `--json` flag, `--ui` flag, and directory-path argument in NodeGuard map directly to commander's command/option model. Mature API unlikely to break between versions. |

**Why not yargs:** Yargs is nearly as capable but has more transitive dependencies and its fluent API produces harder-to-read code for simple CLIs. The builder pattern is better suited to CLIs with many nested subcommands.

**Why not oclif:** Oclif is Heroku/Salesforce's framework for large plugin-based CLIs (e.g., Heroku CLI, Shopify CLI). The plugin architecture, hook system, and multi-file command structure add overhead that NodeGuard doesn't need. Appropriate at >20 subcommands; NodeGuard has ~3.

**Confidence:** HIGH — commander's dominance is well-established.

---

### Interactive Prompts

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| @inquirer/prompts | ^3.x | Confirm-before-PR prompt, vulnerability selection | The modern scoped replacement for the legacy `inquirer` package. Provides individual prompt types as tree-shakeable imports. The `confirm` and `checkbox` prompts cover NodeGuard's "which vulnerabilities do you want to fix?" flow. Pure ESM with good TypeScript types. |

**Why not inquirer (legacy):** The monolithic `inquirer` package is in maintenance mode; the Inquirer team migrated to `@inquirer/prompts` as the canonical package. Using the legacy version means inheriting technical debt.

**Why not prompts:** Lighter but less maintained; last major release was 2019.

**Confidence:** HIGH — this migration is well-documented in the Inquirer repo.

---

### Terminal Output Formatting

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| chalk | ^5.x | Colorized severity labels (CRITICAL/HIGH/MEDIUM/LOW) | The standard for terminal colors. v5 is pure ESM. No dependencies. 200M+ weekly downloads. Supports 256-color and truecolor; degrades gracefully on dumb terminals. |
| cli-table3 | ^0.6.x | Vulnerability report table in terminal | Renders bordered ASCII tables with column alignment. Actively maintained fork of cli-table/cli-table2. Handles the multi-column layout (package, severity, installed, fixed, CVE). |
| ora | ^8.x | Spinner during API calls to OSV.dev/NVD | Standard loading indicator for async operations. v8+ is pure ESM. Pairs with chalk for colorized spinner text. |

**Why not boxen/figlet:** Decorative; adds visual noise to a security tool where clarity matters.

**Why not table (by Gajus):** More complex API for equivalent output; cli-table3 is simpler for this use case.

**Confidence:** HIGH for chalk and ora (industry standard). MEDIUM for cli-table3 (dominant but smaller community than chalk).

---

### HTTP Client

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| Native `fetch` (Node.js built-in) | Node.js >= 18 | Querying OSV.dev REST API and NVD REST API | Node.js 18 ships `fetch` as stable (unflagged). Node.js 20+ makes it fully stable. Since NodeGuard targets developers who have Node.js installed, requiring Node >= 18 is reasonable and eliminates an HTTP dependency entirely. OSV.dev's API is simple REST with JSON — no streaming, no interceptors, no retry logic needed at v1. |

**Why not axios:** Axios is a 200KB dependency for functionality Node now provides natively. Appropriate for browser+Node isomorphic code; unnecessary for a Node-only CLI.

**Why not got:** Got is excellent (native ESM, retry, streams) but is a dependency for functionality Node 18+ provides. Add got only if rate-limiting/retry logic becomes complex in v2.

**Caveat:** If the project needs to support Node.js 16 LTS (EOL April 2024, unlikely for a new 2025/2026 tool), add `node-fetch` as a polyfill. Otherwise, native fetch is the right call.

**Confidence:** HIGH — native fetch in Node 18+ is stable and well-documented.

---

### Semver Comparison

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| semver | ^7.x | Comparing installed package versions against OSV.dev vulnerable version ranges | The canonical npm semver parser. Used internally by npm itself. Provides `satisfies(version, range)` which maps directly to the OSV.dev `affected[].ranges` format. No alternatives worth considering — this is the reference implementation. |

**Confidence:** HIGH — semver is the npm standard, no viable alternative exists.

---

### GitHub API Client

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| @octokit/rest | ^20.x | Create fix branch, commit package.json change, open PR | The official GitHub REST API client from the Octokit project (GitHub-maintained). Provides typed methods for all needed operations: `repos.createRef`, `repos.createOrUpdateFileContents`, `pulls.create`. TypeScript types are auto-generated from GitHub's OpenAPI spec — always accurate. |

**Why not raw fetch against GitHub API:** Possible but means manually constructing URLs, handling pagination, managing auth headers, and losing type safety. The @octokit/rest overhead (~30KB) is worth the developer experience.

**Why not the full `octokit` bundle:** The `octokit` package bundles REST + GraphQL + webhooks + plugins. NodeGuard only needs REST. `@octokit/rest` is the lightweight focused package.

**Why not GitHub CLI (`gh`) via child_process:** Requires `gh` to be installed and authenticated separately. Adds a system dependency that breaks the "install and run" promise.

**Confidence:** HIGH — @octokit/rest is the canonical choice for Node.js GitHub automation.

---

### Local Web Server (optional --ui flag)

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| fastify | ^4.x | Serve the vulnerability dashboard HTML + REST endpoints | Fastify is faster than Express (~2x throughput in benchmarks), has first-class TypeScript support, and ships with a schema-based validation system. For a local dev tool, performance difference is imperceptible — the real win is that Fastify's plugin model is cleaner than Express middleware for small focused servers. Also: Fastify v4 is stable and widely adopted; v5 is in RC as of mid-2025. Use v4 for stability. |
| @fastify/static | ^7.x | Serve the built frontend bundle | The official Fastify plugin for serving static files. Required alongside fastify for the UI feature. |

**Why not Express:** Express is fine but has stalled at v4 for years (v5 RC has been in progress since 2021). For a new tool in 2025, Fastify's modern architecture, built-in JSON schema validation, and TypeScript support make it the better choice.

**Why not Hono:** Hono is excellent for edge/worker environments. For a local Node.js server, Fastify's larger ecosystem and official plugins are a better fit.

**Why not a pure static file server:** The dashboard needs a REST endpoint to receive "create PR" actions from the browser UI. Pure static serving isn't sufficient.

**Confidence:** MEDIUM — Fastify v4 is solid. Note that Fastify v5 may be stable by build time; verify before pinning.

---

### Frontend Dashboard (optional --ui flag)

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| Vanilla JS + HTML + CSS (no framework) | N/A | Browser vulnerability dashboard | The dashboard is a single page showing a list of vulnerabilities grouped by severity with a chart and "Create PR" buttons. This is ~200 lines of JavaScript. Introducing React, Vue, or Svelte adds a build step, node_modules bloat in the distributed package, and a framework to maintain. Vanilla JS with the Fetch API against the Fastify endpoints is the right call at this scope. |
| Chart.js | ^4.x | Severity breakdown donut/bar chart | Lightweight charting (60KB gzipped) loaded from CDN in the served HTML. Avoids bundling charting code into the npm package. If CDN is unacceptable for offline use, bundle Chart.js into the static assets. |

**Why not React/Vue/Svelte:** These frameworks require a bundler (Vite/webpack), a separate build step, and substantially more complexity. The UI is a simple read-mostly dashboard — no state management, no routing, no component reuse across pages. Vanilla JS is proportionate to the task.

**Why not HTMX:** HTMX is appealing for server-driven UI, but the "Create PR" interaction involves async GitHub API calls with progress feedback — better handled with a small fetch + async/await pattern than HTMX's synchronous request model.

**Confidence:** HIGH — the scope of the dashboard does not justify a frontend framework.

---

### TypeScript Configuration

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| TypeScript | ^5.x | Type safety across CLI and server code | TypeScript 5.x brings const type parameters, decorator metadata, and improved module resolution. For a security tool, type safety reduces the risk of passing wrong types to semver.satisfies() or Octokit methods (where a wrong argument silently creates the wrong PR). Use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` for correct ESM interop. |
| tsx | ^4.x | Development-time TypeScript execution | `tsx` (TypeScript Execute) runs .ts files directly via esbuild. Faster than ts-node for development. Use for `npm run dev` and testing. |
| tsup | ^8.x | Build/bundle CLI for distribution | tsup bundles the CLI entry point to a single CJS or ESM file, strips type declarations from the output, and handles shebang lines. Simpler than rollup/webpack for CLI tools. The output is what gets published to npm. |

**Confidence:** HIGH — this TypeScript + tsup toolchain is standard for 2024/2025 Node.js CLI tools.

---

### Testing

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| Vitest | ^2.x | Unit and integration tests | Vitest is the standard testing framework for ESM-first TypeScript projects. Faster than Jest (native ESM support, no transform step), compatible with Jest's API (easy migration), and has excellent TypeScript support. Test the semver matching logic, OSV.dev response parsing, and package.json mutation functions. |
| nock | ^14.x | Mock HTTP requests in tests | Intercept fetch() calls to OSV.dev/NVD/GitHub API without real network calls. Essential for deterministic vulnerability scan tests. |

**Confidence:** HIGH for Vitest. MEDIUM for nock with native fetch — verify nock v14 compatibility with Node's built-in fetch (nock historically patched http/https modules; native fetch bypasses these). Alternative: use `msw` (Mock Service Worker) v2 which intercepts at the fetch level and is unambiguously compatible.

**MSW alternative:** `msw` ^2.x — if nock has native fetch compatibility issues, msw is the modern replacement. Both are acceptable; msw is safer.

---

### Packaging and Distribution

| Technology | Version (verify) | Purpose | Why |
|------------|-----------------|---------|-----|
| npm (global install) | N/A | Primary distribution channel | `npm install -g nodeguard` and `npx nodeguard` are the two install paths called out in PROJECT.md. No additional tooling needed — standard `bin` field in package.json with a shebang line handles both. |
| pkg / nexe | — | **Do not use** | These bundle Node.js itself into a binary. Appropriate for distributing to non-Node users. NodeGuard targets developers who already have Node.js; bundling the runtime adds 50MB+ to the package for no benefit. |

**package.json configuration for CLI distribution:**
```json
{
  "bin": {
    "nodeguard": "./dist/cli.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "files": [
    "dist/"
  ]
}
```

The `files` field ensures only the built output is published — not source, tests, or `.planning/`.

**Confidence:** HIGH — this is standard npm CLI distribution practice.

---

## Complete Stack Summary

| Category | Library | Version (verify) | Confidence |
|----------|---------|-----------------|------------|
| CLI framework | commander | ^12.x | HIGH |
| Interactive prompts | @inquirer/prompts | ^3.x | HIGH |
| Terminal colors | chalk | ^5.x | HIGH |
| Terminal tables | cli-table3 | ^0.6.x | MEDIUM |
| Loading spinner | ora | ^8.x | HIGH |
| HTTP client | Node.js built-in fetch | Node >= 18 | HIGH |
| Semver comparison | semver | ^7.x | HIGH |
| GitHub API | @octokit/rest | ^20.x | HIGH |
| Web server | fastify | ^4.x | MEDIUM |
| Static file serving | @fastify/static | ^7.x | MEDIUM |
| Frontend | Vanilla JS + Chart.js | Chart.js ^4.x | HIGH |
| Language | TypeScript | ^5.x | HIGH |
| Dev runner | tsx | ^4.x | HIGH |
| Bundler | tsup | ^8.x | HIGH |
| Test framework | Vitest | ^2.x | HIGH |
| HTTP mocking | msw | ^2.x | MEDIUM |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| CLI framework | commander | yargs | More dependencies, more complex API for a simple CLI |
| CLI framework | commander | oclif | Plugin architecture overkill for ~3 commands |
| HTTP client | native fetch | axios | 200KB dependency for functionality Node 18 provides natively |
| HTTP client | native fetch | got | Adds dependency; native fetch sufficient for v1 REST calls |
| GitHub API | @octokit/rest | octokit (full bundle) | Bundles GraphQL/webhooks; REST-only package is lighter |
| GitHub API | @octokit/rest | gh via child_process | Requires `gh` CLI installed separately; breaks "npx" install story |
| Web server | fastify | express | Express v4 is stagnating; Fastify has modern TS support |
| Web server | fastify | hono | Better suited for edge/workers; Fastify is better for local Node server |
| Frontend | Vanilla JS | React/Vue/Svelte | Requires build step, framework overhead; UI scope doesn't justify it |
| Frontend | Vanilla JS | HTMX | Async PR creation flow is better handled with fetch + async/await |
| Test HTTP mocking | msw | nock | nock patches http module which may not intercept native fetch; msw is fetch-native |
| Distribution | npm global | pkg/nexe | Bundles Node runtime (50MB+); unnecessary for developer tools |
| Interactive prompts | @inquirer/prompts | prompts | Last major release 2019; less maintained |

---

## Installation

```bash
# Runtime dependencies
npm install commander @inquirer/prompts chalk cli-table3 ora semver @octokit/rest fastify @fastify/static

# TypeScript and build tooling
npm install -D typescript tsx tsup @types/node @types/semver

# Testing
npm install -D vitest msw

# Type stubs (if not bundled with packages)
npm install -D @types/cli-table3
```

---

## Version Verification Commands

Before writing the final package.json, run these to confirm latest stable versions:

```bash
npm show commander version
npm show @inquirer/prompts version
npm show chalk version
npm show cli-table3 version
npm show ora version
npm show semver version
npm show @octokit/rest version
npm show fastify version
npm show @fastify/static version
npm show chart.js version
npm show typescript version
npm show tsx version
npm show tsup version
npm show vitest version
npm show msw version
```

---

## Sources

- Training data (cutoff August 2025) — MEDIUM confidence on versions, HIGH on architectural decisions
- npm download statistics patterns (commander ~130M/week, chalk ~200M/week) — these are well-established, LOW risk of being wrong directionally
- Node.js 18 fetch API: https://nodejs.org/en/blog/announcements/v18-release-announce (stable, unflagged) — HIGH confidence
- OSV.dev REST API: https://osv.dev/docs/ — used in training; verify endpoint stability before building
- Octokit REST: https://octokit.github.io/rest.js/ — HIGH confidence, GitHub-maintained
- Fastify v4 docs: https://www.fastify.io/docs/latest/ — MEDIUM confidence on v4 vs v5 status
- msw v2 docs: https://mswjs.io/docs/ — MEDIUM confidence, verify fetch interception support
