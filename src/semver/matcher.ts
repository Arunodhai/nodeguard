import semver from 'semver'
import type { DependencyMap, OsvAffectedRange, OsvVulnerability, VulnMatch } from '../types.js'

/** Convert an OSV affected range events array to a semver range string */
function osvEventsToRange(events: OsvAffectedRange['events']): string {
  const parts: string[] = []
  let current: string | null = null

  for (const event of events) {
    if (event.introduced !== undefined) {
      current = event.introduced === '0' ? '>=0.0.0' : `>=${event.introduced}`
    } else if (event.fixed !== undefined && current !== null) {
      parts.push(`${current} <${event.fixed}`)
      current = null
    } else if (event.last_affected !== undefined && current !== null) {
      parts.push(`${current} <=${event.last_affected}`)
      current = null
    }
  }

  // Open-ended range (no fixed version)
  if (current !== null) {
    parts.push(current)
  }

  return parts.join(' || ')
}

/** Extract a human-readable fix version from a vuln's affected ranges */
function extractFixVersion(vuln: OsvVulnerability, packageName: string): string | null {
  for (const affected of vuln.affected ?? []) {
    if (affected.package.name !== packageName) continue
    for (const range of affected.ranges ?? []) {
      if (range.type !== 'SEMVER') continue
      for (const event of range.events) {
        if (event.fixed) return event.fixed
      }
    }
  }
  return null
}

/** Normalize OSV severity to our enum */
function normalizeSeverity(vuln: OsvVulnerability): VulnMatch['severity'] {
  // 1. Top-level database_specific.severity (GitHub Advisory DB — most reliable)
  const topSev = (vuln as unknown as { database_specific?: { severity?: string } }).database_specific?.severity
  if (topSev) return mapSeverityString(topSev)

  // 2. Per-affected entry database_specific / ecosystem_specific
  for (const affected of vuln.affected ?? []) {
    const sev =
      (affected.database_specific?.severity as string | undefined) ??
      (affected.ecosystem_specific?.severity as string | undefined)
    if (sev) return mapSeverityString(sev)
  }

  // 3. CVSS vector string — extract base score from metric values
  for (const s of vuln.severity ?? []) {
    if (s.type === 'CVSS_V3' || s.type === 'CVSS_V2') {
      const score = cvssVectorToScore(s.score)
      if (score !== null) {
        if (score >= 9.0) return 'CRITICAL'
        if (score >= 7.0) return 'HIGH'
        if (score >= 4.0) return 'MEDIUM'
        return 'LOW'
      }
    }
  }

  return 'UNKNOWN'
}

function mapSeverityString(s: string): VulnMatch['severity'] {
  const upper = s.toUpperCase()
  if (upper === 'CRITICAL') return 'CRITICAL'
  if (upper === 'HIGH') return 'HIGH'
  if (upper === 'MEDIUM' || upper === 'MODERATE') return 'MEDIUM'
  if (upper === 'LOW') return 'LOW'
  return 'UNKNOWN'
}

/** Approximate CVSS base score from a CVSS vector string using impact sub-scores */
function cvssVectorToScore(vector: string): number | null {
  // CVSS:3.x/AV:.../C:H/I:H/A:H style — use C/I/A to approximate
  const match = vector.match(/\/C:([HLN])\/I:([HLN])\/A:([HLN])/)
  if (!match) return null
  const val = (s: string) => s === 'H' ? 3 : s === 'L' ? 1 : 0
  const sum = val(match[1]) + val(match[2]) + val(match[3])
  // sum 9 → ~9.8 CRITICAL, sum 6-8 → HIGH, sum 3-5 → MEDIUM, else LOW
  if (sum >= 8) return 9.8
  if (sum >= 5) return 7.5
  if (sum >= 2) return 5.0
  return 2.0
}

/** Check if an installed version is affected by an OSV vulnerability */
function isAffected(installedVersion: string, vuln: OsvVulnerability, packageName: string): boolean {
  for (const affected of vuln.affected ?? []) {
    if (affected.package.name !== packageName || affected.package.ecosystem !== 'npm') continue

    // Check explicit versions list first
    if (affected.versions?.includes(installedVersion)) return true

    // Check semver ranges
    for (const range of affected.ranges ?? []) {
      if (range.type !== 'SEMVER') continue
      const rangeStr = osvEventsToRange(range.events)
      if (!rangeStr) continue
      try {
        if (semver.satisfies(installedVersion, rangeStr, { includePrerelease: true })) {
          return true
        }
      } catch {
        // malformed range — skip
      }
    }
  }
  return false
}

/** Match all dependencies against OSV query results, producing VulnMatch[] */
export function matchVulnerabilities(
  deps: DependencyMap,
  osvResults: Map<string, OsvVulnerability[]>
): VulnMatch[] {
  const matches: VulnMatch[] = []

  for (const [name, vulns] of osvResults.entries()) {
    const dep = deps.get(name)
    if (!dep) continue

    for (const vuln of vulns) {
      if (!isAffected(dep.version, vuln, name)) continue

      matches.push({
        package: name,
        installedVersion: dep.version,
        fixVersion: extractFixVersion(vuln, name),
        severity: normalizeSeverity(vuln),
        id: vuln.id,
        summary: vuln.summary ?? 'No description available',
        kind: dep.direct ? 'direct' : 'transitive',
        chain: [],
        aliases: vuln.aliases ?? [],
      })
    }
  }

  // Sort by severity
  const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 }
  return matches.sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4))
}
