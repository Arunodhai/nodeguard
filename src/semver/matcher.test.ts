import { describe, it, expect } from 'vitest'
import { matchVulnerabilities } from './matcher.js'
import type { DependencyMap, OsvVulnerability } from '../types.js'

function makeDeps(entries: Record<string, { version: string; direct: boolean }>): DependencyMap {
  return new Map(Object.entries(entries).map(([k, v]) => [k, v]))
}

function makeVuln(
  id: string,
  pkg: string,
  introduced: string,
  fixed: string | null,
  severity = 'HIGH'
): OsvVulnerability {
  return {
    id,
    summary: `Test vuln ${id}`,
    aliases: [],
    severity: [],
    affected: [
      {
        package: { name: pkg, ecosystem: 'npm' },
        ranges: fixed
          ? [{ type: 'SEMVER', events: [{ introduced }, { fixed }] }]
          : [{ type: 'SEMVER', events: [{ introduced }] }],
        versions: [],
        database_specific: { severity },
      },
    ],
  }
}

describe('matchVulnerabilities', () => {
  it('matches a vulnerable direct dependency', () => {
    const deps = makeDeps({ lodash: { version: '4.17.19', direct: true } })
    const osv = new Map([['lodash', [makeVuln('CVE-2021-1', 'lodash', '0.0.0', '4.17.21')]]])
    const result = matchVulnerabilities(deps, osv)
    expect(result).toHaveLength(1)
    expect(result[0].package).toBe('lodash')
    expect(result[0].fixVersion).toBe('4.17.21')
    expect(result[0].kind).toBe('direct')
  })

  it('marks a transitive dependency correctly', () => {
    const deps = makeDeps({ lodash: { version: '4.17.19', direct: false } })
    const osv = new Map([['lodash', [makeVuln('CVE-2021-1', 'lodash', '0.0.0', '4.17.21')]]])
    const result = matchVulnerabilities(deps, osv)
    expect(result[0].kind).toBe('transitive')
  })

  it('does not match a safe (patched) version', () => {
    const deps = makeDeps({ lodash: { version: '4.17.21', direct: true } })
    const osv = new Map([['lodash', [makeVuln('CVE-2021-1', 'lodash', '0.0.0', '4.17.21')]]])
    expect(matchVulnerabilities(deps, osv)).toHaveLength(0)
  })

  it('returns null fixVersion for open-ended range', () => {
    const deps = makeDeps({ pkg: { version: '1.0.0', direct: true } })
    const osv = new Map([['pkg', [makeVuln('CVE-X', 'pkg', '0.0.0', null)]]])
    const result = matchVulnerabilities(deps, osv)
    expect(result[0].fixVersion).toBeNull()
  })

  it('sorts results by severity: CRITICAL before HIGH before MEDIUM', () => {
    const deps = makeDeps({
      a: { version: '1.0.0', direct: true },
      b: { version: '1.0.0', direct: true },
      c: { version: '1.0.0', direct: true },
    })
    const osv = new Map([
      ['a', [makeVuln('CVE-A', 'a', '0.0.0', null, 'MEDIUM')]],
      ['b', [makeVuln('CVE-B', 'b', '0.0.0', null, 'CRITICAL')]],
      ['c', [makeVuln('CVE-C', 'c', '0.0.0', null, 'HIGH')]],
    ])
    const result = matchVulnerabilities(deps, osv)
    expect(result.map(r => r.severity)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM'])
  })

  it('returns empty array when no vulnerabilities match', () => {
    const deps = makeDeps({ safe: { version: '2.0.0', direct: true } })
    const osv = new Map([['safe', [makeVuln('CVE-Z', 'safe', '1.0.0', '1.9.9')]]])
    expect(matchVulnerabilities(deps, osv)).toHaveLength(0)
  })
})
