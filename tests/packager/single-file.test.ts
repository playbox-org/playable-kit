import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { afterAll, describe, expect, it } from 'vitest'
import { packageForNetworks } from '../../src/packager/packager'
import { detectInputKind } from '../../src/packager/single-file'
import { HtmlBuilder } from '../../src/packager/html-builder'
import { NETWORKS, getNetwork, maxSizeForFormat } from '../../src/networks'
import { getAdapter } from '../../src/packager/network-adapters'
import { validateArtifact } from '../../src/validation/validate-artifact'

const FIXTURES = join(__dirname, '../fixtures')
const BUILD = join(FIXTURES, 'single-file-build')
const COCOS = join(FIXTURES, 'sample-build')
const OUT = join(FIXTURES, 'single-file-out')

afterAll(() => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
})

/** The primary HTML of a result — the file itself, or the entry inside its ZIP. */
async function primaryHtml(outputPath: string): Promise<string> {
  if (outputPath.endsWith('.html') || outputPath.endsWith('.js')) return readFileSync(outputPath, 'utf-8')
  const zip = await JSZip.loadAsync(readFileSync(outputPath))
  const entry = Object.keys(zip.files).find((f) => f.endsWith('.html'))!
  return zip.files[entry].async('string')
}

describe('input detection', () => {
  it('single-file when nothing local is referenced', () => {
    const b = new HtmlBuilder(readFileSync(join(BUILD, 'index.html'), 'utf-8'))
    expect(detectInputKind(b)).toBe('single-file')
  })
  it('loader when the build references local files (Cocos, plain multi-file)', () => {
    const b = new HtmlBuilder(readFileSync(join(COCOS, 'index.html'), 'utf-8'))
    expect(detectInputKind(b)).toBe('loader')
    expect(detectInputKind(b, 'loader')).toBe('loader')
  })
  it('forcing single-file on a multi-file build throws and names the ref', () => {
    const b = new HtmlBuilder(readFileSync(join(COCOS, 'index.html'), 'utf-8'))
    expect(() => detectInputKind(b, 'single-file')).toThrow(/not a single-file build.*cocos-js\/cc\.js/)
  })
  it('explicit loader on a single-file build is honoured', () => {
    const b = new HtmlBuilder(readFileSync(join(BUILD, 'index.html'), 'utf-8'))
    expect(detectInputKind(b, 'loader')).toBe('loader')
  })
})

describe('single-file packaging — every network', () => {
  const ids = Object.keys(NETWORKS)

  it('emits an artifact per network, within limits', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD,
      outputDir: OUT,
      networks: ids,
      config: { orientation: 'portrait' },
      templateVariables: { assetTitle: 'Fixture Game' },
      packagerVersion: '0.3.13',
    })
    const failed = result.results.filter((r) => !r.outputPath)
    expect(failed.map((r) => r.networkId)).toEqual([])
    for (const r of result.results) {
      expect(existsSync(r.outputPath), r.networkId).toBe(true)
      expect(r.withinLimit, `${r.networkId} ${r.outputSize} > ${r.maxSize}`).toBe(true)
    }
  }, 120_000)

  it('the HTML is a classic script with the bundle after the bridge, no loader', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD, outputDir: OUT, networks: ['applovin', 'mintegral', 'tiktok', 'google', 'luna', 'vungle'],
      config: { orientation: 'portrait' }, templateVariables: { assetTitle: 'Fixture Game' }, packagerVersion: '0.3.13',
    })
    for (const r of result.results) {
      const html = await primaryHtml(r.outputPath)
      expect(html, r.networkId).not.toContain('type="module"')
      expect(html, r.networkId).not.toContain('crossorigin')
      expect(html, r.networkId).not.toContain('__plbx_zip')
      const bridgeAt = html.indexOf('window.plbx_html = window.plbx_html ||')
      const bundleAt = html.indexOf('window.__fixture=')
      expect(bridgeAt, r.networkId).toBeGreaterThan(-1)
      expect(bundleAt, r.networkId).toBeGreaterThan(bridgeAt)
      // network SDK tags (TikTok) precede the bundle
      const sdkAt = html.indexOf('<script src="https://')
      if (sdkAt > -1 && r.networkId !== 'google') expect(sdkAt, r.networkId).toBeLessThan(bundleAt)
      // splash present and armed on game_ready
      expect(html, r.networkId).toContain('id="s"')
      expect(html, r.networkId).toContain('__plbx_splash_hide')
    }
  })

  it('inner names and config.json follow the network rules', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD, outputDir: OUT, networks: ['mintegral', 'vungle', 'snapchat', 'tiktok', 'luna'],
      config: { orientation: 'portrait' }, templateVariables: { assetTitle: 'Fixture Game' }, packagerVersion: '0.3.13',
    })
    const byId = Object.fromEntries(result.results.map((r) => [r.networkId, r]))
    const names = async (p: string) => Object.keys((await JSZip.loadAsync(readFileSync(p))).files)
    expect(byId.mintegral.outputPath.endsWith('Fixture_Game.zip')).toBe(true)
    expect(await names(byId.mintegral.outputPath)).toContain('Fixture_Game.html')
    expect(await names(byId.vungle.outputPath)).toContain('ad.html')
    expect(await names(byId.snapchat.outputPath)).toEqual(expect.arrayContaining(['index.html', 'config.json']))
    const tt = await JSZip.loadAsync(readFileSync(byId.tiktok.outputPath))
    expect(JSON.parse(await tt.files['config.json'].async('string'))).toEqual({ playable_orientation: 1 })
    expect(await names(byId.luna.outputPath)).toEqual(expect.arrayContaining(['source.html', 'luna.json', 'playground.json']))
  })

  it('the bridge block is byte-identical to the Cocos path for the same network', async () => {
    const cfg = { orientation: 'portrait' as const }
    for (const id of ['applovin', 'mintegral', 'facebook']) {
      const single = new HtmlBuilder(readFileSync(join(BUILD, 'index.html'), 'utf-8'))
      const cocos = new HtmlBuilder(readFileSync(join(COCOS, 'index.html'), 'utf-8'))
      getAdapter(id).transform(single, cfg)
      getAdapter(id).transform(cocos, cfg)
      const block = (h: string) => h.match(/<script>window\.plbx_html = [\s\S]*?<\/script>/)?.[0]
      expect(block(single.toHtml()), id).toBeDefined()
      expect(block(single.toHtml()), id).toBe(block(cocos.toHtml()))
    }
  })

  it('molocoV2 launcher payload carries the bundle', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD, outputDir: OUT, networks: ['molocoV2'],
      config: { orientation: 'portrait' }, templateVariables: { assetTitle: 'Fixture Game' }, packagerVersion: '0.3.13',
    })
    const r = result.results[0]
    expect(r.secondaryPath).toBeDefined()
    const payload = readFileSync(r.secondaryPath!, 'utf-8')
    expect(payload).toContain('window.__fixture=')
    expect(payload).not.toContain('__plbx_zip')
    expect(getNetwork('molocoV2')!.launcherPayload!.launcherMaxSize).toBe(3 * 1024)
    // No second splash: the launcher already renders its own
    // viewability-gated splash (launcher-builder.ts) — the single-file
    // splash must not be injected into the payload as well. Note: the
    // molocoV2 bridge itself defensively CALLS window.__plbx_splash_hide()
    // (to dismiss the launcher's own splash once game_ready + viewable) —
    // that reference is legitimate and present regardless of this fix, so
    // the marker checked here is the splash DEFINITION (buildSplash's
    // hideJs), which only the single-file path would inject.
    expect(payload).not.toContain('id="s"')
    expect(payload).not.toContain('window.__plbx_splash_hide=function(')
  })

  it('single-file artifacts pass validateArtifact with no failed checks (no runtime loader to fault)', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD, outputDir: OUT, networks: ['applovin', 'facebook'],
      config: { orientation: 'portrait' }, templateVariables: { assetTitle: 'Fixture Game' },
      packagerVersion: '0.3.14',
    })
    for (const r of result.results) {
      // dualFormat networks (facebook) emit two results per network id, e.g.
      // "facebook-html"/"facebook-zip" — the network registry only knows the
      // base id.
      const baseId = r.networkId.replace(/-(html|zip)$/, '')
      const network = getNetwork(baseId)!
      const html = await primaryHtml(r.outputPath)
      const checks = validateArtifact({
        networkId: baseId,
        html,
        buildDir: BUILD,
        files: [
          {
            kind: r.format as 'html' | 'zip',
            sizeBytes: r.outputSize,
            maxSizeBytes: maxSizeForFormat(network, r.format),
          },
        ],
      })
      const failed = checks.filter((c) => c.status === 'failed')
      expect(failed, `${r.networkId} (${r.format})`).toEqual([])
    }
  })
})
