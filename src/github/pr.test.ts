import { describe, it, expect } from 'vitest'
import { bumpPackageJson } from './pr.js'

describe('bumpPackageJson', () => {
  const base = JSON.stringify({
    name: 'my-app',
    dependencies: { lodash: '^4.17.19', express: '4.18.0' },
    devDependencies: { jest: '~29.0.0' },
    optionalDependencies: { fsevents: '2.3.2' },
  })

  it('bumps a dependency preserving ^ prefix', () => {
    const result = JSON.parse(bumpPackageJson(base, 'lodash', '4.17.21'))
    expect(result.dependencies.lodash).toBe('^4.17.21')
  })

  it('bumps a dependency with no prefix', () => {
    const result = JSON.parse(bumpPackageJson(base, 'express', '4.19.0'))
    expect(result.dependencies.express).toBe('4.19.0')
  })

  it('bumps a devDependency preserving ~ prefix', () => {
    const result = JSON.parse(bumpPackageJson(base, 'jest', '29.7.0'))
    expect(result.devDependencies.jest).toBe('~29.7.0')
  })

  it('bumps an optionalDependency', () => {
    const result = JSON.parse(bumpPackageJson(base, 'fsevents', '2.3.3'))
    expect(result.optionalDependencies.fsevents).toBe('2.3.3')
  })

  it('leaves unrelated packages untouched', () => {
    const result = JSON.parse(bumpPackageJson(base, 'lodash', '4.17.21'))
    expect(result.dependencies.express).toBe('4.18.0')
  })

  it('is a no-op for a package not in the manifest', () => {
    const result = JSON.parse(bumpPackageJson(base, 'unknown-pkg', '1.0.0'))
    expect(result.dependencies).not.toHaveProperty('unknown-pkg')
  })

  it('output ends with a newline', () => {
    expect(bumpPackageJson(base, 'lodash', '4.17.21')).toMatch(/\n$/)
  })
})
