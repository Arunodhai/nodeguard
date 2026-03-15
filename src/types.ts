/** Flat map of package name → installed version extracted from package-lock.json */
export type DependencyMap = Map<string, { version: string; dev: boolean; direct: boolean }>

/** A single vulnerability match from OSV.dev */
export interface VulnMatch {
  package: string
  installedVersion: string
  fixVersion: string | null
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  id: string          // CVE-xxx or GHSA-xxx
  summary: string
  kind: 'direct' | 'transitive'
  chain: string[]     // dependency chain for transitive vulns
  aliases: string[]   // all CVE/GHSA aliases
}

/** OSV.dev API types */
export interface OsvPackage {
  name: string
  ecosystem: 'npm'
  version: string
}

export interface OsvQuery {
  queries: Array<{ package: OsvPackage }>
}

export interface OsvAffectedRange {
  type: 'SEMVER' | 'ECOSYSTEM' | 'GIT'
  events: Array<{ introduced?: string; fixed?: string; last_affected?: string }>
}

export interface OsvVulnerability {
  id: string
  aliases?: string[]
  summary?: string
  severity?: Array<{ type: string; score: string }>
  affected?: Array<{
    package: { name: string; ecosystem: string }
    ranges?: OsvAffectedRange[]
    versions?: string[]
    ecosystem_specific?: { severity?: string }
    database_specific?: { severity?: string }
  }>
}

export interface OsvQueryResult {
  vulns?: OsvVulnerability[]
}

export interface OsvBatchResponse {
  results: OsvQueryResult[]
}
