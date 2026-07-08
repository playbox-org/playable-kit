import { describe, expect, it } from 'vitest'

import {
  buildPreviewRendition,
  PREVIEW_MODES,
} from '../src/preview/preview-rendition'

const HTML = '<html><head><title>g</title></head><body></body></html>'

describe('buildPreviewRendition', () => {
  it('injects the mock bridge right after <head> for every mode', () => {
    for (const mode of PREVIEW_MODES) {
      const out = buildPreviewRendition({
        html: HTML,
        networkId: 'applovin',
        mode,
      })
      expect(out.indexOf('<script>')).toBe(
        out.indexOf('<head>') + '<head>'.length,
      )
      expect(out).toContain('plbx:preview')
      expect(out).toContain('_plbxExpectedCta')
    }
  })

  it('bakes the adversarial mode into the generated source', () => {
    const happy = buildPreviewRendition({
      html: HTML,
      networkId: 'applovin',
      mode: 'happy',
    })
    const dark = buildPreviewRendition({
      html: HTML,
      networkId: 'applovin',
      mode: 'neverViewable',
    })
    expect(happy).not.toBe(dark)
  })

  it('throws on unknown network', () => {
    expect(() =>
      buildPreviewRendition({ html: HTML, networkId: 'nope', mode: 'happy' }),
    ).toThrow()
  })
})
