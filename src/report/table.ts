import chalk from 'chalk'
import Table from 'cli-table3'
import type { VulnMatch } from '../types.js'

const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  CRITICAL: chalk.bgRed.white.bold,
  HIGH: chalk.red.bold,
  MEDIUM: chalk.yellow.bold,
  LOW: chalk.cyan,
  UNKNOWN: chalk.gray,
}

function colorSeverity(severity: string): string {
  return (SEVERITY_COLOR[severity] ?? chalk.white)(severity)
}

export function printTable(vulns: VulnMatch[]): void {
  if (vulns.length === 0) {
    console.log(chalk.green('\n✓ No vulnerabilities found.\n'))
    return
  }

  const table = new Table({
    head: [
      chalk.bold('Package'),
      chalk.bold('Severity'),
      chalk.bold('ID'),
      chalk.bold('Installed'),
      chalk.bold('Fix Version'),
      chalk.bold('Type'),
    ],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [28, 12, 22, 12, 14, 12],
  })

  for (const v of vulns) {
    table.push([
      chalk.white(v.package),
      colorSeverity(v.severity),
      chalk.dim(v.id),
      chalk.yellow(v.installedVersion),
      v.fixVersion ? chalk.green(v.fixVersion) : chalk.red('none'),
      v.kind === 'direct' ? chalk.white('direct') : chalk.dim('transitive'),
    ])
    if (v.kind === 'transitive' && v.chain.length > 0) {
      table.push([{ colSpan: 6, content: chalk.dim(`  via: ${v.chain.join(' → ')}`) }])
    }
  }

  const critCount = vulns.filter(v => v.severity === 'CRITICAL').length
  const highCount = vulns.filter(v => v.severity === 'HIGH').length
  const medCount = vulns.filter(v => v.severity === 'MEDIUM').length
  const lowCount = vulns.filter(v => v.severity === 'LOW').length

  console.log()
  console.log(table.toString())
  console.log()
  console.log(
    chalk.bold('Summary:'),
    `${vulns.length} vulnerabilit${vulns.length === 1 ? 'y' : 'ies'} found —`,
    critCount > 0 ? chalk.bgRed.white.bold(` ${critCount} CRITICAL `) : '',
    highCount > 0 ? chalk.red.bold(`${highCount} HIGH`) : '',
    medCount > 0 ? chalk.yellow(`${medCount} MEDIUM`) : '',
    lowCount > 0 ? chalk.cyan(`${lowCount} LOW`) : ''
  )
  console.log()
}
