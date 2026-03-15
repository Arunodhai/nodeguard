import { readFileSync } from 'fs'
import { join } from 'path'
import type { DependencyMap } from '../types.js'

/** Parse lockfile from raw string content (used for remote repos) */
export function parseLockfileContent(lockfileContent: string, manifestContent: string): DependencyMap {
  const lockfile: Lockfile = JSON.parse(lockfileContent)

  const directNames = new Set<string>()
  try {
    const manifest = JSON.parse(manifestContent)
    for (const name of Object.keys(manifest.dependencies ?? {})) directNames.add(name)
    for (const name of Object.keys(manifest.devDependencies ?? {})) directNames.add(name)
    for (const name of Object.keys(manifest.optionalDependencies ?? {})) directNames.add(name)
    for (const name of Object.keys(manifest.peerDependencies ?? {})) directNames.add(name)
  } catch {
    // malformed manifest — continue without direct classification
  }

  return buildDependencyMap(lockfile, directNames)
}

interface LockfileV1Dep {
  version: string
  dev?: boolean
  dependencies?: Record<string, LockfileV1Dep>
}

interface LockfilePackage {
  version?: string
  dev?: boolean
  devOptional?: boolean
  peer?: boolean
  resolved?: string
  dependencies?: Record<string, string>
}

interface Lockfile {
  lockfileVersion?: number
  dependencies?: Record<string, LockfileV1Dep>
  packages?: Record<string, LockfilePackage>
}

/** Extract package name from a node_modules key like "node_modules/@scope/pkg" */
function keyToName(key: string): string {
  // Strip leading "node_modules/" and any nested path like "node_modules/foo/node_modules/bar"
  const parts = key.split('node_modules/')
  return parts[parts.length - 1]
}

/** Flatten v1-style nested dependencies recursively */
function flattenV1(
  deps: Record<string, LockfileV1Dep>,
  result: DependencyMap,
  directNames: Set<string>,
  parentPath: string[] = []
): void {
  for (const [name, dep] of Object.entries(deps)) {
    if (!dep.version) continue
    const existing = result.get(name)
    const isDirect = directNames.has(name) && parentPath.length === 0
    if (!existing) {
      result.set(name, {
        version: dep.version,
        dev: dep.dev ?? false,
        direct: isDirect,
      })
    }
    if (dep.dependencies) {
      flattenV1(dep.dependencies, result, directNames, [...parentPath, name])
    }
  }
}

export function parseLockfile(projectPath: string): DependencyMap {
  const lockfilePath = join(projectPath, 'package-lock.json')
  const manifestPath = join(projectPath, 'package.json')

  const lockfileContent = readFileSync(lockfilePath, 'utf-8')
  let manifestContent = '{}'
  try {
    manifestContent = readFileSync(manifestPath, 'utf-8')
  } catch {
    // package.json missing — continue without direct classification
  }

  return parseLockfileContent(lockfileContent, manifestContent)
}

function buildDependencyMap(lockfile: Lockfile, directNames: Set<string>): DependencyMap {
  const result: DependencyMap = new Map()
  const version = lockfile.lockfileVersion ?? 1

  if (version >= 2 && lockfile.packages) {
    // v2/v3: use `packages` map (keys like "node_modules/foo")
    for (const [key, pkg] of Object.entries(lockfile.packages)) {
      if (!key || key === '') continue // root package entry
      if (!pkg.version) continue

      const name = keyToName(key)
      if (!name) continue

      // Skip nested deduped entries — use first occurrence
      if (!result.has(name)) {
        result.set(name, {
          version: pkg.version,
          dev: pkg.dev ?? pkg.devOptional ?? false,
          direct: directNames.has(name),
        })
      }
    }
  } else if (lockfile.dependencies) {
    // v1: use nested `dependencies` object
    flattenV1(lockfile.dependencies, result, directNames)
  }

  return result
}
