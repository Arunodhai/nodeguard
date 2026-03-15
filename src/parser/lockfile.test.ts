import { describe, it, expect } from 'vitest'
import { parseLockfileContent } from './lockfile.js'

const manifest = JSON.stringify({ dependencies: { lodash: '^4.17.19' } })

const lockfileV2 = JSON.stringify({
  lockfileVersion: 2,
  packages: {
    '': { name: 'my-app', version: '1.0.0' },
    'node_modules/lodash': { version: '4.17.19', resolved: 'https://r.io/lodash', integrity: 'sha512-x' },
    'node_modules/express': { version: '4.18.0', resolved: 'https://r.io/express', integrity: 'sha512-y', dev: false },
    'node_modules/jest': { version: '29.0.0', resolved: 'https://r.io/jest', integrity: 'sha512-z', dev: true },
  },
})

const lockfileV3 = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'my-app', version: '1.0.0' },
    'node_modules/semver': { version: '7.5.4', resolved: 'https://r.io/semver', integrity: 'sha512-a' },
  },
})

describe('parseLockfileContent', () => {
  it('parses lockfile v2 and returns all packages', () => {
    const deps = parseLockfileContent(lockfileV2, manifest)
    expect(deps.has('lodash')).toBe(true)
    expect(deps.has('express')).toBe(true)
    expect(deps.has('jest')).toBe(true)
  })

  it('sets correct version', () => {
    const deps = parseLockfileContent(lockfileV2, manifest)
    expect(deps.get('lodash')?.version).toBe('4.17.19')
  })

  it('marks direct deps (in manifest dependencies) as direct:true', () => {
    const deps = parseLockfileContent(lockfileV2, manifest)
    expect(deps.get('lodash')?.direct).toBe(true)
  })

  it('marks packages not in manifest as direct:false', () => {
    const deps = parseLockfileContent(lockfileV2, manifest)
    expect(deps.get('express')?.direct).toBe(false)
  })

  it('parses lockfile v3', () => {
    const deps = parseLockfileContent(lockfileV3, '{}')
    expect(deps.has('semver')).toBe(true)
    expect(deps.get('semver')?.version).toBe('7.5.4')
  })

  it('excludes the root package entry', () => {
    const deps = parseLockfileContent(lockfileV2, manifest)
    expect(deps.has('')).toBe(false)
    expect(deps.has('my-app')).toBe(false)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseLockfileContent('not json', manifest)).toThrow()
  })
})
