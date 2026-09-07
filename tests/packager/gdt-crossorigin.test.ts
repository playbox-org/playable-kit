import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import JSZip from 'jszip'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { packageForNetworks } from '../../src/packager/packager'
import { findForbiddenLiterals } from '../../src/validation/validate-artifact'

/**
 * Tencent 优量汇 forbids `crossorigin` ON A <script> TAG (spec §III). The rule
 * shipped as a naive substring scan over the whole HTML, which is a different
 * and much wider rule: a bundle that merely NAMES the word in JS was rejected.
 *
 * Pixi.js does exactly that — `IBaseTextureOptions.crossorigin` is read as
 * `t.crossorigin` throughout `@pixi/core`, so every Pixi playable failed to
 * package for Tencent even though its emitted script tags were clean (the
 * classic-bundle rewrite strips the attribute before packaging anyway).
 *
 * `document.write` stays a substring rule — that one really is one, and the
 * upload rejects it with "index.html has unsafe function".
 */

const FIXTURES = join(__dirname, '../fixtures')
const BUILD = join(FIXTURES, 'gdt-crossorigin-build')
const OUT = join(FIXTURES, 'gdt-crossorigin-out')

const config = {
  storeUrlIos: 'https://apps.apple.com/app/123',
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.test',
  orientation: 'portrait' as const,
}

/** Writes a one-file build whose bundle body is `js`, packages it for gdt. */
async function packGdt(js: string, headExtra = '') {
  rmSync(BUILD, { recursive: true, force: true })
  mkdirSync(BUILD, { recursive: true })
  writeFileSync(
    join(BUILD, 'index.html'),
    `<!DOCTYPE html><html><head><title>Game</title>${headExtra}</head>` +
      `<body><script>${js}</script></body></html>`,
  )
  const errors: string[] = []
  const out = await packageForNetworks({
    buildDir: BUILD,
    outputDir: OUT,
    networks: ['gdt'],
    config,
    onProgress: (_id, phase, message) => {
      if (phase === 'error' && message) errors.push(message)
    },
  })
  return { result: out.results[0], errors }
}

// Minified Pixi, near enough: the option is read as a property, never quoted.
const PIXI_SHAPED = 'const g=new Image;II.crossOrigin(g,A,t.crossorigin),g.src=A;'

beforeAll(() => mkdirSync(FIXTURES, { recursive: true }))
afterAll(() => {
  for (const d of [BUILD, OUT]) if (existsSync(d)) rmSync(d, { recursive: true, force: true })
})

describe('Tencent 优量汇: crossorigin is an attribute rule, not a word ban', () => {
  it('packages a bundle that only names crossorigin in JS', async () => {
    const { result, errors } = await packGdt(PIXI_SHAPED)
    expect(errors).toEqual([])
    expect(result.outputPath).not.toBe('')
  })

  // The classic-bundle rewrite already strips the attribute from every script
  // tag before packaging, so a source that had one is repaired rather than
  // rejected. What must never happen is one SURVIVING into the artifact.
  it('strips a crossorigin attribute rather than shipping it', async () => {
    const { result, errors } = await packGdt(
      'var x=1;',
      '<script src="https://example.com/sdk.js" crossorigin></script>',
    )
    expect(errors).toEqual([])
    const zip = await JSZip.loadAsync(readFileSync(result.outputPath))
    const html = await zip.file('index.html')!.async('string')
    expect(html).not.toMatch(/<script[^>]*\scrossorigin/i)
  })

  it('still aborts on document.write, which really is a substring rule', async () => {
    const { result, errors } = await packGdt('document.write("x");')
    expect(errors.join(' ')).toMatch(/document\.write/)
    expect(result.outputPath).toBe('')
  })

  it('findForbiddenLiterals agrees with the packager on both shapes', () => {
    expect(findForbiddenLiterals('gdt', `<script>${PIXI_SHAPED}</script>`)).toEqual([])
    expect(
      findForbiddenLiterals('gdt', '<script src="a.js" crossorigin></script>'),
    ).toContain('crossorigin')
  })
})
