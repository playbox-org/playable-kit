import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { afterAll, describe, expect, it } from 'vitest'
import { packageForNetworks } from '../../src/packager/packager'
import { NETWORKS } from '../../src/networks'
import { main as cli } from '../../src/cli'

/**
 * The PLBX loading splash is OPT-IN. Nothing the packager emits by default —
 * on the loader (Cocos) path, on the single-file path, through the CLI, for
 * any network — may carry the splash overlay or its hide hook. This guards
 * the default itself, so a future "showSplash ?? true" cannot slip back in
 * behind a per-network test that happens to pass showSplash explicitly.
 *
 * Moloco V2's launcher.html carries its OWN splash, driven by the registry
 * (`launcherPayload.includeSplash`), not by PackageConfig.showSplash — the
 * launcher files are therefore excluded; the payload is not.
 */
const FIXTURES = join(__dirname, '../fixtures')
const SINGLE = join(FIXTURES, 'single-file-build')
const COCOS = join(FIXTURES, 'sample-build')
const OUT = join(FIXTURES, 'splash-default-out')

const SPLASH_MARKERS = ['id="s"', 'window.__plbx_splash_hide=function(']
const ALL_NETWORKS = Object.keys(NETWORKS)

afterAll(() => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
})

/** Every shipped text document: bare html/js files and every .html inside a zip. */
async function shippedDocuments(dir: string): Promise<Array<{ name: string; text: string }>> {
  const docs: Array<{ name: string; text: string }> = []
  const walk = async (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (statSync(p).isDirectory()) {
        await walk(p)
        continue
      }
      // Registry-driven launcher splash — not the packager default under test.
      if (entry === 'launcher.html' || entry === 'launcher-local.html') continue
      if (entry.endsWith('.html') || entry.endsWith('.js')) {
        docs.push({ name: p, text: readFileSync(p, 'utf-8') })
      } else if (entry.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(readFileSync(p))
        for (const f of Object.keys(zip.files)) {
          if (f.endsWith('.html')) docs.push({ name: `${p}!${f}`, text: await zip.files[f].async('string') })
        }
      }
    }
  }
  await walk(dir)
  return docs
}

function expectNoSplash(docs: Array<{ name: string; text: string }>) {
  expect(docs.length).toBeGreaterThan(0)
  for (const { name, text } of docs) {
    for (const marker of SPLASH_MARKERS) {
      expect(text.includes(marker), `${name} carries splash marker ${marker}`).toBe(false)
    }
  }
}

describe('showSplash defaults to false everywhere', () => {
  it('single-file path: no network ships the splash by default', async () => {
    const out = join(OUT, 'single')
    const result = await packageForNetworks({
      buildDir: SINGLE,
      outputDir: out,
      networks: ALL_NETWORKS,
      config: { orientation: 'portrait' },
      templateVariables: { assetTitle: 'Fixture Game' },
      packagerVersion: '0.3.15',
    })
    expect(result.results.filter((r) => !r.outputPath).map((r) => r.networkId)).toEqual([])
    expectNoSplash(await shippedDocuments(out))
  }, 180_000)

  it('loader (Cocos) path: no network ships the splash by default', async () => {
    const out = join(OUT, 'loader')
    const result = await packageForNetworks({
      buildDir: COCOS,
      outputDir: out,
      networks: ALL_NETWORKS,
      config: { orientation: 'portrait' },
      templateVariables: { assetTitle: 'Fixture Game' },
      packagerVersion: '0.3.15',
    })
    expect(result.results.filter((r) => !r.outputPath).map((r) => r.networkId)).toEqual([])
    expectNoSplash(await shippedDocuments(out))
  }, 180_000)

  it('CLI: no --splash means no splash', async () => {
    const out = join(OUT, 'cli')
    const code = await cli(
      ['package', '--build', SINGLE, '--out', out, '--networks', 'applovin,mintegral,molocoV2', '--name', 'Fixture Game'],
      () => {},
    )
    expect(code).toBe(0)
    expectNoSplash(await shippedDocuments(out))
  }, 120_000)

  it('the splash still exists when asked for (the guard is not vacuous)', async () => {
    const out = join(OUT, 'opt-in')
    await packageForNetworks({
      buildDir: SINGLE,
      outputDir: out,
      networks: ['applovin'],
      config: { orientation: 'portrait', showSplash: true },
      packagerVersion: '0.3.15',
    })
    const [doc] = await shippedDocuments(out)
    for (const marker of SPLASH_MARKERS) expect(doc.text).toContain(marker)
  })
})
