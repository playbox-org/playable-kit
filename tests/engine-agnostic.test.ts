import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'

import { packageForNetworks } from '../src/packager/packager'
import { validateArtifact } from '../src/validation/validate-artifact'
import { maxSizeForFormat, getNetwork } from '../src/networks'

// Matches the kit package version (loader lineage inherited from the
// extension, whose boot-safety floor is 0.2.18).
const KIT_FLOOR_SAFE_VERSION = '0.3.0'

const FIXTURES = join(__dirname, 'fixtures')
const BUILD = join(FIXTURES, 'plain-html-build')
const OUT = join(FIXTURES, 'plain-html-out')

afterAll(() => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
})

describe('engine-agnostic packaging (non-Cocos dist)', () => {
  it('packages a plain HTML build for html + zip networks', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD,
      outputDir: OUT,
      networks: ['applovin', 'mintegral', 'facebook'],
      // Kit version must clear the loader boot-safety floor (0.2.18); running
      // from source KIT_VERSION falls back to 0.0.0-dev, so pin it like the
      // built kit would.
      config: { orientation: 'portrait' },
      packagerVersion: KIT_FLOOR_SAFE_VERSION,
    })
    // facebook is dualFormat -> emits html + zip
    expect(result.results).toHaveLength(4)
    for (const r of result.results) {
      expect(r.outputSize).toBeGreaterThan(0)
      expect(existsSync(r.outputPath)).toBe(true)
    }
  })

  it('produces artifacts that pass validateArtifact without Cocos-specific failures', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD,
      outputDir: OUT,
      networks: ['applovin'],
      config: { orientation: 'portrait' },
      packagerVersion: KIT_FLOOR_SAFE_VERSION,
    })
    const artifact = result.results[0]
    const html = readFileSync(artifact.outputPath, 'utf-8')
    const network = getNetwork('applovin')!
    const checks = validateArtifact({
      networkId: 'applovin',
      html,
      buildDir: BUILD,
      files: [
        {
          kind: 'html',
          sizeBytes: artifact.outputSize,
          maxSizeBytes: maxSizeForFormat(network, 'html'),
        },
      ],
    })
    const failed = checks.filter((c) => c.status === 'failed')
    expect(failed).toEqual([])
  })
})
