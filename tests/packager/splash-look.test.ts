import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { packageForNetworks } from '../../src/packager/packager'
import { buildSplash, splashInk } from '../../src/packager/splash'

const LOGO = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAA='
const OUT = join(__dirname, '../fixtures/splash-look-out')

afterAll(() => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
})

describe('splash look', () => {
  it('keeps the default Playbox splash unchanged', () => {
    const s = buildSplash()
    expect(s.styleCss).toContain('#06020d')
    expect(s.styleCss).not.toContain('color:')
    expect(s.bodyHtml).toContain('class="wm"')
    expect(s.bodyHtml).toContain('fill="white"')
    expect(s.bodyHtml).toContain('<div class=b>')
    expect(s.bodyHtml).not.toContain('made with')
  })

  it('logo + Playbox: client logo, bar, brand backdrop and the made-with line', () => {
    const s = buildSplash({ customLogo: { dataUrl: LOGO }, style: 'logo_playbox' })
    expect(s.bodyHtml).toContain(`<img id="lg" src="${LOGO}"`)
    expect(s.bodyHtml).toContain('made with')
    expect(s.bodyHtml).toContain('class="fm"')
    expect(s.bodyHtml).toContain('<div class=b>')
    expect(s.styleCss).toContain('#06020d')
  })

  it('an explicit logo style gets the brand backdrop and bar, unlike the legacy logo call', () => {
    const s = buildSplash({ customLogo: { dataUrl: LOGO }, style: 'logo' })
    expect(s.styleCss).toContain('#06020d')
    expect(s.bodyHtml).toContain('<div class=b>')
    expect(s.bodyHtml).not.toContain('made with')
    const legacy = buildSplash({ customLogo: { dataUrl: LOGO } })
    expect(legacy.styleCss).toContain('background:#000;')
    expect(legacy.bodyHtml).not.toContain('<div class=b>')
  })

  it('falls back to the Playbox layout when the logo is missing or unsafe', () => {
    for (const dataUrl of ['', 'javascript:alert(1)', 'data:image/png;base64,AA" onerror="x']) {
      const s = buildSplash({ customLogo: { dataUrl }, style: 'logo' })
      expect(s.bodyHtml).not.toContain('<img')
      expect(s.bodyHtml).toContain('class="wm"')
    }
  })

  it('switches text and track to dark ink on a light backdrop', () => {
    const s = buildSplash({ background: { kind: 'solid', color: '#ffffff' } })
    expect(s.styleCss).toContain('background:#ffffff;')
    expect(s.styleCss).toContain('color:#14121a;')
    expect(s.bodyHtml).toContain('fill="currentColor"')
    expect(s.styleCss).toContain('#14121a1a')
    expect(splashInk({ kind: 'solid', color: '#06020d' })).toBe('#fff')
    expect(splashInk({ kind: 'gradient', from: '#ffffff', to: '#f0f0f0' })).toBe('#14121a')
  })

  it('renders a gradient backdrop, a solid bar and no bar', () => {
    const s = buildSplash({
      background: { kind: 'gradient', from: '#112233', to: '#445566' },
      bar: { kind: 'solid', color: '#ff00aa' },
    })
    expect(s.styleCss).toContain('linear-gradient(180deg,#112233,#445566)')
    expect(s.styleCss).toContain('background:#ff00aa;')
    expect(buildSplash({ bar: { kind: 'off' } }).bodyHtml).not.toContain('<div class=b>')
  })

  it('drops colors that are not plain hex, so nothing escapes the style block', () => {
    const s = buildSplash({
      background: { kind: 'solid', color: 'red;}</style><script>alert(1)</script>' },
      bar: { kind: 'solid', color: 'url(x)' },
    })
    expect(s.styleCss).not.toContain('</style>')
    expect(s.styleCss).not.toContain('url(x)')
    expect(s.styleCss).toContain('background:#000;')
  })

  it('rounds and clamps the logo radius', () => {
    const css = (logoRadius: number) =>
      buildSplash({ customLogo: { dataUrl: LOGO }, style: 'logo', logoRadius }).styleCss
    expect(css(22)).toContain('border-radius:22%;')
    expect(css(90)).toContain('border-radius:50%;')
    expect(css(0)).toContain('object-fit:contain;animation')
  })

  it('ships the configured look through the packager', async () => {
    await packageForNetworks({
      buildDir: join(__dirname, '../fixtures/single-file-build'),
      outputDir: OUT,
      networks: ['applovin'],
      config: {
        orientation: 'portrait',
        showSplash: true,
        splash: {
          style: 'logo_playbox',
          logoDataUrl: LOGO,
          logoRadius: 22,
          background: { kind: 'solid', color: '#fafafa' },
        },
      },
      packagerVersion: '0.5.0',
    })
    const html = readdirSync(OUT, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.html'))
      .map((f) => readFileSync(join(OUT, f), 'utf-8'))
      .join('\n')
    expect(html).toContain(LOGO)
    expect(html).toContain('made with')
    expect(html).toContain('border-radius:22%;')
    expect(html).toContain('color:#14121a;')
  })
})
