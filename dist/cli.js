#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import ora from "ora";
import chalk2 from "chalk";
import { checkbox } from "@inquirer/prompts";
import { readFileSync as readFileSync3 } from "fs";
import { join as join3 } from "path";
import semver3 from "semver";

// src/parser/lockfile.ts
import { readFileSync } from "fs";
import { join } from "path";
function parseLockfileContent(lockfileContent, manifestContent) {
  const lockfile = JSON.parse(lockfileContent);
  const directNames = /* @__PURE__ */ new Set();
  try {
    const manifest = JSON.parse(manifestContent);
    for (const name of Object.keys(manifest.dependencies ?? {})) directNames.add(name);
    for (const name of Object.keys(manifest.devDependencies ?? {})) directNames.add(name);
    for (const name of Object.keys(manifest.optionalDependencies ?? {})) directNames.add(name);
    for (const name of Object.keys(manifest.peerDependencies ?? {})) directNames.add(name);
  } catch {
  }
  return buildDependencyMap(lockfile, directNames);
}
function keyToName(key) {
  const parts = key.split("node_modules/");
  return parts[parts.length - 1];
}
function flattenV1(deps, result, directNames, parentPath = []) {
  for (const [name, dep] of Object.entries(deps)) {
    if (!dep.version) continue;
    const existing = result.get(name);
    const isDirect = directNames.has(name) && parentPath.length === 0;
    if (!existing) {
      result.set(name, {
        version: dep.version,
        dev: dep.dev ?? false,
        direct: isDirect
      });
    }
    if (dep.dependencies) {
      flattenV1(dep.dependencies, result, directNames, [...parentPath, name]);
    }
  }
}
function parseLockfile(projectPath) {
  const lockfilePath = join(projectPath, "package-lock.json");
  const manifestPath = join(projectPath, "package.json");
  const lockfileContent = readFileSync(lockfilePath, "utf-8");
  let manifestContent = "{}";
  try {
    manifestContent = readFileSync(manifestPath, "utf-8");
  } catch {
  }
  return parseLockfileContent(lockfileContent, manifestContent);
}
function buildDependencyMap(lockfile, directNames) {
  const result = /* @__PURE__ */ new Map();
  const version = lockfile.lockfileVersion ?? 1;
  if (version >= 2 && lockfile.packages) {
    for (const [key, pkg] of Object.entries(lockfile.packages)) {
      if (!key || key === "") continue;
      if (!pkg.version) continue;
      const name = keyToName(key);
      if (!name) continue;
      if (!result.has(name)) {
        result.set(name, {
          version: pkg.version,
          dev: pkg.dev ?? pkg.devOptional ?? false,
          direct: directNames.has(name)
        });
      }
    }
  } else if (lockfile.dependencies) {
    flattenV1(lockfile.dependencies, result, directNames);
  }
  return result;
}

// src/input/resolver.ts
import { readFileSync as readFileSync2, existsSync } from "fs";
import { resolve, join as join2 } from "path";
function parseGitHubUrl(url) {
  const match = url.match(
    /github\.com[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+))?(?:\/.*)?$/
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], ref: match[3] ?? "HEAD" };
}
function makeHeaders() {
  const headers = { "User-Agent": "nodeguard/0.1" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
async function resolveDefaultBranch(owner, repo) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetch(apiUrl, { headers: makeHeaders() });
  if (res.ok) {
    const data = await res.json();
    if (data.default_branch) return data.default_branch;
  }
  return "main";
}
async function fetchRawFile(owner, repo, path, ref) {
  const headers = makeHeaders();
  const refsToTry = ref === "HEAD" ? [ref, "main", "master"] : [ref];
  for (const tryRef of refsToTry) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${tryRef}/${path}`;
    const res = await fetch(rawUrl, { headers });
    if (res.ok) return res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Access denied fetching ${path} from ${owner}/${repo}.
  Private repo? Set GITHUB_TOKEN to a token with repo read access.`
      );
    }
  }
  throw new Error(
    `Could not fetch ${path} from ${owner}/${repo}.
  Make sure the repo has a ${path} committed at its root.
  (Checked refs: ${refsToTry.join(", ")})`
  );
}
async function findNodeProjectRoot(owner, repo, ref) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;
  const res = await fetch(apiUrl, { headers: makeHeaders() });
  if (!res.ok) return "";
  const data = await res.json();
  if (!data.tree) return "";
  const blobs = new Set(
    data.tree.filter((f) => f.type === "blob" && !f.path.includes("node_modules/")).map((f) => f.path)
  );
  const lockfileDirs = [];
  for (const p of blobs) {
    if (p === "package-lock.json") lockfileDirs.push("");
    else if (p.endsWith("/package-lock.json")) lockfileDirs.push(p.slice(0, -"/package-lock.json".length));
  }
  if (lockfileDirs.length === 0) return "";
  lockfileDirs.sort((a, b) => a.split("/").length - b.split("/").length);
  return lockfileDirs[0];
}
async function resolveProject(target) {
  if (/^https?:\/\/github\.com/i.test(target) || /^git@github\.com/i.test(target)) {
    const parsed = parseGitHubUrl(target);
    if (!parsed) {
      throw new Error(`Could not parse GitHub URL: ${target}`);
    }
    const { owner, repo } = parsed;
    const explicitRef = parsed.ref;
    const repoUrl = `https://github.com/${owner}/${repo}`;
    const ref = explicitRef === "HEAD" ? await resolveDefaultBranch(owner, repo) : explicitRef;
    let subdir = "";
    try {
      await fetchRawFile(owner, repo, "package-lock.json", ref);
    } catch {
      subdir = await findNodeProjectRoot(owner, repo, ref);
    }
    const prefix = subdir ? `${subdir}/` : "";
    const [lockfileContent, manifestContent] = await Promise.all([
      fetchRawFile(owner, repo, `${prefix}package-lock.json`, ref),
      fetchRawFile(owner, repo, `${prefix}package.json`, ref)
    ]);
    return { kind: "remote", repoUrl, lockfileContent, manifestContent };
  }
  const absPath = resolve(target);
  const lockfilePath = join2(absPath, "package-lock.json");
  const manifestPath = join2(absPath, "package.json");
  if (!existsSync(lockfilePath)) {
    throw new Error(`package-lock.json not found at ${lockfilePath}`);
  }
  return {
    kind: "local",
    repoUrl: inferRepoUrl(absPath),
    lockfileContent: readFileSync2(lockfilePath, "utf-8"),
    manifestContent: existsSync(manifestPath) ? readFileSync2(manifestPath, "utf-8") : "{}",
    localPath: absPath
  };
}
function inferRepoUrl(projectPath) {
  try {
    const gitConfig = readFileSync2(join2(projectPath, ".git", "config"), "utf-8");
    const match = gitConfig.match(/url\s*=\s*(https?:\/\/github\.com\/[^\s]+|git@github\.com:[^\s]+)/);
    if (match) return match[1].replace("git@github.com:", "https://github.com/").replace(/\.git$/, "");
  } catch {
  }
  return null;
}

// src/vuln/querier.ts
var OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
var OSV_VULN_URL = "https://api.osv.dev/v1/vulns";
var CHUNK_SIZE = 500;
var FETCH_CONCURRENCY = 10;
async function queryOsv(deps) {
  const entries = Array.from(deps.entries());
  const idsByIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const body = {
      queries: chunk.map(([name, { version }]) => ({
        package: { name, ecosystem: "npm" },
        version
      }))
    };
    const res = await fetch(OSV_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`OSV.dev API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    for (let j = 0; j < chunk.length; j++) {
      const vulns = data.results[j]?.vulns ?? [];
      if (vulns.length > 0) {
        idsByIndex.set(i + j, vulns.map((v) => v.id));
      }
    }
  }
  if (idsByIndex.size === 0) return /* @__PURE__ */ new Map();
  const allIds = /* @__PURE__ */ new Set();
  for (const ids of idsByIndex.values()) {
    for (const id of ids) allIds.add(id);
  }
  const vulnDetails = /* @__PURE__ */ new Map();
  const idArray = Array.from(allIds);
  for (let i = 0; i < idArray.length; i += FETCH_CONCURRENCY) {
    const batch = idArray.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const res = await fetch(`${OSV_VULN_URL}/${id}`);
        if (!res.ok) throw new Error(`Failed to fetch vuln ${id}: ${res.status}`);
        const vuln = await res.json();
        return vuln;
      })
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        vulnDetails.set(result.value.id, result.value);
      }
    }
  }
  const packageVulns = /* @__PURE__ */ new Map();
  for (const [idx, ids] of idsByIndex.entries()) {
    const [name] = entries[idx];
    const vulns = ids.map((id) => vulnDetails.get(id)).filter((v) => v !== void 0);
    if (vulns.length > 0) {
      packageVulns.set(name, vulns);
    }
  }
  return packageVulns;
}

// src/semver/matcher.ts
import semver from "semver";
function osvEventsToRange(events) {
  const parts = [];
  let current = null;
  for (const event of events) {
    if (event.introduced !== void 0) {
      current = event.introduced === "0" ? ">=0.0.0" : `>=${event.introduced}`;
    } else if (event.fixed !== void 0 && current !== null) {
      parts.push(`${current} <${event.fixed}`);
      current = null;
    } else if (event.last_affected !== void 0 && current !== null) {
      parts.push(`${current} <=${event.last_affected}`);
      current = null;
    }
  }
  if (current !== null) {
    parts.push(current);
  }
  return parts.join(" || ");
}
function extractFixVersion(vuln, packageName) {
  for (const affected of vuln.affected ?? []) {
    if (affected.package.name !== packageName) continue;
    for (const range of affected.ranges ?? []) {
      if (range.type !== "SEMVER") continue;
      for (const event of range.events) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}
function normalizeSeverity(vuln) {
  const topSev = vuln.database_specific?.severity;
  if (topSev) return mapSeverityString(topSev);
  for (const affected of vuln.affected ?? []) {
    const sev = affected.database_specific?.severity ?? affected.ecosystem_specific?.severity;
    if (sev) return mapSeverityString(sev);
  }
  for (const s of vuln.severity ?? []) {
    if (s.type === "CVSS_V3" || s.type === "CVSS_V2") {
      const score = cvssVectorToScore(s.score);
      if (score !== null) {
        if (score >= 9) return "CRITICAL";
        if (score >= 7) return "HIGH";
        if (score >= 4) return "MEDIUM";
        return "LOW";
      }
    }
  }
  return "UNKNOWN";
}
function mapSeverityString(s) {
  const upper = s.toUpperCase();
  if (upper === "CRITICAL") return "CRITICAL";
  if (upper === "HIGH") return "HIGH";
  if (upper === "MEDIUM" || upper === "MODERATE") return "MEDIUM";
  if (upper === "LOW") return "LOW";
  return "UNKNOWN";
}
function cvssVectorToScore(vector) {
  const match = vector.match(/\/C:([HLN])\/I:([HLN])\/A:([HLN])/);
  if (!match) return null;
  const val = (s) => s === "H" ? 3 : s === "L" ? 1 : 0;
  const sum = val(match[1]) + val(match[2]) + val(match[3]);
  if (sum >= 8) return 9.8;
  if (sum >= 5) return 7.5;
  if (sum >= 2) return 5;
  return 2;
}
function isAffected(installedVersion, vuln, packageName) {
  for (const affected of vuln.affected ?? []) {
    if (affected.package.name !== packageName || affected.package.ecosystem !== "npm") continue;
    if (affected.versions?.includes(installedVersion)) return true;
    for (const range of affected.ranges ?? []) {
      if (range.type !== "SEMVER") continue;
      const rangeStr = osvEventsToRange(range.events);
      if (!rangeStr) continue;
      try {
        if (semver.satisfies(installedVersion, rangeStr, { includePrerelease: true })) {
          return true;
        }
      } catch {
      }
    }
  }
  return false;
}
function matchVulnerabilities(deps, osvResults) {
  const matches = [];
  for (const [name, vulns] of osvResults.entries()) {
    const dep = deps.get(name);
    if (!dep) continue;
    for (const vuln of vulns) {
      if (!isAffected(dep.version, vuln, name)) continue;
      matches.push({
        package: name,
        installedVersion: dep.version,
        fixVersion: extractFixVersion(vuln, name),
        severity: normalizeSeverity(vuln),
        id: vuln.id,
        summary: vuln.summary ?? "No description available",
        kind: dep.direct ? "direct" : "transitive",
        chain: [],
        aliases: vuln.aliases ?? []
      });
    }
  }
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
  return matches.sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
}

// src/report/table.ts
import chalk from "chalk";
import Table from "cli-table3";
var SEVERITY_COLOR = {
  CRITICAL: chalk.bgRed.white.bold,
  HIGH: chalk.red.bold,
  MEDIUM: chalk.yellow.bold,
  LOW: chalk.cyan,
  UNKNOWN: chalk.gray
};
function colorSeverity(severity) {
  return (SEVERITY_COLOR[severity] ?? chalk.white)(severity);
}
function printTable(vulns) {
  if (vulns.length === 0) {
    console.log(chalk.green("\n\u2713 No vulnerabilities found.\n"));
    return;
  }
  const table = new Table({
    head: [
      chalk.bold("Package"),
      chalk.bold("Severity"),
      chalk.bold("ID"),
      chalk.bold("Installed"),
      chalk.bold("Fix Version"),
      chalk.bold("Type")
    ],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [28, 12, 22, 12, 14, 12]
  });
  for (const v of vulns) {
    table.push([
      chalk.white(v.package),
      colorSeverity(v.severity),
      chalk.dim(v.id),
      chalk.yellow(v.installedVersion),
      v.fixVersion ? chalk.green(v.fixVersion) : chalk.red("none"),
      v.kind === "direct" ? chalk.white("direct") : chalk.dim("transitive")
    ]);
    if (v.kind === "transitive" && v.chain.length > 0) {
      table.push([{ colSpan: 6, content: chalk.dim(`  via: ${v.chain.join(" \u2192 ")}`) }]);
    }
  }
  const critCount = vulns.filter((v) => v.severity === "CRITICAL").length;
  const highCount = vulns.filter((v) => v.severity === "HIGH").length;
  const medCount = vulns.filter((v) => v.severity === "MEDIUM").length;
  const lowCount = vulns.filter((v) => v.severity === "LOW").length;
  console.log();
  console.log(table.toString());
  console.log();
  console.log(
    chalk.bold("Summary:"),
    `${vulns.length} vulnerabilit${vulns.length === 1 ? "y" : "ies"} found \u2014`,
    critCount > 0 ? chalk.bgRed.white.bold(` ${critCount} CRITICAL `) : "",
    highCount > 0 ? chalk.red.bold(`${highCount} HIGH`) : "",
    medCount > 0 ? chalk.yellow(`${medCount} MEDIUM`) : "",
    lowCount > 0 ? chalk.cyan(`${lowCount} LOW`) : ""
  );
  console.log();
}

// src/report/json.ts
function printJson(vulns) {
  const output = {
    vulnerabilities: vulns.map((v) => ({
      package: v.package,
      installedVersion: v.installedVersion,
      fixVersion: v.fixVersion,
      severity: v.severity,
      id: v.id,
      aliases: v.aliases,
      summary: v.summary,
      kind: v.kind,
      chain: v.chain
    })),
    summary: {
      total: vulns.length,
      critical: vulns.filter((v) => v.severity === "CRITICAL").length,
      high: vulns.filter((v) => v.severity === "HIGH").length,
      medium: vulns.filter((v) => v.severity === "MEDIUM").length,
      low: vulns.filter((v) => v.severity === "LOW").length
    }
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

// src/github/pr.ts
import { Octokit } from "@octokit/rest";
function parseGitHubUrl2(url) {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
async function getOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is not set.\nCreate a token at https://github.com/settings/tokens with:\n  - contents: write\n  - pull-requests: write"
    );
  }
  return new Octokit({ auth: token });
}
async function checkTokenPermissions(octokit, owner, repo) {
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    const perms = data.permissions;
    if (perms && !perms.push) {
      throw new Error(
        `GitHub token lacks write access to ${owner}/${repo}.
Ensure your token has: contents: write, pull-requests: write`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("lacks write access")) throw err;
    if (err instanceof Error && err.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found or token lacks read access.`);
    }
    throw err;
  }
}
async function createFixPr(octokit, repoUrl, vulns, fixVersion, packageJsonContent) {
  const info = parseGitHubUrl2(repoUrl);
  if (!info) throw new Error(`Cannot parse GitHub URL: ${repoUrl}`);
  const { owner, repo } = info;
  const pkgName = vulns[0].package;
  const installedVersion = vulns[0].installedVersion;
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch;
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`
  });
  const baseSha = refData.object.sha;
  const branchName = `nodeguard/fix-${pkgName.replace(/[@/]/g, "-")}`;
  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    });
  } catch (err) {
    if (err.status === 422) {
      throw new Error(`Branch ${branchName} already exists. PR may have been created already.`);
    }
    throw err;
  }
  const { data: fileData } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: "package.json",
    ref: defaultBranch
  });
  if (Array.isArray(fileData) || fileData.type !== "file") {
    throw new Error("package.json not found or is a directory");
  }
  const ids = vulns.map((v) => v.id).join(", ");
  const encodedContent = Buffer.from(packageJsonContent).toString("base64");
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: "package.json",
    message: `fix(deps): bump ${pkgName} to ${fixVersion}

Fixes: ${ids}`,
    content: encodedContent,
    sha: fileData.sha,
    branch: branchName
  });
  const vulnRows = vulns.map((v) => `| ${v.id} | ${v.severity} | ${v.summary} |`).join("\n");
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `fix(deps): bump ${pkgName} from ${installedVersion} to ${fixVersion}`,
    body: [
      `## Security Fix
`,
      `Bumps \`${pkgName}\` from \`${installedVersion}\` to \`${fixVersion}\` to address ${vulns.length} vulnerabilit${vulns.length === 1 ? "y" : "ies"}.
`,
      `| ID | Severity | Summary |`,
      `|----|----------|---------|`,
      vulnRows,
      `
---
_Generated by [NodeGuard](https://github.com/nodeguard/nodeguard)_`
    ].join("\n"),
    head: branchName,
    base: defaultBranch
  });
  return pr.html_url;
}
function bumpPackageJson(content, packageName, newVersion) {
  const manifest = JSON.parse(content);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (manifest[field]?.[packageName] !== void 0) {
      const current = manifest[field][packageName];
      const prefix = /^[\^~>=<]/.test(current) ? current.match(/^[^0-9]*/)?.[0] ?? "" : "";
      manifest[field][packageName] = `${prefix}${newVersion}`;
    }
  }
  return JSON.stringify(manifest, null, 2) + "\n";
}

// src/server/index.ts
import Fastify from "fastify";
import { execSync } from "child_process";
import semver2 from "semver";
import { Octokit as Octokit2 } from "@octokit/rest";

// src/metrics.ts
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import { collectDefaultMetrics } from "prom-client";
var registry = new Registry();
collectDefaultMetrics({ register: registry });
var scanCounter = new Counter({
  name: "nodeguard_scans_total",
  help: "Total number of repository scans performed",
  labelNames: ["status"],
  // status: success | error
  registers: [registry]
});
var vulnsGauge = new Gauge({
  name: "nodeguard_vulnerabilities_found",
  help: "Number of vulnerabilities found in the last scan",
  labelNames: ["severity"],
  // severity: CRITICAL | HIGH | MODERATE | LOW
  registers: [registry]
});
var prsCounter = new Counter({
  name: "nodeguard_prs_created_total",
  help: "Total number of fix PRs created",
  labelNames: ["status"],
  // status: success | error
  registers: [registry]
});
var scanDuration = new Histogram({
  name: "nodeguard_scan_duration_seconds",
  help: "Duration of repository scans in seconds",
  buckets: [0.5, 1, 2, 5, 10, 20, 30],
  registers: [registry]
});
var fixDuration = new Histogram({
  name: "nodeguard_fix_duration_seconds",
  help: "Duration of fix PR creation in seconds",
  buckets: [1, 2, 5, 10, 20, 30, 60],
  registers: [registry]
});

// src/server/index.ts
async function startUiServer(vulns, targetLabel, opts = {}) {
  let currentVulns = [...vulns];
  let currentTarget = targetLabel;
  let currentManifest = opts.manifestContent ?? "";
  let currentRepoUrl = opts.repoUrl ?? null;
  const createdPrs = [];
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  }));
  app.get("/metrics", async (_, reply) => {
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });
  app.get("/api/vulns", async () => ({
    target: currentTarget,
    scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
    summary: {
      total: currentVulns.length,
      critical: currentVulns.filter((v) => v.severity === "CRITICAL").length,
      high: currentVulns.filter((v) => v.severity === "HIGH").length,
      medium: currentVulns.filter((v) => v.severity === "MEDIUM").length,
      low: currentVulns.filter((v) => v.severity === "LOW").length
    },
    vulnerabilities: currentVulns
  }));
  app.get("/api/status", async () => ({
    hasToken: !!process.env.GITHUB_TOKEN,
    repoUrl: currentRepoUrl,
    fixableCount: currentVulns.filter((v) => v.kind === "direct" && v.fixVersion).length,
    prCount: createdPrs.length
  }));
  app.get("/api/prs", async () => {
    const token = process.env.GITHUB_TOKEN;
    const repoMatch = currentRepoUrl?.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (token && repoMatch) {
      try {
        const octokit = new Octokit2({ auth: token });
        const { data } = await octokit.rest.pulls.list({
          owner: repoMatch[1],
          repo: repoMatch[2],
          state: "all",
          per_page: 100
        });
        const prs = data.filter((pr) => pr.head.ref.startsWith("nodeguard/")).map((pr) => ({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: pr.merged_at ? "merged" : pr.state,
          branch: pr.head.ref,
          createdAt: pr.created_at
        }));
        return { prs, source: "github" };
      } catch {
      }
    }
    return { prs: createdPrs, source: "session" };
  });
  app.post("/api/fix", async (req, reply) => {
    const { ids, repoUrl: bodyRepoUrl, token: bodyToken } = req.body;
    const repoUrl = bodyRepoUrl || currentRepoUrl;
    const authToken = bodyToken?.trim() || process.env.GITHUB_TOKEN;
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.hijack();
    const send = (event, data) => {
      reply.raw.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
    };
    try {
      if (!authToken) {
        send("error", { message: "No GitHub token. Enter your personal access token above.\n\nCreate one at github.com/settings/tokens with: contents: write, pull-requests: write." });
        reply.raw.end();
        return;
      }
      const octokit = new Octokit2({ auth: authToken });
      if (!repoUrl) {
        send("error", { message: "No repository URL. Enter it above or pass --repo when starting nodeguard --ui." });
        reply.raw.end();
        return;
      }
      const repoMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (repoMatch) {
        try {
          await checkTokenPermissions(octokit, repoMatch[1], repoMatch[2]);
        } catch (err) {
          send("error", { message: String(err) });
          reply.raw.end();
          return;
        }
      }
      if (!currentManifest && repoMatch) {
        try {
          const { data: fileData } = await octokit.rest.repos.getContent({
            owner: repoMatch[1],
            repo: repoMatch[2],
            path: "package.json"
          });
          if (!Array.isArray(fileData) && fileData.type === "file" && "content" in fileData) {
            currentManifest = Buffer.from(fileData.content, "base64").toString("utf-8");
          }
        } catch (err) {
          send("error", { message: `Failed to fetch package.json: ${String(err)}` });
          reply.raw.end();
          return;
        }
      }
      const idSet = new Set(ids);
      const selected = currentVulns.filter(
        (v) => idSet.has(`${v.id}|${v.package}`) && v.kind === "direct" && v.fixVersion
      );
      if (selected.length === 0) {
        send("error", { message: "No directly fixable vulnerabilities in selection." });
        reply.raw.end();
        return;
      }
      const grouped = /* @__PURE__ */ new Map();
      for (const vuln of selected) {
        if (!vuln.fixVersion) continue;
        const existing = grouped.get(vuln.package);
        if (!existing) {
          grouped.set(vuln.package, { vulns: [vuln], fixVersion: vuln.fixVersion });
        } else {
          existing.vulns.push(vuln);
          if (semver2.gt(vuln.fixVersion, existing.fixVersion)) {
            existing.fixVersion = vuln.fixVersion;
          }
        }
      }
      send("start", { total: grouped.size });
      for (const [pkgName, { vulns: pkgVulns, fixVersion }] of grouped) {
        send("progress", { package: pkgName, fixVersion, status: "creating" });
        const fixTimer = fixDuration.startTimer();
        try {
          const updatedContent = bumpPackageJson(currentManifest, pkgName, fixVersion);
          const prUrl = await createFixPr(octokit, repoUrl, pkgVulns, fixVersion, updatedContent);
          currentManifest = updatedContent;
          createdPrs.push({
            title: `fix(deps): bump ${pkgName} to ${fixVersion}`,
            url: prUrl,
            state: "open",
            branch: `nodeguard/fix-${pkgName.replace(/[@/]/g, "-")}`,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          prsCounter.inc({ status: "success" });
          fixTimer();
          send("progress", { package: pkgName, fixVersion, status: "done", prUrl });
        } catch (err) {
          prsCounter.inc({ status: "error" });
          fixTimer();
          send("progress", { package: pkgName, fixVersion, status: "error", error: String(err) });
        }
      }
      send("done", {});
    } catch (err) {
      send("error", { message: String(err) });
    }
    reply.raw.end();
  });
  app.post("/api/scan", async (req, reply) => {
    const { repoUrl } = req.body;
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.hijack();
    const send = (event, data) => {
      reply.raw.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
    };
    const scanTimer = scanDuration.startTimer();
    try {
      if (!repoUrl?.trim()) {
        send("error", { message: "Please enter a GitHub repository URL." });
        reply.raw.end();
        return;
      }
      send("step", { id: "resolve", status: "running", message: "Fetching repository files\u2026" });
      const project = await resolveProject(repoUrl.trim());
      if (project.kind !== "remote") {
        send("error", { message: "Only remote GitHub URLs are supported for UI scans." });
        reply.raw.end();
        return;
      }
      send("step", { id: "resolve", status: "done", message: "Repository files fetched" });
      send("step", { id: "parse", status: "running", message: "Parsing package-lock.json\u2026" });
      const deps = parseLockfileContent(project.lockfileContent, project.manifestContent);
      send("step", { id: "parse", status: "done", message: `Parsed ${deps.size} dependencies` });
      send("step", { id: "query", status: "running", message: `Querying OSV.dev for ${deps.size} packages\u2026` });
      const osvResults = await queryOsv(deps);
      send("step", { id: "query", status: "done", message: `OSV.dev returned ${osvResults.size} packages with findings` });
      send("step", { id: "match", status: "running", message: "Matching vulnerabilities\u2026" });
      const newVulns = matchVulnerabilities(deps, osvResults);
      send("step", { id: "match", status: "done", message: `Found ${newVulns.length} vulnerabilit${newVulns.length === 1 ? "y" : "ies"}` });
      currentVulns = newVulns;
      currentTarget = repoUrl.trim();
      currentManifest = project.manifestContent;
      currentRepoUrl = project.repoUrl ?? repoUrl.trim();
      scanCounter.inc({ status: "success" });
      scanTimer();
      const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
      for (const sev of severities) {
        vulnsGauge.set({ severity: sev }, newVulns.filter((v) => v.severity === sev).length);
      }
      send("done", {
        count: newVulns.length,
        target: currentTarget,
        summary: {
          total: newVulns.length,
          critical: newVulns.filter((v) => v.severity === "CRITICAL").length,
          high: newVulns.filter((v) => v.severity === "HIGH").length,
          medium: newVulns.filter((v) => v.severity === "MEDIUM").length,
          low: newVulns.filter((v) => v.severity === "LOW").length
        }
      });
    } catch (err) {
      scanCounter.inc({ status: "error" });
      scanTimer();
      send("error", { message: String(err) });
    }
    reply.raw.end();
  });
  app.get("/", async (_req, reply) => {
    reply.type("text/html").send(getDashboardHtml());
  });
  const port = await findPort(Number(process.env.PORT) || 3847);
  await app.listen({ port, host: "127.0.0.1" });
  const url = `http://localhost:${port}`;
  console.log(`
  NodeGuard UI \u2192 ${url}
`);
  openBrowser(url);
  process.on("SIGINT", async () => {
    await app.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await app.close();
    process.exit(0);
  });
  await new Promise(() => {
  });
}
async function findPort(preferred) {
  const { createServer } = await import("net");
  return new Promise((resolve2) => {
    const s = createServer();
    s.listen(preferred, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => resolve2(addr.port));
    });
    s.on("error", () => resolve2(findPort(preferred + 1)));
  });
}
function openBrowser(url) {
  try {
    const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "${url}"` : `xdg-open "${url}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch {
  }
}
function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NodeGuard \u2014 Vulnerability Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:     #ffffff;
  --bg2:    #f9fafb;
  --bg3:    #f3f4f6;
  --border: #e5e7eb;
  --bdr2:   #d1d5db;
  --text:   #111827;
  --text2:  #6b7280;
  --text3:  #9ca3af;
  --red:    #dc2626;
  --orange: #d97706;
  --blue:   #2563eb;
  --green:  #16a34a;
  --indigo: #4f46e5;
  --font:   'Plus Jakarta Sans', sans-serif;
  --mono:   'JetBrains Mono', monospace;
}

[data-theme="dark"] {
  --bg:     #000000;
  --bg2:    #0a0a0a;
  --bg3:    #111111;
  --border: #1f1f1f;
  --bdr2:   #2d2d2d;
  --text:   #f9fafb;
  --text2:  #9ca3af;
  --text3:  #6b7280;
}

html, body { min-height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* \u2500\u2500 HEADER \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
header {
  height: 52px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 100;
}
.logo-icon { width: 18px; height: 18px; color: var(--indigo); flex-shrink: 0; }
.logo-name { font-weight: 700; font-size: 15px; letter-spacing: -.01em; }
.logo-tag  {
  font-family: var(--mono); font-size: 10px; color: var(--text3);
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 3px; padding: 1px 6px;
}
.hgap { flex: 1; }
.hdr-right { display: flex; align-items: center; gap: 10px; }
.scan-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--green);
  box-shadow: 0 0 0 2px #dcfce7;
  animation: blink 2.5s ease-in-out infinite;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
.hdr-repo {
  font-family: var(--mono); font-size: 12px; color: var(--text2); font-weight: 500;
  max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hdr-time { font-family: var(--mono); font-size: 11px; color: var(--text3); }

/* \u2500\u2500 THEME BUTTON \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.theme-btn {
  width: 30px; height: 30px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg2);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--text2); transition: all .12s; flex-shrink: 0;
}
.theme-btn:hover { background: var(--bg3); color: var(--text); }
.theme-btn svg { width: 14px; height: 14px; }

/* \u2500\u2500 MAIN \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
main { max-width: 1280px; margin: 0 auto; padding: 24px; padding-bottom: 88px; }

/* \u2500\u2500 STAT CARDS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.sc {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 18px;
  position: relative;
  overflow: hidden;
}
.sc::after {
  content: '';
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 3px;
  border-radius: 8px 0 0 8px;
}
.sc.st::after  { background: var(--bdr2); }
.sc.sc_::after { background: var(--red); }
.sc.sh::after  { background: var(--orange); }
.sc.sm::after  { background: var(--blue); }
.sc.sl::after  { background: var(--green); }
.sc-n {
  font-size: 28px; font-weight: 700;
  letter-spacing: -.02em; line-height: 1;
  margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}
.sc.st  .sc-n { color: var(--text); }
.sc.sc_ .sc-n { color: var(--red); }
.sc.sh  .sc-n { color: var(--orange); }
.sc.sm  .sc-n { color: var(--blue); }
.sc.sl  .sc-n { color: var(--green); }
.sc-label { font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: .07em; }

/* \u2500\u2500 TOOLBAR \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.fb {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text2);
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all .12s;
  white-space: nowrap;
}
.fb:hover { background: var(--bg2); border-color: var(--bdr2); color: var(--text); }
.fb.active.fa  { background: var(--bg2); border-color: var(--bdr2); color: var(--text); }
.fb.active.fc  { background: #fef2f2; border-color: #fca5a5; color: var(--red); }
.fb.active.fh  { background: #fffbeb; border-color: #fcd34d; color: var(--orange); }
.fb.active.fm  { background: #eff6ff; border-color: #93c5fd; color: var(--blue); }
.fb.active.fl  { background: #f0fdf4; border-color: #86efac; color: var(--green); }
.fb.active.fd  { background: #eef2ff; border-color: #c7d2fe; color: var(--indigo); }
.fb.active.ft  { background: var(--bg3); border-color: var(--bdr2); color: var(--text); }
.fb.active.ff  { background: #f0fdf4; border-color: #86efac; color: var(--green); }
.fb.active.fu_ { background: #fef2f2; border-color: #fca5a5; color: var(--red); }
.sep { width: 1px; height: 20px; background: var(--border); margin: 0 2px; flex-shrink: 0; }
.srch { position: relative; margin-left: auto; }
.srch-ico { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--text3); pointer-events: none; }
.srch input {
  width: 240px; background: var(--bg);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 10px 6px 32px;
  font-family: var(--font); font-size: 13px; color: var(--text);
  outline: none; transition: border-color .15s, box-shadow .15s;
}
.srch input:focus { border-color: var(--indigo); box-shadow: 0 0 0 3px rgba(79,70,229,.1); }
.srch input::placeholder { color: var(--text3); }

/* \u2500\u2500 COUNT ROW \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.count-row { font-size: 13px; color: var(--text2); margin-bottom: 8px; }
.count-row strong { color: var(--text); font-weight: 600; }

/* \u2500\u2500 TABLE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.tbl-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
table { width: 100%; border-collapse: collapse; }
thead { background: var(--bg2); }
th {
  padding: 10px 14px;
  text-align: left; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .06em;
  color: var(--text3); border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tbody tr:last-child td { border-bottom: none; }
tbody tr { transition: background .08s; }
tbody tr:hover td { background: var(--bg2); }

/* \u2500\u2500 CHECKBOX \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.chk-cell { width: 36px; padding: 0 6px 0 14px !important; }
input[type=checkbox] { width: 14px; height: 14px; cursor: pointer; accent-color: var(--indigo); }

/* \u2500\u2500 BADGES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.badge::before { content:''; width:5px; height:5px; border-radius:50%; flex-shrink:0; }
.badge.CRITICAL { background:#fef2f2; color:var(--red);    border:1px solid #fca5a5; }
.badge.CRITICAL::before { background:var(--red); }
.badge.HIGH     { background:#fffbeb; color:var(--orange); border:1px solid #fcd34d; }
.badge.HIGH::before     { background:var(--orange); }
.badge.MEDIUM   { background:#eff6ff; color:var(--blue);   border:1px solid #93c5fd; }
.badge.MEDIUM::before   { background:var(--blue); }
.badge.LOW      { background:#f0fdf4; color:var(--green);  border:1px solid #86efac; }
.badge.LOW::before      { background:var(--green); }
.badge.UNKNOWN  { background:var(--bg2); color:var(--text2); border:1px solid var(--border); }
.badge.UNKNOWN::before  { background:var(--text2); }

.kind {
  display:inline-block; padding:2px 8px; border-radius:4px;
  font-size:11px; font-weight:600; white-space:nowrap;
}
.kind.direct     { background:#eef2ff; color:var(--indigo); border:1px solid #c7d2fe; }
.kind.transitive { background:var(--bg2); color:var(--text3); border:1px solid var(--border); }

.pkg  { font-family: var(--mono); font-size: 13px; font-weight: 500; }
.ver  { font-family: var(--mono); font-size: 12px; color: var(--text2); }
.fixv { font-family: var(--mono); font-size: 12px; color: var(--green); font-weight: 500; }
.nofx { font-family: var(--mono); font-size: 12px; color: var(--text3); }
.cve  { font-family: var(--mono); font-size: 12px; color: var(--text2); }
.dsc  { font-size: 13px; color: var(--text2); max-width: 300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* \u2500\u2500 LOADING / EMPTY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.loading {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 72px; color: var(--text2); font-size: 13px;
}
.spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--border); border-top-color: var(--indigo);
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.emptystate { padding: 64px 24px; text-align: center; }
.emptystate svg { width: 32px; height: 32px; display:block; margin:0 auto 12px; color:var(--green); }
.emptystate p { font-size: 13px; color: var(--text2); }

/* \u2500\u2500 FADE IN \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.fu { animation: fu .2s ease both; }
@keyframes fu { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }

/* \u2500\u2500 ACTION BAR \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.action-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: 64px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 24px; gap: 12px;
  transform: translateY(100%);
  transition: transform .2s ease;
  z-index: 200;
  box-shadow: 0 -4px 16px rgba(0,0,0,.06);
}
.action-bar.visible { transform: translateY(0); }
.ab-info { font-size: 13px; color: var(--text2); flex: 1; }
.ab-info strong { color: var(--text); }
.btn-primary {
  padding: 8px 18px;
  background: var(--indigo); color: #fff;
  border: none; border-radius: 6px;
  font-family: var(--font); font-size: 13px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center; gap: 7px;
  transition: opacity .12s;
  white-space: nowrap;
}
.btn-primary:hover { opacity: .88; }
.btn-primary:disabled { opacity: .35; cursor: not-allowed; }
.btn-primary svg { width: 14px; height: 14px; }

/* \u2500\u2500 MODAL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 300;
  opacity: 0; pointer-events: none;
  transition: opacity .15s;
}
.overlay.open { opacity: 1; pointer-events: all; }
.modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 100%; max-width: 560px;
  margin: 16px;
  overflow: hidden;
  transform: translateY(10px);
  transition: transform .15s;
}
[data-theme="dark"] .modal { background: #111111; border-color: #2a2a2a; }
.overlay.open .modal { transform: none; }

.modal-hdr {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
}
.modal-title { font-size: 15px; font-weight: 700; flex: 1; }
.modal-x {
  width: 26px; height: 26px; border-radius: 5px;
  border: 1px solid var(--border); background: var(--bg2);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--text2); font-size: 14px; line-height: 1;
}
.modal-x:hover { background: var(--bg3); color: var(--text); }

.modal-body { padding: 20px; }

.field-label {
  display: block; font-size: 11px; font-weight: 600;
  color: var(--text3); text-transform: uppercase; letter-spacing: .06em;
  margin-bottom: 6px;
}
.field-input {
  width: 100%; padding: 8px 12px;
  background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
  font-family: var(--mono); font-size: 13px; color: var(--text);
  outline: none; margin-bottom: 16px;
  transition: border-color .15s, box-shadow .15s;
}
.field-input:focus { border-color: var(--indigo); box-shadow: 0 0 0 3px rgba(79,70,229,.1); }

.pkg-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
.pi {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 6px;
  background: var(--bg2); border: 1px solid var(--border);
}
.pi-icon { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.pi-spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--border); border-top-color: var(--indigo);
  border-radius: 50%; animation: spin .7s linear infinite;
}
.pi-name { flex: 1; font-family: var(--mono); font-size: 12px; font-weight: 500; color: var(--text); }
.pi-ver  { font-family: var(--mono); font-size: 12px; color: var(--green); }
.pi-cve  { font-family: var(--mono); font-size: 11px; color: var(--text3); }

.modal-err {
  margin-bottom: 14px; padding: 10px 12px;
  border: 1px solid var(--red); border-radius: 6px;
  font-size: 12px; color: var(--red);
  background: rgba(220,38,38,.07);
  line-height: 1.5;
}

.modal-ftr {
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
}
.btn-ghost {
  padding: 7px 16px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg2); color: var(--text2);
  font-family: var(--font); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all .12s;
}
.btn-ghost:hover { background: var(--bg3); color: var(--text); }
.btn-ghost:disabled { opacity: .4; cursor: not-allowed; }

/* \u2500\u2500 PR LIST \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.pr-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid var(--border);
}
.pr-item:last-child { border-bottom: none; }
.pr-num  { font-family: var(--mono); font-size: 11px; color: var(--text3); white-space: nowrap; }
.pr-title { flex: 1; font-size: 13px; color: var(--text); line-height: 1.4; }
.pr-branch { font-family: var(--mono); font-size: 11px; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.pr-link { font-size: 12px; color: var(--indigo); text-decoration: none; white-space: nowrap; flex-shrink: 0; }
.pr-link:hover { text-decoration: underline; }
.pr-state { padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
.pr-state.open   { background: #f0fdf4; color: var(--green);  border: 1px solid #86efac; }
.pr-state.merged { background: #eef2ff; color: var(--indigo); border: 1px solid #c7d2fe; }
.pr-state.closed { background: var(--bg2); color: var(--text2); border: 1px solid var(--border); }
.pr-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px;
  background: var(--indigo); color: #fff;
  border-radius: 8px; font-size: 10px; font-weight: 700;
  margin-left: 4px; line-height: 1;
}
.prs-empty { padding: 32px 0; text-align: center; font-size: 13px; color: var(--text2); }
.prs-source { font-size: 11px; color: var(--text3); margin-bottom: 12px; }

/* \u2500\u2500 SCAN BUTTON \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.scan-btn {
  padding: 5px 12px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg2); color: var(--text2);
  font-family: var(--font); font-size: 12px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center; gap: 6px;
  transition: all .12s; white-space: nowrap;
}
.scan-btn:hover { background: var(--bg3); color: var(--text); border-color: var(--bdr2); }
.scan-btn svg { width: 13px; height: 13px; }

/* \u2500\u2500 SCAN STEPS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.step-list { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 16px; }
.step-row {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: var(--text3);
  transition: color .15s;
}
.step-row.s-running { color: var(--text); }
.step-row.s-done    { color: var(--text2); }
.step-row.s-error   { color: var(--red); }
.step-ico { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.step-spin {
  width: 13px; height: 13px;
  border: 2px solid var(--border); border-top-color: var(--indigo);
  border-radius: 50%; animation: spin .7s linear infinite;
}
.scan-result {
  padding: 12px 14px; border-radius: 6px;
  background: var(--bg2); border: 1px solid var(--border);
  font-size: 13px; display: flex; align-items: center; gap: 8px;
  margin-top: 4px;
}
.scan-result.has-vulns { border-color: #fca5a5; background: #fef2f2; color: var(--red); }
.scan-result.no-vulns  { border-color: #86efac; background: #f0fdf4; color: var(--green); }

/* \u2500\u2500 RESPONSIVE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
@media(max-width:960px) {
  .stats { grid-template-columns: repeat(3,1fr); }
  main { padding: 16px; padding-bottom: 88px; }
  header { padding: 0 16px; }
}
@media(max-width:600px) {
  .stats { grid-template-columns: repeat(2,1fr); }
  .hdr-time { display: none; }
}
</style>
</head>
<body>

<header>
  <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
  <span class="logo-name">NodeGuard</span>
  <span class="logo-tag">v0.1.0</span>
  <div class="hgap"></div>
  <div class="hdr-right">
    <div class="scan-dot"></div>
    <span class="hdr-repo" id="targetLabel">\u2014</span>
    <span class="hdr-time" id="scanTime">\u2014</span>
    <button class="scan-btn" onclick="openPrsModal()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
        <path d="M13 6h3a2 2 0 012 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>
      </svg>
      PRs<span class="pr-badge" id="prBadge" style="display:none">0</span>
    </button>
    <button class="scan-btn" onclick="openScanModal()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      Scan Repo
    </button>
    <button class="theme-btn" id="themeBtn" title="Toggle theme" onclick="toggleTheme()">
      <svg id="themeIco" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    </button>
  </div>
</header>

<main>

  <div class="stats">
    <div class="sc st">
      <div class="sc-n" id="numTotal">0</div>
      <div class="sc-label">Total</div>
    </div>
    <div class="sc sc_">
      <div class="sc-n" id="numCrit">0</div>
      <div class="sc-label">Critical</div>
    </div>
    <div class="sc sh">
      <div class="sc-n" id="numHigh">0</div>
      <div class="sc-label">High</div>
    </div>
    <div class="sc sm">
      <div class="sc-n" id="numMed">0</div>
      <div class="sc-label">Medium</div>
    </div>
    <div class="sc sl">
      <div class="sc-n" id="numLow">0</div>
      <div class="sc-label">Low</div>
    </div>
  </div>

  <div class="toolbar">
    <button class="fb fa active" data-f="ALL">All</button>
    <button class="fb fc" data-f="CRITICAL">Critical</button>
    <button class="fb fh" data-f="HIGH">High</button>
    <button class="fb fm" data-f="MEDIUM">Medium</button>
    <button class="fb fl" data-f="LOW">Low</button>
    <div class="sep"></div>
    <button class="fb fd" data-f="direct">Direct</button>
    <button class="fb ft" data-f="transitive">Transitive</button>
    <button class="fb ff" data-f="fixable">Fixable</button>
    <button class="fb fu_" data-f="unfixable">Unfixable</button>
    <div class="srch">
      <svg class="srch-ico" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
      </svg>
      <input id="searchInput" type="text" placeholder="Search package, CVE, GHSA\u2026" autocomplete="off" spellcheck="false">
    </div>
  </div>

  <div class="count-row" id="countRow"></div>

  <div class="tbl-wrap" id="tblWrap">
    <div class="loading"><div class="spinner"></div><span>Loading scan results\u2026</span></div>
  </div>

</main>

<!-- Action Bar -->
<div class="action-bar" id="actionBar">
  <div class="ab-info" id="abInfo"></div>
  <button class="btn-primary" id="btnFix" onclick="openFixModal()">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
      <path d="M13 6h3a2 2 0 012 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>
    </svg>
    Create GitHub PRs
  </button>
</div>

<!-- Fix Modal -->
<div class="overlay" id="overlay">
  <div class="modal">
    <div class="modal-hdr">
      <span class="modal-title">Create Fix PRs</span>
      <button class="modal-x" id="modalX" onclick="closeModal()">\u2715</button>
    </div>
    <div class="modal-body">
      <div class="modal-err" id="modalErr" style="display:none"></div>
      <div id="tokenSection" style="display:none">
        <label class="field-label">GitHub Personal Access Token</label>
        <input class="field-input" type="password" id="tokenInput" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off">
      </div>
      <div id="repoSection">
        <label class="field-label">Repository URL</label>
        <input class="field-input" type="text" id="repoInput" placeholder="https://github.com/owner/repo">
      </div>
      <label class="field-label">Packages to fix</label>
      <div class="pkg-list" id="pkgList"></div>
    </div>
    <div class="modal-ftr">
      <button class="btn-ghost" id="btnCancel" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="btnStart" onclick="startFix()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px">
          <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
        Create PRs
      </button>
    </div>
  </div>
</div>

<!-- PRs Modal -->
<div class="overlay" id="prsOverlay">
  <div class="modal">
    <div class="modal-hdr">
      <span class="modal-title">NodeGuard PRs</span>
      <button class="modal-x" onclick="closePrsModal()">\u2715</button>
    </div>
    <div class="modal-body" id="prsBody">
      <div class="loading"><div class="spinner"></div><span>Loading\u2026</span></div>
    </div>
    <div class="modal-ftr">
      <button class="btn-ghost" onclick="closePrsModal()">Close</button>
      <button class="btn-primary" onclick="loadPrs(true)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px">
          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        Refresh
      </button>
    </div>
  </div>
</div>

<!-- Scan Modal -->
<div class="overlay" id="scanOverlay">
  <div class="modal">
    <div class="modal-hdr">
      <span class="modal-title">Scan Repository</span>
      <button class="modal-x" id="scanModalX" onclick="closeScanModal()">\u2715</button>
    </div>
    <div class="modal-body">
      <div class="modal-err" id="scanErr" style="display:none"></div>
      <label class="field-label">GitHub Repository URL</label>
      <input class="field-input" type="text" id="scanRepoInput" placeholder="https://github.com/owner/repo" autocomplete="off">
      <div class="step-list" id="stepList" style="display:none">
        <div class="step-row" id="step-resolve"><div class="step-ico" id="si-resolve"></div><span id="st-resolve">Fetching repository files\u2026</span></div>
        <div class="step-row" id="step-parse">  <div class="step-ico" id="si-parse"></div>  <span id="st-parse">Parsing package-lock.json\u2026</span></div>
        <div class="step-row" id="step-query">  <div class="step-ico" id="si-query"></div>  <span id="st-query">Querying OSV.dev\u2026</span></div>
        <div class="step-row" id="step-match">  <div class="step-ico" id="si-match"></div>  <span id="st-match">Matching vulnerabilities\u2026</span></div>
      </div>
      <div id="scanResult" style="display:none"></div>
    </div>
    <div class="modal-ftr">
      <button class="btn-ghost" id="scanCancel" onclick="closeScanModal()">Cancel</button>
      <button class="btn-primary" id="btnScan" onclick="startScan()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Scan
      </button>
    </div>
  </div>
</div>

<script>
'use strict';
/* \u2500\u2500 state \u2500\u2500 */
var all=[], activeFilters=new Set(), q='';
var selected=new Set();
var uiStatus={hasToken:false,repoUrl:null,fixableCount:0};
var fixRunning=false;

/* \u2500\u2500 theme \u2500\u2500 */
var _theme=localStorage.getItem('ng-theme')||'light';
(function(){ document.documentElement.dataset.theme=_theme; updateThemeIco(); })();

function toggleTheme(){
  _theme=_theme==='light'?'dark':'light';
  document.documentElement.dataset.theme=_theme;
  localStorage.setItem('ng-theme',_theme);
  updateThemeIco();
}
function updateThemeIco(){
  var ico=document.getElementById('themeIco');
  if(!ico) return;
  if(_theme==='dark'){
    ico.innerHTML='<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  } else {
    ico.innerHTML='<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
}

/* \u2500\u2500 utils \u2500\u2500 */
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(d){ try{ return new Date(d).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return d; } }
function isFixable(v){ return v.kind==='direct' && !!v.fixVersion; }
function ckey(v){ return v.id+'|'+v.package; }
function safeId(s){ return s.replace(/[@/]/g,'-'); }

function countUp(el,to){
  if(!el) return;
  var dur=700,t0=performance.now();
  (function f(now){ var t=Math.min((now-t0)/dur,1),e=1-Math.pow(1-t,3); el.textContent=Math.round(to*e); if(t<1) requestAnimationFrame(f); })(t0);
}

/* \u2500\u2500 load \u2500\u2500 */
async function load(){
  try{
    var data=await fetch('/api/vulns').then(function(r){ return r.json(); });
    document.getElementById('targetLabel').textContent=data.target;
    document.getElementById('scanTime').textContent=fmt(data.scannedAt);
    var s=data.summary;
    countUp(document.getElementById('numTotal'),s.total);
    countUp(document.getElementById('numCrit'), s.critical);
    countUp(document.getElementById('numHigh'), s.high);
    countUp(document.getElementById('numMed'),  s.medium);
    countUp(document.getElementById('numLow'),  s.low);
    all=data.vulnerabilities;
    render();
  }catch(e){
    document.getElementById('tblWrap').innerHTML=\`<div class="emptystate"><p style="color:#dc2626">\${esc(String(e))}</p></div>\`;
  }
}

async function loadStatus(){
  try{
    uiStatus=await fetch('/api/status').then(r=>r.json());
    var badge=document.getElementById('prBadge');
    if(badge&&uiStatus.prCount>0){ badge.style.display='inline-flex'; badge.textContent=uiStatus.prCount; }
  }catch(e){ /* ignore */ }
}

/* \u2500\u2500 filter \u2500\u2500 */
function getFiltered(){
  return all.filter(function(v){
    // Severity group \u2014 OR within group, skip group if nothing selected
    var sevOn=['CRITICAL','HIGH','MEDIUM','LOW'].filter(function(s){ return activeFilters.has(s); });
    if(sevOn.length>0 && sevOn.indexOf(v.severity)===-1) return false;
    // Type group
    var dOn=activeFilters.has('direct'), tOn=activeFilters.has('transitive');
    if(dOn&&!tOn && v.kind!=='direct')     return false;
    if(tOn&&!dOn && v.kind!=='transitive') return false;
    // Fix status group
    var fxOn=activeFilters.has('fixable'), ufOn=activeFilters.has('unfixable');
    if(fxOn&&!ufOn && !v.fixVersion) return false;
    if(ufOn&&!fxOn &&  v.fixVersion) return false;
    // Search
    if(q){ var lq=q.toLowerCase(); if(!v.package.toLowerCase().includes(lq)&&!v.id.toLowerCase().includes(lq)) return false; }
    return true;
  });
}

/* \u2500\u2500 render \u2500\u2500 */
function render(){
  var f=getFiltered();
  var hasAnyFixable=all.some(isFixable);
  var cr=document.getElementById('countRow');
  cr.innerHTML=f.length===all.length
    ? \`<strong>\${all.length}</strong> vulnerabilities\`
    : \`<strong>\${f.length}</strong> of <strong>\${all.length}</strong> vulnerabilities\`;

  var wrap=document.getElementById('tblWrap');

  if(f.length===0){
    wrap.innerHTML=\`<div class="emptystate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 013 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg><p>No vulnerabilities match the current filter</p></div>\`;
    return;
  }

  var chkTh=hasAnyFixable?\`<th class="chk-cell"><input type="checkbox" id="hdrChk" title="Select all fixable" onchange="toggleAll(this.checked)"></th>\`:'';
  wrap.innerHTML=\`<table>
    <thead><tr>
      \${chkTh}
      <th>Package</th><th>Severity</th><th>CVE / GHSA</th>
      <th>Installed</th><th>Fix Version</th><th>Type</th><th>Description</th>
    </tr></thead>
    <tbody id="tbody"></tbody>
  </table>\`;

  // restore header checkbox state
  if(hasAnyFixable){
    var hc=document.getElementById('hdrChk');
    var fixAll=all.filter(isFixable);
    if(selected.size>0&&selected.size>=fixAll.length) hc.checked=true;
    else if(selected.size>0) hc.indeterminate=true;
  }

  document.getElementById('tbody').innerHTML=f.map(function(v,i){
    var fv=v.fixVersion?\`<span class="fixv">&#8594;&nbsp;\${esc(v.fixVersion)}</span>\`:\`<span class="nofx">\u2014</span>\`;
    var chkTd='';
    if(hasAnyFixable){
      if(isFixable(v)){
        var k=ckey(v);
        var chk=selected.has(k)?'checked':'';
        chkTd=\`<td class="chk-cell"><input type="checkbox" \${chk} data-key="\${esc(k)}" onchange="toggleRow(this.dataset.key,this.checked)"></td>\`;
      } else {
        chkTd='<td class="chk-cell"></td>';
      }
    }
    return \`<tr class="fu" style="animation-delay:\${Math.min(i*10,180)}ms">
      \${chkTd}
      <td><span class="pkg">\${esc(v.package)}</span></td>
      <td><span class="badge \${esc(v.severity)}">\${esc(v.severity)}</span></td>
      <td><span class="cve">\${esc(v.id)}</span></td>
      <td><span class="ver">\${esc(v.installedVersion)}</span></td>
      <td>\${fv}</td>
      <td><span class="kind \${esc(v.kind)}">\${esc(v.kind)}</span></td>
      <td><span class="dsc" title="\${esc(v.summary)}">\${esc(v.summary)}</span></td>
    </tr>\`;
  }).join('');
}

/* \u2500\u2500 selection \u2500\u2500 */
function toggleRow(key,checked){
  if(checked) selected.add(key); else selected.delete(key);
  updateActionBar();
  var hc=document.getElementById('hdrChk');
  if(hc){
    var fixAll=all.filter(isFixable);
    hc.indeterminate=selected.size>0&&selected.size<fixAll.length;
    hc.checked=selected.size>0&&selected.size===fixAll.length;
  }
}
function toggleAll(checked){
  var fixAll=all.filter(isFixable);
  if(checked) fixAll.forEach(function(v){ selected.add(ckey(v)); });
  else selected.clear();
  render();
  updateActionBar();
}
function updateActionBar(){
  var bar=document.getElementById('actionBar');
  var info=document.getElementById('abInfo');
  if(!bar||!info) return;
  if(selected.size===0){ bar.classList.remove('visible'); return; }
  bar.classList.add('visible');
  var pkgs=new Set(Array.from(selected).map(function(k){ return k.split('|')[1]; }));
  info.innerHTML='<strong>'+selected.size+'</strong> CVE'+(selected.size>1?'s':'')+' across <strong>'+pkgs.size+'</strong> package'+(pkgs.size>1?'s':'')+' selected';
}

/* \u2500\u2500 fix modal \u2500\u2500 */
function groupSelected(){
  var result=new Map();
  for(var k of selected){
    var parts=k.split('|'); var id=parts[0],pkg=parts[1];
    var v=all.find(function(x){ return x.id===id&&x.package===pkg; });
    if(!v||!isFixable(v)) continue;
    if(!result.has(pkg)) result.set(pkg,{pkg:pkg,fixVersion:v.fixVersion,cves:[]});
    var g=result.get(pkg);
    g.cves.push(id);
    if(v.fixVersion&&cmpVer(v.fixVersion,g.fixVersion)>0) g.fixVersion=v.fixVersion;
  }
  return result;
}
function cmpVer(a,b){
  var pa=(a||'0').split('.').map(Number);
  var pb=(b||'0').split('.').map(Number);
  for(var i=0;i<3;i++){ if((pa[i]||0)>(pb[i]||0)) return 1; if((pa[i]||0)<(pb[i]||0)) return -1; }
  return 0;
}

function openFixModal(){
  var overlay=document.getElementById('overlay');
  var tokenSection=document.getElementById('tokenSection');
  var tokenInput=document.getElementById('tokenInput');
  var repoSection=document.getElementById('repoSection');
  var repoInput=document.getElementById('repoInput');
  var pkgList=document.getElementById('pkgList');
  var btnStart=document.getElementById('btnStart');
  var btnCancel=document.getElementById('btnCancel');
  var modalErr=document.getElementById('modalErr');
  var modalX=document.getElementById('modalX');

  modalErr.style.display='none';
  btnStart.disabled=false;
  btnStart.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Create PRs';
  btnCancel.disabled=false;
  btnCancel.textContent='Cancel';
  modalX.style.display='';
  fixRunning=false;

  tokenSection.style.display=uiStatus.hasToken?'none':'block';
  if(!uiStatus.hasToken) tokenInput.value='';

  if(uiStatus.repoUrl){ repoSection.style.display='none'; repoInput.value=uiStatus.repoUrl; }
  else { repoSection.style.display='block'; repoInput.value=''; }

  var groups=groupSelected();
  pkgList.innerHTML='';
  groups.forEach(function(g){
    var el=document.createElement('div');
    el.className='pi'; el.id='pi-'+safeId(g.pkg);
    el.innerHTML=
      '<div class="pi-icon" id="pi-ico-'+safeId(g.pkg)+'"></div>'+
      '<span class="pi-name" id="pi-nm-'+safeId(g.pkg)+'">'+esc(g.pkg)+'</span>'+
      '<span class="pi-ver">&#8594; '+esc(g.fixVersion||'')+'</span>'+
      '<span class="pi-cve">'+g.cves.length+' CVE'+(g.cves.length>1?'s':'')+'</span>';
    pkgList.appendChild(el);
  });

  overlay.classList.add('open');
}

function closeModal(){
  if(fixRunning) return;
  document.getElementById('overlay').classList.remove('open');
}

async function startFix(){
  if(fixRunning) return;
  fixRunning=true;
  var btnStart=document.getElementById('btnStart');
  var btnCancel=document.getElementById('btnCancel');
  var modalX=document.getElementById('modalX');
  var modalErr=document.getElementById('modalErr');
  var repoInput=document.getElementById('repoInput');

  btnStart.disabled=true;
  btnStart.textContent='Creating\u2026';
  btnCancel.disabled=true;
  btnCancel.style.opacity='.4';
  modalX.style.display='none';
  modalErr.style.display='none';

  var repoUrl=uiStatus.repoUrl||document.getElementById('repoInput').value.trim();
  var tokenInput=document.getElementById('tokenInput');
  var token=tokenInput?tokenInput.value.trim():'';
  var ids=Array.from(selected);

  try{
    var resp=await fetch('/api/fix',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ids:ids,repoUrl:repoUrl,token:token||undefined})
    });
    var reader=resp.body.getReader();
    var decoder=new TextDecoder();
    var buf='';
    while(true){
      var chunk=await reader.read();
      if(chunk.done) break;
      buf+=decoder.decode(chunk.value,{stream:true});
      var parts=buf.split('\\n\\n');
      buf=parts.pop()||'';
      for(var part of parts){
        if(!part.trim()) continue;
        var lines=part.split('\\n');
        var evType='message',evData='';
        for(var line of lines){
          if(line.startsWith('event: ')) evType=line.slice(7).trim();
          else if(line.startsWith('data: ')) evData=line.slice(6);
        }
        if(evData) handleFixEvent(evType,JSON.parse(evData));
      }
    }
  }catch(e){
    setModalErr(String(e));
    return;
  }

  fixRunning=false;
  btnCancel.disabled=false;
  btnCancel.style.opacity='';
  btnCancel.textContent='Close';
  modalX.style.display='';
  btnStart.style.display='none';
  loadStatus();
}

function handleFixEvent(type,data){
  if(type==='error'){ setModalErr(data.message||'Unknown error'); return; }
  if(type==='progress'){
    var sid=safeId(data.package);
    var ico=document.getElementById('pi-ico-'+sid);
    var nm=document.getElementById('pi-nm-'+sid);
    if(!ico) return;
    if(data.status==='creating'){
      ico.innerHTML='<div class="pi-spinner"></div>';
    } else if(data.status==='done'){
      ico.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
      if(data.prUrl&&nm) nm.innerHTML='<a href="'+esc(data.prUrl)+'" target="_blank" rel="noopener" style="color:var(--indigo);text-decoration:none;font-family:var(--mono);font-size:12px;font-weight:500">'+esc(data.package)+' &#8599;</a>';
    } else if(data.status==='error'){
      ico.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      var pi=document.getElementById('pi-'+sid);
      if(pi){
        var errEl=document.createElement('div');
        errEl.style.cssText='font-size:11px;color:var(--red);padding:4px 0 0 26px;font-family:var(--mono)';
        errEl.textContent=data.error||'Failed';
        pi.insertAdjacentElement('afterend',errEl);
      }
    }
  }
}

function setModalErr(msg){
  var el=document.getElementById('modalErr');
  el.textContent=msg; el.style.display='block';
  var btnStart=document.getElementById('btnStart');
  var btnCancel=document.getElementById('btnCancel');
  var modalX=document.getElementById('modalX');
  btnStart.disabled=false;
  btnStart.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Retry';
  btnCancel.disabled=false; btnCancel.style.opacity=''; btnCancel.textContent='Cancel';
  modalX.style.display='';
  fixRunning=false;
}

/* \u2500\u2500 toolbar \u2500\u2500 */
function syncFilterBtns(){
  document.querySelectorAll('.fb').forEach(function(b){
    var f=b.dataset.f;
    b.classList.toggle('active', f==='ALL' ? activeFilters.size===0 : activeFilters.has(f));
  });
}
document.querySelectorAll('.fb').forEach(function(btn){
  btn.addEventListener('click',function(){
    var f=btn.dataset.f;
    if(f==='ALL'){ activeFilters.clear(); }
    else{ if(activeFilters.has(f)) activeFilters.delete(f); else activeFilters.add(f); }
    syncFilterBtns();
    render();
  });
});
document.getElementById('searchInput').addEventListener('input',function(e){
  q=e.target.value.trim();
  render();
});

/* \u2500\u2500 prs modal \u2500\u2500 */
function openPrsModal(){
  document.getElementById('prsOverlay').classList.add('open');
  loadPrs(false);
}
function closePrsModal(){
  document.getElementById('prsOverlay').classList.remove('open');
}
async function loadPrs(showSpinner){
  var body=document.getElementById('prsBody');
  if(showSpinner) body.innerHTML='<div class="loading"><div class="spinner"></div><span>Loading\u2026</span></div>';
  try{
    var data=await fetch('/api/prs').then(function(r){ return r.json(); });
    var prs=data.prs||[];
    // Update badge
    var badge=document.getElementById('prBadge');
    if(badge){ badge.style.display=prs.length>0?'inline-flex':'none'; badge.textContent=prs.length; }
    if(prs.length===0){
      body.innerHTML='<div class="prs-empty">No NodeGuard PRs found for this repository.<br>Use the Fix feature to create PRs for fixable vulnerabilities.</div>';
      return;
    }
    var src=data.source==='github'?'Live data from GitHub API':'Session data (set GITHUB_TOKEN for live status)';
    var html='<div class="prs-source">'+esc(src)+'</div>';
    prs.forEach(function(pr){
      var num=pr.number?'#'+pr.number:'';
      var stateLabel=pr.state==='merged'?'Merged':pr.state==='closed'?'Closed':'Open';
      html+='<div class="pr-item">'+
        '<span class="pr-state '+esc(pr.state)+'">'+esc(stateLabel)+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div class="pr-title">'+esc(pr.title)+'</div>'+
          '<div class="pr-branch">'+esc(pr.branch)+'</div>'+
        '</div>'+
        (num?'<span class="pr-num">'+esc(num)+'</span>':'')+
        '<a class="pr-link" href="'+esc(pr.url)+'" target="_blank" rel="noopener">View &#8599;</a>'+
      '</div>';
    });
    body.innerHTML=html;
  }catch(e){
    body.innerHTML='<div class="modal-err" style="margin:0">'+esc(String(e))+'</div>';
  }
}

/* \u2500\u2500 scan modal \u2500\u2500 */
var scanRunning=false;

function openScanModal(){
  var overlay=document.getElementById('scanOverlay');
  var stepList=document.getElementById('stepList');
  var scanResult=document.getElementById('scanResult');
  var scanErr=document.getElementById('scanErr');
  var btnScan=document.getElementById('btnScan');
  var scanCancel=document.getElementById('scanCancel');
  var scanModalX=document.getElementById('scanModalX');
  var scanRepoInput=document.getElementById('scanRepoInput');

  stepList.style.display='none';
  scanResult.style.display='none';
  scanErr.style.display='none';
  btnScan.disabled=false;
  btnScan.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Scan';
  scanCancel.disabled=false; scanCancel.textContent='Cancel';
  scanModalX.style.display='';
  scanRunning=false;
  if(uiStatus.repoUrl&&!scanRepoInput.value) scanRepoInput.value=uiStatus.repoUrl;
  overlay.classList.add('open');
  setTimeout(function(){ scanRepoInput.focus(); scanRepoInput.select(); },80);
}

function closeScanModal(){
  if(scanRunning) return;
  document.getElementById('scanOverlay').classList.remove('open');
}

var STEPS=['resolve','parse','query','match'];
function resetSteps(){
  STEPS.forEach(function(id){
    var row=document.getElementById('step-'+id);
    var ico=document.getElementById('si-'+id);
    if(row){ row.className='step-row'; }
    if(ico){ ico.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><circle cx="12" cy="12" r="9"/></svg>'; }
  });
}
function setStep(id,status,msg){
  var row=document.getElementById('step-'+id);
  var ico=document.getElementById('si-'+id);
  var txt=document.getElementById('st-'+id);
  if(!row) return;
  row.className='step-row s-'+status;
  if(msg&&txt) txt.textContent=msg;
  if(status==='running') ico.innerHTML='<div class="step-spin"></div>';
  else if(status==='done') ico.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
  else if(status==='error') ico.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
}

async function startScan(){
  if(scanRunning) return;
  var repoUrl=document.getElementById('scanRepoInput').value.trim();
  if(!repoUrl){ document.getElementById('scanErr').textContent='Please enter a repository URL.'; document.getElementById('scanErr').style.display='block'; return; }

  scanRunning=true;
  var btnScan=document.getElementById('btnScan');
  var scanCancel=document.getElementById('scanCancel');
  var scanModalX=document.getElementById('scanModalX');
  var stepList=document.getElementById('stepList');
  var scanResult=document.getElementById('scanResult');
  var scanErr=document.getElementById('scanErr');

  btnScan.disabled=true; btnScan.textContent='Scanning\u2026';
  scanCancel.disabled=true; scanCancel.style.opacity='.4';
  scanModalX.style.display='none';
  scanErr.style.display='none';
  scanResult.style.display='none';
  stepList.style.display='flex';
  resetSteps();

  try{
    var resp=await fetch('/api/scan',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({repoUrl:repoUrl})
    });
    var reader=resp.body.getReader();
    var decoder=new TextDecoder();
    var buf='';
    while(true){
      var chunk=await reader.read();
      if(chunk.done) break;
      buf+=decoder.decode(chunk.value,{stream:true});
      var parts=buf.split('\\n\\n');
      buf=parts.pop()||'';
      for(var part of parts){
        if(!part.trim()) continue;
        var lines=part.split('\\n');
        var evType='message',evData='';
        for(var line of lines){
          if(line.startsWith('event: ')) evType=line.slice(7).trim();
          else if(line.startsWith('data: ')) evData=line.slice(6);
        }
        if(!evData) continue;
        var d=JSON.parse(evData);
        if(evType==='step') setStep(d.id,d.status,d.message);
        else if(evType==='error'){
          scanErr.textContent=d.message; scanErr.style.display='block';
          btnScan.disabled=false; btnScan.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Retry';
          scanCancel.disabled=false; scanCancel.style.opacity=''; scanModalX.style.display='';
          scanRunning=false; return;
        }
        else if(evType==='done'){
          var n=d.count;
          scanResult.className='scan-result '+(n>0?'has-vulns':'no-vulns');
          scanResult.innerHTML=(n>0
            ?'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            :'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>')
            +(n>0?'<strong>'+n+' vulnerabilit'+(n===1?'y':'ies')+'</strong> found':'<strong>No vulnerabilities</strong> found \u2014 looking clean!');
          scanResult.style.display='flex';
        }
      }
    }
  }catch(e){
    scanErr.textContent=String(e); scanErr.style.display='block';
  }

  scanRunning=false;
  scanCancel.disabled=false; scanCancel.style.opacity=''; scanCancel.textContent='Close';
  scanModalX.style.display='';
  btnScan.style.display='none';
  // Reload dashboard data
  selected.clear();
  activeFilters.clear();
  syncFilterBtns();
  updateActionBar();
  load();
  loadStatus();
}

load();
loadStatus();
</script>
</body>
</html>`;
}

// src/cli.ts
process.on("SIGPIPE", () => process.exit(0));
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
});
var program = new Command();
program.name("nodeguard").description("Scan Node.js dependencies for known vulnerabilities and auto-create GitHub fix PRs").version("0.1.0").argument("<target>", "Local directory path or GitHub repo URL (https://github.com/owner/repo)").option("--json", "Output results as JSON").option("--ui", "Launch a local web dashboard to view results in the browser").option("--fix", "Interactively select vulnerabilities to fix via GitHub PR").option("--repo <url>", "GitHub repository URL override (for PR creation when target is a local path)").action(async (targetPath, options) => {
  const isJson = !!options.json;
  let spinner = isJson ? null : ora("Resolving target...").start();
  let project;
  try {
    project = await resolveProject(targetPath);
    spinner?.succeed(
      project.kind === "remote" ? `Fetched files from ${project.repoUrl}` : "Found local project"
    );
  } catch (err) {
    spinner?.fail("Failed to resolve target");
    console.error(chalk2.red(String(err)));
    process.exit(1);
  }
  spinner = isJson ? null : ora("Parsing package-lock.json...").start();
  let deps;
  try {
    deps = project.kind === "remote" ? parseLockfileContent(project.lockfileContent, project.manifestContent) : parseLockfile(project.localPath);
    spinner?.succeed(`Parsed ${deps.size} dependencies`);
  } catch (err) {
    spinner?.fail("Failed to parse package-lock.json");
    console.error(chalk2.red(String(err)));
    process.exit(1);
  }
  spinner = isJson ? null : ora(`Querying OSV.dev for ${deps.size} packages...`).start();
  let osvResults;
  try {
    osvResults = await queryOsv(deps);
    spinner?.succeed(`OSV.dev query complete (${osvResults.size} packages with findings)`);
  } catch (err) {
    spinner?.fail("OSV.dev query failed");
    console.error(chalk2.red(String(err)));
    process.exit(1);
  }
  const vulns = matchVulnerabilities(deps, osvResults);
  if (isJson) {
    printJson(vulns);
    process.exit(vulns.length > 0 ? 1 : 0);
  }
  printTable(vulns);
  if (options.ui) {
    const uiManifest = project.kind === "local" ? readFileSync3(join3(project.localPath, "package.json"), "utf-8") : project.manifestContent;
    await startUiServer(vulns, targetPath, {
      repoUrl: options.repo ?? project.repoUrl,
      manifestContent: uiManifest
    });
    return;
  }
  if (vulns.length === 0) {
    process.exit(0);
  }
  if (!options.fix) {
    console.log(chalk2.dim("Tip: Run with --fix to create GitHub PRs for direct dependency vulnerabilities.\n"));
    process.exit(1);
  }
  const directFixable = vulns.filter((v) => v.kind === "direct" && v.fixVersion !== null);
  if (directFixable.length === 0) {
    console.log(chalk2.yellow("No directly fixable vulnerabilities found (all are transitive or have no fix version).\n"));
    process.exit(1);
  }
  let octokit;
  try {
    octokit = await getOctokit();
  } catch (err) {
    console.error(chalk2.red("\n" + String(err)));
    process.exit(1);
  }
  const repoUrl = options.repo ?? project.repoUrl;
  if (!repoUrl) {
    console.error(chalk2.red("\nError: Could not determine GitHub repository URL."));
    console.error(chalk2.dim("Pass it explicitly: nodeguard . --fix --repo https://github.com/owner/repo"));
    process.exit(1);
  }
  const repoMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (repoMatch) {
    try {
      await checkTokenPermissions(octokit, repoMatch[1], repoMatch[2]);
    } catch (err) {
      console.error(chalk2.red("\n" + String(err)));
      process.exit(1);
    }
  }
  const selected = await checkbox({
    message: "Select vulnerabilities to fix (creates one PR per selection):",
    choices: directFixable.map((v) => ({
      name: `${v.package}  ${v.installedVersion} \u2192 ${v.fixVersion}  [${v.severity}] ${v.id}`,
      value: v,
      checked: v.severity === "CRITICAL" || v.severity === "HIGH"
    }))
  });
  if (selected.length === 0) {
    console.log(chalk2.yellow("\nNo vulnerabilities selected. Exiting.\n"));
    process.exit(0);
  }
  const grouped = /* @__PURE__ */ new Map();
  for (const vuln of selected) {
    if (!vuln.fixVersion) continue;
    const existing = grouped.get(vuln.package);
    if (!existing) {
      grouped.set(vuln.package, { vulns: [vuln], fixVersion: vuln.fixVersion });
    } else {
      existing.vulns.push(vuln);
      if (semver3.gt(vuln.fixVersion, existing.fixVersion)) {
        existing.fixVersion = vuln.fixVersion;
      }
    }
  }
  console.log(`
Creating ${grouped.size} PR${grouped.size === 1 ? "" : "s"} (grouped by package)...
`);
  let manifestContent = project.kind === "local" ? readFileSync3(join3(project.localPath, "package.json"), "utf-8") : project.manifestContent;
  for (const [pkgName, { vulns: vulns2, fixVersion }] of grouped) {
    const fixSpinner = ora(`Creating PR for ${pkgName} \u2192 ${fixVersion} (${vulns2.length} CVE${vulns2.length === 1 ? "" : "s"})...`).start();
    try {
      const updatedContent = bumpPackageJson(manifestContent, pkgName, fixVersion);
      const prUrl = await createFixPr(octokit, repoUrl, vulns2, fixVersion, updatedContent);
      manifestContent = updatedContent;
      fixSpinner.succeed(`PR created: ${chalk2.cyan(prUrl)}`);
    } catch (err) {
      fixSpinner.fail(`Failed to create PR for ${pkgName}: ${String(err)}`);
    }
  }
  console.log();
});
program.command("serve").description("Start the NodeGuard web server without an initial scan").option("--port <port>", "Port to listen on (overrides PORT env var)", "3847").option("--repo <url>", "Default GitHub repository URL").action(async (opts) => {
  process.env.PORT = opts.port;
  await startUiServer([], "Ready \u2014 use Scan Repo to begin", {
    repoUrl: opts.repo
  });
});
program.parse();
