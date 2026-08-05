import { describe, it, expect } from 'vitest'
import {
  buildSplash,
  splashByteCost,
  FIRST_FRAME_HOOK_JS,
} from '../../src/packager/splash'

describe('buildSplash', () => {
  it('returns PLBX pinwheel + SVG wordmark + progress bar markup', () => {
    const s = buildSplash({ withProgressBar: true })
    expect(s.bodyHtml).toContain('id="s"')
    expect(s.bodyHtml).toContain('<svg id="lg"')
    expect(s.bodyHtml).toContain('class="wm"') // brand wordmark SVG
    expect(s.bodyHtml).toContain('class=b') // indeterminate bar
    expect(s.styleCss).toContain('#s{')
    expect(s.styleCss).toContain('@keyframes')
    // E2: petals pulse staggered toward center, outer silhouette static
    expect(s.styleCss).toContain('.pt path')
    expect(s.styleCss).toContain('animation-delay')
  })

  it('omits progress bar when withProgressBar=false', () => {
    const s = buildSplash({ withProgressBar: false })
    expect(s.bodyHtml).not.toContain('class=b')
  })

  it('compact mode (Moloco launcher) uses CSS-text wordmark, fits 3KB budget', () => {
    const s = buildSplash({ withProgressBar: false, svgWordmark: false })
    expect(s.bodyHtml).not.toContain('class="wm"')
    expect(s.bodyHtml).toContain('Playbox')
    const bytes = Buffer.byteLength(s.styleCss + s.bodyHtml + s.hideJs, 'utf8')
    expect(bytes).toBeLessThan(2700) // leave headroom for launcher meta/macros
  })

  it('hideJs defines idempotent window.__plbx_splash_hide', () => {
    const s = buildSplash({})
    expect(s.hideJs).toContain('window.__plbx_splash_hide=function()')
    expect(s.hideJs).toContain('getElementById("s")')
    expect(s.hideJs).toContain('if(!s)return') // null-safe / idempotent
  })
})

describe('buildSplash custom logo', () => {
  const dataUrl =
    'data:image/png;base64,' + Buffer.from('x'.repeat(900)).toString('base64')

  it('renders <img> with the data URL instead of the PLBX pinwheel + wordmark', () => {
    const s = buildSplash({ customLogo: { dataUrl } })
    expect(s.bodyHtml).toContain('<img id="lg"')
    expect(s.bodyHtml).toContain(dataUrl)
    expect(s.bodyHtml).not.toContain('<svg id="lg"') // not the PLBX pinwheel
    expect(s.bodyHtml).not.toContain('class="wm"') // no PLBX wordmark
    expect(s.styleCss).toContain('object-fit:contain') // fit any aspect
    expect(s.styleCss).toContain('@keyframes pq') // whole-image pulse
  })

  it('uses a plain black backdrop with no gradients or progress bar', () => {
    const s = buildSplash({ customLogo: { dataUrl }, withProgressBar: true })
    expect(s.bodyHtml).not.toContain('class=b') // no progress bar
    expect(s.styleCss).toContain('background:#000') // plain black
    expect(s.styleCss).not.toContain('radial-gradient') // gradients dropped
  })
})

describe('buildSplash custom logo size (logoScale)', () => {
  const dataUrl = 'data:image/png;base64,AAAA'
  const css = (logoScale?: number) =>
    buildSplash({ customLogo: { dataUrl }, logoScale }).styleCss

  it('defaults to 26vmin — the vmin equivalent of the old fixed 96px', () => {
    const s = css()
    expect(s).toContain('max-width:26vmin')
    expect(s).toContain('max-height:26vmin')
    // The fixed px cap is what made wide wordmark logos render tiny.
    expect(s).not.toContain('96px')
  })

  it('sizes both caps from the requested scale', () => {
    expect(css(55)).toContain('max-width:55vmin')
    expect(css(55)).toContain('max-height:55vmin')
  })

  it('keeps object-fit:contain so the aspect ratio survives the resize', () => {
    expect(css(80)).toContain('object-fit:contain')
  })

  it('clamps below 5 up and above 100 down', () => {
    expect(css(0)).toContain('max-width:5vmin')
    expect(css(-3)).toContain('max-width:5vmin')
    expect(css(1e9)).toContain('max-width:100vmin')
  })

  it('falls back to the default on a non-finite scale, never emitting NaN', () => {
    // A NaN would kill the whole declaration and restore the browser default
    // (intrinsic image size → potentially full-bleed logo).
    for (const bad of [NaN, Infinity, -Infinity]) {
      const s = css(bad)
      expect(s).not.toContain('NaN')
      expect(s).not.toContain('Infinity')
      expect(s).toContain('vmin')
    }
  })

  it('rounds a fractional scale rather than emitting a long decimal', () => {
    expect(css(33.333333)).toContain('max-width:33vmin')
  })

  it('leaves the PLBX splash on its fixed 84px mark', () => {
    // logoScale is a custom-logo control only; the branded splash is untouched.
    const s = buildSplash({ logoScale: 90 }).styleCss
    expect(s).toContain('#lg{width:84px;height:84px}')
    expect(s).not.toContain('vmin')
  })
})

describe('splashByteCost with custom logo', () => {
  const url = (rawBytes: number) =>
    'data:image/png;base64,' +
    Buffer.from('x'.repeat(rawBytes)).toString('base64')

  it('scales with the base64 image size, with the +33% inflation counted', () => {
    const small = splashByteCost({ customLogo: { dataUrl: url(300) } })
    const big = splashByteCost({ customLogo: { dataUrl: url(30000) } })
    const rawDelta = 30000 - 300
    // base64 grows the byte cost by ceil(n/3)*4 per image → delta is exact.
    const base64Delta = Math.ceil(30000 / 3) * 4 - Math.ceil(300 / 3) * 4
    expect(big - small).toBe(base64Delta) // cost tracks the image (not ignored)
    expect(base64Delta).toBeGreaterThan(rawDelta) // base64 +33% over raw
  })
})

describe('splashByteCost', () => {
  it('returns positive stable byte count', () => {
    const a = splashByteCost()
    const b = splashByteCost()
    expect(a).toBeGreaterThan(0)
    expect(a).toBe(b)
  })
})

describe('FIRST_FRAME_HOOK_JS', () => {
  it('hides on first Cocos frame with rAF + absolute timeout fallbacks', () => {
    expect(FIRST_FRAME_HOOK_JS).toContain('EVENT_END_FRAME')
    expect(FIRST_FRAME_HOOK_JS).toContain('requestAnimationFrame')
    expect(FIRST_FRAME_HOOK_JS).toMatch(/setTimeout\([^)]*8000\)/)
    expect(FIRST_FRAME_HOOK_JS).toContain('__plbx_splash_hide')
  })
})
