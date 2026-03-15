import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'

/** Resolves a local path or GitHub URL into raw file content for lockfile parsing */

export interface ResolvedProject {
  kind: 'local' | 'remote'
  repoUrl: string | null       // GitHub repo URL (for PR creation)
  lockfileContent: string
  manifestContent: string
  /** For local projects: the absolute path on disk */
  localPath?: string
}

/** Parse a GitHub URL into owner/repo/ref */
function parseGitHubUrl(url: string): { owner: string; repo: string; ref: string } | null {
  // Handles:
  //   https://github.com/owner/repo
  //   https://github.com/owner/repo/tree/branch
  //   git@github.com:owner/repo.git
  const match = url.match(
    /github\.com[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+))?(?:\/.*)?$/
  )
  if (!match) return null
  return { owner: match[1], repo: match[2], ref: match[3] ?? 'HEAD' }
}

function makeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'nodeguard/0.1' }
  const token = process.env.GITHUB_TOKEN
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

/** Resolve the default branch name for a repo via GitHub API */
async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`
  const res = await fetch(apiUrl, { headers: makeHeaders() })
  if (res.ok) {
    const data = await res.json() as { default_branch?: string }
    if (data.default_branch) return data.default_branch
  }
  // Fallback: try common branch names
  return 'main'
}

async function fetchRawFile(
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  const headers = makeHeaders()

  // Try the given ref first, then common fallbacks
  const refsToTry = ref === 'HEAD' ? [ref, 'main', 'master'] : [ref]

  for (const tryRef of refsToTry) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${tryRef}/${path}`
    const res = await fetch(rawUrl, { headers })
    if (res.ok) return res.text()
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Access denied fetching ${path} from ${owner}/${repo}.\n` +
        `  Private repo? Set GITHUB_TOKEN to a token with repo read access.`
      )
    }
  }

  throw new Error(
    `Could not fetch ${path} from ${owner}/${repo}.\n` +
    `  Make sure the repo has a ${path} committed at its root.\n` +
    `  (Checked refs: ${refsToTry.join(', ')})`
  )
}

/**
 * Use the GitHub tree API to find the shallowest directory containing both
 * package.json and package-lock.json. Returns '' for root, 'subdir' otherwise.
 */
async function findNodeProjectRoot(owner: string, repo: string, ref: string): Promise<string> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`
  const res = await fetch(apiUrl, { headers: makeHeaders() })
  if (!res.ok) return ''

  const data = await res.json() as { tree?: Array<{ path: string; type: string }> }
  if (!data.tree) return ''

  const blobs = new Set(
    data.tree
      .filter(f => f.type === 'blob' && !f.path.includes('node_modules/'))
      .map(f => f.path)
  )

  // Collect all dirs that have a package-lock.json (the critical file)
  const lockfileDirs: string[] = []
  for (const p of blobs) {
    if (p === 'package-lock.json') lockfileDirs.push('')
    else if (p.endsWith('/package-lock.json')) lockfileDirs.push(p.slice(0, -'/package-lock.json'.length))
  }

  if (lockfileDirs.length === 0) return ''

  // Sort shallowest first; prefer root
  lockfileDirs.sort((a, b) => a.split('/').length - b.split('/').length)
  return lockfileDirs[0]
}

export async function resolveProject(target: string): Promise<ResolvedProject> {
  // Remote GitHub URL
  if (/^https?:\/\/github\.com/i.test(target) || /^git@github\.com/i.test(target)) {
    const parsed = parseGitHubUrl(target)
    if (!parsed) {
      throw new Error(`Could not parse GitHub URL: ${target}`)
    }
    const { owner, repo } = parsed
    const explicitRef = parsed.ref
    const repoUrl = `https://github.com/${owner}/${repo}`

    // Resolve actual branch name if not explicitly provided in URL
    const ref = explicitRef === 'HEAD'
      ? await resolveDefaultBranch(owner, repo)
      : explicitRef

    // Try root first; if not found, search the tree for the Node project root
    let subdir = ''
    try {
      await fetchRawFile(owner, repo, 'package-lock.json', ref)
    } catch {
      subdir = await findNodeProjectRoot(owner, repo, ref)
    }

    const prefix = subdir ? `${subdir}/` : ''

    const [lockfileContent, manifestContent] = await Promise.all([
      fetchRawFile(owner, repo, `${prefix}package-lock.json`, ref),
      fetchRawFile(owner, repo, `${prefix}package.json`, ref),
    ])

    return { kind: 'remote', repoUrl, lockfileContent, manifestContent }
  }

  // Local path
  const absPath = resolve(target)
  const lockfilePath = join(absPath, 'package-lock.json')
  const manifestPath = join(absPath, 'package.json')

  if (!existsSync(lockfilePath)) {
    throw new Error(`package-lock.json not found at ${lockfilePath}`)
  }

  return {
    kind: 'local',
    repoUrl: inferRepoUrl(absPath),
    lockfileContent: readFileSync(lockfilePath, 'utf-8'),
    manifestContent: existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : '{}',
    localPath: absPath,
  }
}

function inferRepoUrl(projectPath: string): string | null {
  try {
    const gitConfig = readFileSync(join(projectPath, '.git', 'config'), 'utf-8')
    const match = gitConfig.match(/url\s*=\s*(https?:\/\/github\.com\/[^\s]+|git@github\.com:[^\s]+)/)
    if (match) return match[1].replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '')
  } catch {
    // no git config
  }
  return null
}
