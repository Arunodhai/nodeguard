import type { DependencyMap, OsvBatchResponse, OsvVulnerability } from '../types.js'

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch'
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns'
const CHUNK_SIZE = 500
const FETCH_CONCURRENCY = 10  // parallel vuln detail fetches

/** Query OSV.dev for all packages, then fetch full details for matched vuln IDs */
export async function queryOsv(deps: DependencyMap): Promise<Map<string, OsvVulnerability[]>> {
  const entries = Array.from(deps.entries())

  // Step 1: Batch query — get vuln IDs per package position
  const idsByIndex = new Map<number, string[]>()  // entry index → vuln IDs

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE)
    const body = {
      queries: chunk.map(([name, { version }]) => ({
        package: { name, ecosystem: 'npm' },
        version,
      })),
    }

    const res = await fetch(OSV_BATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`OSV.dev API error: ${res.status} ${res.statusText}`)
    }

    const data: OsvBatchResponse = await res.json()

    for (let j = 0; j < chunk.length; j++) {
      const vulns = data.results[j]?.vulns ?? []
      if (vulns.length > 0) {
        idsByIndex.set(i + j, vulns.map(v => v.id))
      }
    }
  }

  if (idsByIndex.size === 0) return new Map()

  // Step 2: Collect unique vuln IDs and fetch full details
  const allIds = new Set<string>()
  for (const ids of idsByIndex.values()) {
    for (const id of ids) allIds.add(id)
  }

  const vulnDetails = new Map<string, OsvVulnerability>()
  const idArray = Array.from(allIds)

  // Fetch in parallel batches
  for (let i = 0; i < idArray.length; i += FETCH_CONCURRENCY) {
    const batch = idArray.slice(i, i + FETCH_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async id => {
        const res = await fetch(`${OSV_VULN_URL}/${id}`)
        if (!res.ok) throw new Error(`Failed to fetch vuln ${id}: ${res.status}`)
        const vuln: OsvVulnerability = await res.json()
        return vuln
      })
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        vulnDetails.set(result.value.id, result.value)
      }
    }
  }

  // Step 3: Build per-package vuln list using full details
  const packageVulns = new Map<string, OsvVulnerability[]>()
  for (const [idx, ids] of idsByIndex.entries()) {
    const [name] = entries[idx]
    const vulns = ids.map(id => vulnDetails.get(id)).filter((v): v is OsvVulnerability => v !== undefined)
    if (vulns.length > 0) {
      packageVulns.set(name, vulns)
    }
  }

  return packageVulns
}
