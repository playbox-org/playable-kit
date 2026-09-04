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
  // added in 0.3.5 — consumed by plbx-cocos-extension (preview validator's
  // static no_forbidden_literals check)
  'findForbiddenLiterals',
  // added in 0.3.17 — the ZIP root-file contract (Tencent config.json, Luna
  // manifests) shared by validateArtifact, the extension preview and the
  // platform validator
  'zipRootFilesVerdict',
  // added in 0.3.7 — consumed by plbx-cocos-extension (Package tab renders the
  // real splash markup+CSS in a preview iframe and shows its byte cost, so the
  // panel never carries a second copy of the splash)
  'buildSplash',
  'splashByteCost',
  'clampLogoScale',
  'DEFAULT_LOGO_SCALE',
  'MIN_LOGO_SCALE',
  'MAX_LOGO_SCALE',
  'FIRST_FRAME_HOOK_JS',
  // added in 0.3.8 — Luna / Unity Playworks target: the analytics validator is
  // shared by the package-time gate and the extension's preview panel (which
  // renders the caps + standard-event list it gets over /api/networks)
  'LUNA_STANDARD_EVENTS',
  'LUNA_EVENT_CAPS',
  'LUNA_SPEC_URL',
  'extractLunaUsage',
  'validateLunaEvents',
  // added in 0.3.9 — the extension's preview checklist repeats the same iOS
  // audio-risk call to action in its hints, and must not fork the wording
  'IOS_AUDIO_RISK_CTA',
  // added in 0.3.11 — the extension's preview validator needs the same
  // per-network forbidden list and remediation text the packager aborts on
  'forbiddenStringsFor',
  'NETWORK_FORBIDDEN_STRINGS',
  'FORBIDDEN_STRING_HINTS',
  // added in 0.3.15 — free-stack single-file path
  'detectInputKind',
  'applySingleFileRewrite',
  'SINGLE_FILE_SPLASH_HOOK_JS',
  'htmlToPayloadJs',
] as const

describe('public API barrel', () => {
  for (const name of REQUIRED_EXPORTS) {
    it(`re-exports ${name}`, () => {
      expect(kit[name as keyof typeof kit]).toBeDefined()
    })
  }
})

describe('sdk subpath', () => {
  it('exports plbx as default and named', async () => {
    const mod = await import('../src/sdk/index')
    expect(mod.default).toBe(mod.plbx)
    expect(typeof mod.plbx.init).toBe('function')
  })
})
