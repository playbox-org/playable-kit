import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  base64SvgDataUris,
  findTextDataUris,
} from '../../src/validation/data-uri-encoding'
import { validateArtifact } from '../../src/validation/validate-artifact'
import { packageForNetworks } from '../../src/packager/packager'

// Exactly what Vite's svgToDataURL emits into a bundle (oct-c6 Withdraw button).
const SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><g transform='translate(1 2)' fill='#fff'/></svg>`
const VITE_URI =
  'data:image/svg+xml,' +
  SVG.replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3c')
    .replace(/>/g, '%3e')
    .replace(/\s/g, '%20')
const B64_URI = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`
// PIXI v8 HTMLText — a prefix the code completes at runtime.
const PIXI = 'i.src=`data:image/svg+xml;charset=utf8,${encodeURIComponent(e)}`;'
// Minified object keys that look like `data:<x>,`.
const MINIFIED = 'const{data:o,format:a}=n;f({data:t.arguments,id:s});'

describe('base64SvgDataUris', () => {
  it('re-encodes a Vite SVG literal to base64, byte-identical once decoded', () => {
    const html = `<script>const Hp="${VITE_URI}";</script>`
    expect(base64SvgDataUris(html)).toBe(
      `<script>const Hp="${B64_URI}";</script>`,
    )
  })

  it('works in an HTML attribute and keeps charset params', () => {
    const uri = VITE_URI.replace('svg+xml,', 'svg+xml;charset=utf8,')
    expect(
      base64SvgDataUris(`<img src='${uri.replace(/'/g, '%27')}'>`),
    ).toContain('data:image/svg+xml;charset=utf8;base64,')
  })

  it('returns the very same string when nothing qualifies', () => {
    const html = `<script>${PIXI}${MINIFIED}x="${B64_URI}";y="data:image/svg+xml,"+z;</script>`
    expect(base64SvgDataUris(html)).toBe(html)
  })

  it('leaves non-SVG, non-document and malformed payloads alone', () => {
    const html =
      '<script>a="data:text/plain,hello";b="data:image/svg+xml,not-svg";c="data:image/svg+xml,%3csvg%ZZ%3e";</script>'
    expect(base64SvgDataUris(html)).toBe(html)
  })
})

describe('findTextDataUris', () => {
  it('reports shipped literals only: not base64, minified keys or runtime prefixes', () => {
    const concat = 'u="data:image/svg+xml,"+encodeURIComponent(s);'
    expect(
      findTextDataUris(
        `<script>${MINIFIED}${PIXI}${concat}a="${VITE_URI}";b="${B64_URI}"</script>`,
      ),
    ).toEqual([expect.stringMatching(/^data:image\/svg\+xml,%3csvg/)])
  })

  it('reports escaped and unquoted CSS literals the packager cannot rewrite', () => {
    const escaped = `s="url(\\"${VITE_URI}\\")"`
    const css = `<style>a{background:url(${VITE_URI})}</style>`
    expect(findTextDataUris(`<script>${escaped}</script>`)).toHaveLength(1)
    expect(base64SvgDataUris(`<script>${escaped}</script>`)).toBe(
      `<script>${escaped}</script>`,
    )
    expect(findTextDataUris(css)).toHaveLength(1)
  })
})

describe('validateArtifact data-uri-encoding row', () => {
  const row = (networkId: string, html: string) =>
    validateArtifact({ networkId, html, files: [] }).find(
      (c) => c.id === 'data-uri-encoding',
    )

  it('fails AppLovin on a static text data URI, warns elsewhere', () => {
    const html = `<script src="mraid.js"></script><script>a="${VITE_URI}"</script>`
    expect(row('applovin', html)?.status).toBe('failed')
    expect(row('mintegral', html)?.status).toBe('warning')
  })

  it('adds no row for PIXI runtime prefixes or clean HTML', () => {
    expect(row('applovin', `<script>${PIXI}</script>`)).toBeUndefined()
    expect(
      row('applovin', `<script>a="${B64_URI}";${MINIFIED}</script>`),
    ).toBeUndefined()
  })
})

describe('packager', () => {
  const BUILD = join(__dirname, '../fixtures/svg-text-uri-build')
  const OUT = join(__dirname, '../fixtures/svg-text-uri-out')
  afterAll(() => {
    for (const d of [BUILD, OUT])
      if (existsSync(d)) rmSync(d, { recursive: true, force: true })
  })

  it('ships no text data URI for AppLovin from a Vite single-file build', async () => {
    mkdirSync(BUILD, { recursive: true })
    writeFileSync(
      join(BUILD, 'index.html'),
      `<!doctype html><html><head></head><body><script type="module">const Hp="${VITE_URI}";new Image().src=Hp;</script></body></html>`,
    )
    const res = await packageForNetworks({
      buildDir: BUILD,
      outputDir: OUT,
      networks: ['applovin'],
      config: { orientation: 'portrait' },
    })
    const html = readFileSync(res.results[0].outputPath, 'utf-8')
    expect(html).toContain(B64_URI)
    expect(findTextDataUris(html)).toEqual([])
    expect(row('applovin', html)).toBeUndefined()

    function row(networkId: string, h: string) {
      return validateArtifact({ networkId, html: h, files: [] }).find(
        (c) => c.id === 'data-uri-encoding',
      )
    }
  })
})
