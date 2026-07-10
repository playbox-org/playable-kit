import { describe, it, expect } from 'vitest'
import * as kit from '../src/index'

// Guards the public barrel. Every symbol below exists in a source module but
// must ALSO be re-exported from src/index.ts. This is the regression net for
// "defined in src, forgotten in the barrel" — which is invisible to the other
// tests because they import deep module paths, not the package entry point.
const REQUIRED_EXPORTS = [
  // core surface
  'KIT_VERSION',
  'packageForNetworks',
  'HtmlBuilder',
  'validateArtifact',
  'generatePreviewUtil',
  'getNetworkChecks',
  'getNetwork',
  'getAllNetworks',
  // added in 0.3.1 — consumed by plbx-cocos-extension (dev preview server,
  // build-report panel, axon docs link)
  'resolveTemplate',
  'buildOutputRows',
  'parseRiskyAudioMarker',
  'parseHostileMp3Marker',
  'AXON_SPEC_URL',
] as const

describe('public API barrel', () => {
  for (const name of REQUIRED_EXPORTS) {
    it(`re-exports ${name}`, () => {
      expect(kit[name as keyof typeof kit]).toBeDefined()
    })
  }
})
