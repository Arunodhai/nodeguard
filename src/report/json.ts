import type { VulnMatch } from '../types.js'

export function printJson(vulns: VulnMatch[]): void {
  const output = {
    vulnerabilities: vulns.map(v => ({
      package: v.package,
      installedVersion: v.installedVersion,
      fixVersion: v.fixVersion,
      severity: v.severity,
      id: v.id,
      aliases: v.aliases,
      summary: v.summary,
      kind: v.kind,
      chain: v.chain,
    })),
    summary: {
      total: vulns.length,
      critical: vulns.filter(v => v.severity === 'CRITICAL').length,
      high: vulns.filter(v => v.severity === 'HIGH').length,
      medium: vulns.filter(v => v.severity === 'MEDIUM').length,
      low: vulns.filter(v => v.severity === 'LOW').length,
    },
  }
  // Write only to stdout — no spinner/chalk contamination
  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
}
