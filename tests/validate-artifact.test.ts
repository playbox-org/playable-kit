import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

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

/**
 * FINDING 7 regression: the Luna analytics validator was exported from the
 * barrel but dispatched from nowhere, so the extension's Validate window
 * reported no Luna rows at all — spec §6 shipped dead. Mirrors the applovin/
 * Axon dispatch right above it in validate-artifact.ts.
 */
describe('validateArtifact — luna events', () => {
  let tmpDir = ''

  const buildWith = (source: string): string => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'plbx-luna-va-'))
    fs.writeFileSync(join(tmpDir, 'main.js'), source, 'utf8')
    return tmpDir
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir))
      fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  })

  it('reports the static luna checks from the build source', () => {
    const checks = validateArtifact({
      networkId: 'luna',
      files: [],
      buildDir: buildWith("pi.logCustomEvent('level up', 1);"),
    })
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(byId['luna-name_valid']).toMatchObject({ status: 'failed' })
    expect(byId['luna-name_valid'].details).toContain('level up')
  })

  it('omits the runtime-only caps rows (call sites are not fires)', () => {
    const checks = validateArtifact({
      networkId: 'luna',
      files: [],
      buildDir: buildWith(
        Array.from({ length: 40 }, () => "pi.logCustomEvent('tap', 1);").join(
          '\n',
        ),
      ),
    })
    const ids = checks.map((c) => c.id)
    expect(ids).not.toContain('luna-caps_per_name')
    expect(ids).not.toContain('luna-caps_session')
    expect(ids).toContain('luna-name_valid')
  })

  it('adds no luna rows for another network or without a build dir', () => {
    const dir = buildWith("pi.logCustomEvent('level up', 1);")
    expect(
      validateArtifact({ networkId: 'applovin', files: [], buildDir: dir })
        .map((c) => c.id)
        .filter((id) => id.startsWith('luna-')),
    ).toEqual([])
    expect(
      validateArtifact({ networkId: 'luna', files: [] })
        .map((c) => c.id)
        .filter((id) => id.startsWith('luna-')),
    ).toEqual([])
  })
})
