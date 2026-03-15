import { Counter, Gauge, Histogram, Registry } from 'prom-client'

export const registry = new Registry()

// Default process metrics (CPU, memory, event loop lag)
import { collectDefaultMetrics } from 'prom-client'
collectDefaultMetrics({ register: registry })

export const scanCounter = new Counter({
  name: 'nodeguard_scans_total',
  help: 'Total number of repository scans performed',
  labelNames: ['status'] as const,  // status: success | error
  registers: [registry],
})

export const vulnsGauge = new Gauge({
  name: 'nodeguard_vulnerabilities_found',
  help: 'Number of vulnerabilities found in the last scan',
  labelNames: ['severity'] as const,  // severity: CRITICAL | HIGH | MODERATE | LOW
  registers: [registry],
})

export const prsCounter = new Counter({
  name: 'nodeguard_prs_created_total',
  help: 'Total number of fix PRs created',
  labelNames: ['status'] as const,  // status: success | error
  registers: [registry],
})

export const scanDuration = new Histogram({
  name: 'nodeguard_scan_duration_seconds',
  help: 'Duration of repository scans in seconds',
  buckets: [0.5, 1, 2, 5, 10, 20, 30],
  registers: [registry],
})

export const fixDuration = new Histogram({
  name: 'nodeguard_fix_duration_seconds',
  help: 'Duration of fix PR creation in seconds',
  buckets: [1, 2, 5, 10, 20, 30, 60],
  registers: [registry],
})
