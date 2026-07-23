import { describe, expect, it } from 'vitest'

import {
  findForbiddenLiterals,
  summarizeChecks,
  validateArtifact,
} from '../src/validation/validate-artifact'

// Mirrors the naive substring scan Moloco/Facebook moderation runs: any
// 'mraid.js' occurrence rejects the creative — a JS comment or a conditional
// like indexOf('mraid.js') counts just as much as a script tag.
describe('findForbiddenLiterals', () => {
  it("catches 'mraid.js' in a comment or conditional for non-MRAID networks", () => {
    const html =
      '<html><script>// the ad SDK mraid.js case\n' +
      "if (u.indexOf('mraid.js') !== -1) {}</script></html>"
    expect(findForbiddenLiterals('moloco', html)).toEqual(['mraid.js'])
    expect(findForbiddenLiterals('facebook', html)).toEqual(['mraid.js'])
  })

  it('returns [] for clean html, MRAID networks, and unknown networks', () => {
    expect(findForbiddenLiterals('moloco', '<html></html>')).toEqual([])
    const withTag = '<html><script src="mraid.js"></script></html>'
    expect(findForbiddenLiterals('applovin', withTag)).toEqual([])
    expect(findForbiddenLiterals('nope', withTag)).toEqual([])
  })
})

describe('validateArtifact', () => {
  it('flags unknown networks', () => {
    const checks = validateArtifact({ networkId: 'nope', files: [] })
    expect(checks).toHaveLength(1)
    expect(checks[0].status).toBe('failed')
  })

  it('runs size, string and loader checks over a fake html artifact', () => {
    const html = '<html><head></head><body><script>plbx</script></body></html>'
    const checks = validateArtifact({
      networkId: 'mintegral',
      html,
      files: [
        { kind: 'zip', sizeBytes: 1024, maxSizeBytes: 5 * 1024 * 1024 },
        {
          kind: 'html',
          sizeBytes: 10 * 1024 * 1024,
          maxSizeBytes: 5 * 1024 * 1024,
        },
      ],
    })
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(byId['size-zip'].status).toBe('passed')
    expect(byId['size-html'].status).toBe('failed')
    expect(byId['forbidden-strings']).toBeDefined()
    expect(byId['required-strings']).toBeDefined()
    expect(summarizeChecks(checks)).toBe('failed')
  })

  it('summarizes warnings below failures', () => {
    expect(
      summarizeChecks([
        { id: 'a', label: 'a', status: 'passed', details: null },
        { id: 'b', label: 'b', status: 'warning', details: null },
      ]),
    ).toBe('warning')
    expect(
      summarizeChecks([
        { id: 'a', label: 'a', status: 'passed', details: null },
      ]),
    ).toBe('passed')
  })
})
