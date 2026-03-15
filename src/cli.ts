// Handle EPIPE (e.g. piping to `head`)
process.on('SIGPIPE', () => process.exit(0))
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
})

import { Command } from 'commander'
import ora from 'ora'
import chalk from 'chalk'
import { checkbox } from '@inquirer/prompts'
import { readFileSync } from 'fs'
import { join } from 'path'
import semver from 'semver'
import { parseLockfile, parseLockfileContent } from './parser/lockfile.js'
import { resolveProject } from './input/resolver.js'
import { queryOsv } from './vuln/querier.js'
import { matchVulnerabilities } from './semver/matcher.js'
import { printTable } from './report/table.js'
import { printJson } from './report/json.js'
import { getOctokit, checkTokenPermissions, createFixPr, bumpPackageJson } from './github/pr.js'
import { startUiServer } from './server/index.js'
import type { VulnMatch } from './types.js'

const program = new Command()

program
  .name('nodeguard')
  .description('Scan Node.js dependencies for known vulnerabilities and auto-create GitHub fix PRs')
  .version('0.1.0')
  .argument('<target>', 'Local directory path or GitHub repo URL (https://github.com/owner/repo)')
  .option('--json', 'Output results as JSON')
  .option('--ui', 'Launch a local web dashboard to view results in the browser')
  .option('--fix', 'Interactively select vulnerabilities to fix via GitHub PR')
  .option('--repo <url>', 'GitHub repository URL override (for PR creation when target is a local path)')
  .action(async (targetPath: string, options: { json?: boolean; ui?: boolean; fix?: boolean; repo?: string }) => {
    const isJson = !!options.json

    // --- 1. Resolve target (local path or GitHub URL) ---
    let spinner = isJson ? null : ora('Resolving target...').start()
    let project
    try {
      project = await resolveProject(targetPath)
      spinner?.succeed(
        project.kind === 'remote'
          ? `Fetched files from ${project.repoUrl}`
          : 'Found local project'
      )
    } catch (err) {
      spinner?.fail('Failed to resolve target')
      console.error(chalk.red(String(err)))
      process.exit(1)
    }

    // --- 2. Parse lockfile ---
    spinner = isJson ? null : ora('Parsing package-lock.json...').start()
    let deps
    try {
      deps =
        project.kind === 'remote'
          ? parseLockfileContent(project.lockfileContent, project.manifestContent)
          : parseLockfile(project.localPath!)
      spinner?.succeed(`Parsed ${deps.size} dependencies`)
    } catch (err) {
      spinner?.fail('Failed to parse package-lock.json')
      console.error(chalk.red(String(err)))
      process.exit(1)
    }

    // --- 3. Query OSV.dev ---
    spinner = isJson ? null : ora(`Querying OSV.dev for ${deps.size} packages...`).start()
    let osvResults
    try {
      osvResults = await queryOsv(deps)
      spinner?.succeed(`OSV.dev query complete (${osvResults.size} packages with findings)`)
    } catch (err) {
      spinner?.fail('OSV.dev query failed')
      console.error(chalk.red(String(err)))
      process.exit(1)
    }

    // --- 4. Match vulnerabilities ---
    const vulns: VulnMatch[] = matchVulnerabilities(deps, osvResults)

    // --- 5. Output report ---
    if (isJson) {
      printJson(vulns)
      process.exit(vulns.length > 0 ? 1 : 0)
    }

    printTable(vulns)

    // --- 6. UI mode ---
    if (options.ui) {
      const uiManifest =
        project.kind === 'local'
          ? readFileSync(join(project.localPath!, 'package.json'), 'utf-8')
          : project.manifestContent
      await startUiServer(vulns, targetPath, {
        repoUrl: options.repo ?? project.repoUrl,
        manifestContent: uiManifest,
      })
      return
    }

    if (vulns.length === 0) {
      process.exit(0)
    }

    // --- 7. Fix flow (--fix flag) ---
    if (!options.fix) {
      console.log(chalk.dim('Tip: Run with --fix to create GitHub PRs for direct dependency vulnerabilities.\n'))
      process.exit(1)
    }

    const directFixable = vulns.filter(v => v.kind === 'direct' && v.fixVersion !== null)
    if (directFixable.length === 0) {
      console.log(chalk.yellow('No directly fixable vulnerabilities found (all are transitive or have no fix version).\n'))
      process.exit(1)
    }

    // --- 7. Check GitHub token ---
    let octokit
    try {
      octokit = await getOctokit()
    } catch (err) {
      console.error(chalk.red('\n' + String(err)))
      process.exit(1)
    }

    // Determine repo URL — explicit flag > resolved from target > inferred from .git/config
    const repoUrl = options.repo ?? project.repoUrl
    if (!repoUrl) {
      console.error(chalk.red('\nError: Could not determine GitHub repository URL.'))
      console.error(chalk.dim('Pass it explicitly: nodeguard . --fix --repo https://github.com/owner/repo'))
      process.exit(1)
    }

    // Preflight permissions check
    const repoMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
    if (repoMatch) {
      try {
        await checkTokenPermissions(octokit, repoMatch[1], repoMatch[2])
      } catch (err) {
        console.error(chalk.red('\n' + String(err)))
        process.exit(1)
      }
    }

    // --- 8. Interactive selection ---
    const selected = await checkbox({
      message: 'Select vulnerabilities to fix (creates one PR per selection):',
      choices: directFixable.map(v => ({
        name: `${v.package}  ${v.installedVersion} → ${v.fixVersion}  [${v.severity}] ${v.id}`,
        value: v,
        checked: v.severity === 'CRITICAL' || v.severity === 'HIGH',
      })),
    })

    if (selected.length === 0) {
      console.log(chalk.yellow('\nNo vulnerabilities selected. Exiting.\n'))
      process.exit(0)
    }

    // --- 9. Group by package, pick highest fix version ---
    const grouped = new Map<string, { vulns: typeof selected; fixVersion: string }>()
    for (const vuln of selected) {
      if (!vuln.fixVersion) continue
      const existing = grouped.get(vuln.package)
      if (!existing) {
        grouped.set(vuln.package, { vulns: [vuln], fixVersion: vuln.fixVersion })
      } else {
        existing.vulns.push(vuln)
        // Keep the highest fix version so one bump covers all CVEs
        if (semver.gt(vuln.fixVersion, existing.fixVersion)) {
          existing.fixVersion = vuln.fixVersion
        }
      }
    }

    console.log(`\nCreating ${grouped.size} PR${grouped.size === 1 ? '' : 's'} (grouped by package)...\n`)

    // For local projects read current package.json; for remote use fetched content
    let manifestContent =
      project.kind === 'local'
        ? readFileSync(join(project.localPath!, 'package.json'), 'utf-8')
        : project.manifestContent

    for (const [pkgName, { vulns, fixVersion }] of grouped) {
      const fixSpinner = ora(`Creating PR for ${pkgName} → ${fixVersion} (${vulns.length} CVE${vulns.length === 1 ? '' : 's'})...`).start()
      try {
        const updatedContent = bumpPackageJson(manifestContent, pkgName, fixVersion)
        const prUrl = await createFixPr(octokit, repoUrl, vulns, fixVersion, updatedContent)
        manifestContent = updatedContent
        fixSpinner.succeed(`PR created: ${chalk.cyan(prUrl)}`)
      } catch (err) {
        fixSpinner.fail(`Failed to create PR for ${pkgName}: ${String(err)}`)
      }
    }
    console.log()
  })

program
  .command('serve')
  .description('Start the NodeGuard web server without an initial scan')
  .option('--port <port>', 'Port to listen on (overrides PORT env var)', '3847')
  .option('--repo <url>', 'Default GitHub repository URL')
  .action(async (opts: { port: string; repo?: string }) => {
    process.env.PORT = opts.port
    await startUiServer([], 'Ready — use Scan Repo to begin', {
      repoUrl: opts.repo,
    })
  })

program.parse()
