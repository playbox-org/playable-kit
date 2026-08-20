import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { packageForNetworks } from '../../src/packager/packager'

/**
 * End-to-end Luna packaging against a REAL Cocos 3.8 web-mobile build.
 *
 * Every other Luna test works on the adapter or the bridge in isolation, which
 * is where type-clean-but-dead wiring hides: a manifest hook that is never
 * called, a store URL the packager resolves into a config no adapter can see,
 * an `mraid.js` literal that survives into the artifact. This test only looks
 * at what actually lands inside the archive Luna would receive.
 *
 * The fixture lives in the Cocos extension repo (a sibling checkout), so the
 * suite skips cleanly when only the kit is checked out — same gating the
 * other fixture-backed tests use.
 */
const FIXTURE = join(
  __dirname,
  '../../../plbx-cocos-extension/tests/fixtures/roadside-build/web-mobile',
)
const HAS_FIXTURE = existsSync(join(FIXTURE, 'index.html'))
const OUT = join(__dirname, '../fixtures/luna-e2e-output')

// Store links the fixture's own game code sets at runtime. They live inside the
// build source, never in PackageConfig — the packager recovers them
// (extractStoreUrls → resolveStoreUrls) and must fill luna.json with them,
// because the editor never sets storeUrl*.
const ANDROID = 'https://play.google.com/store/apps/details?id=com.hybridparking.game'
const IOS = 'https://apps.apple.com/us/app/roadside-empire-gas-station/id6673911988'

// Store links for the synthetic (fixture-free) build used by the scoping tests
// at the bottom of this file.
const SCOPE_ANDROID = 'https://play.google.com/store/apps/details?id=com.scope.test'
const SCOPE_IOS = 'https://apps.apple.com/app/id999999999'

describe.skipIf(!HAS_FIXTURE)('luna end-to-end (real Cocos 3.8 build)', () => {
  let entries: string[] = []
  let sourceHtml = ''
  let lunaJson: any
  let playgroundJson: any

  beforeAll(async () => {
    const result = await packageForNetworks({
      buildDir: FIXTURE,
      outputDir: OUT,
      networks: ['luna'],
      // Deliberately no storeUrl* — the editor never sets them either.
      config: { orientation: 'auto' },
      templateVariables: { assetTitle: 'Roadside Empire' },
    })
    expect(result.results).toHaveLength(1)
    const zipPath = result.results[0].outputPath
    expect(zipPath.endsWith('.zip')).toBe(true)

    const zip = await JSZip.loadAsync(readFileSync(zipPath))
    entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
    sourceHtml = await zip.file('source.html')!.async('string')
    lunaJson = JSON.parse(await zip.file('luna.json')!.async('string'))
    playgroundJson = JSON.parse(
      await zip.file('playground.json')!.async('string'),
    )
  }, 120_000)

  afterAll(() => {
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
  })

  it('ships exactly the three files Luna looks for', () => {
    // Luna's uploader reads source.html BY NAME and rejects anything else at
    // the archive root; an extra config.json from a copy-pasted zip branch is
    // the kind of thing only this assertion catches.
    expect(entries.sort()).toEqual([
      'luna.json',
      'playground.json',
      'source.html',
    ])
  })

  it('fills luna.json with the store links recovered from the build', () => {
    expect(lunaJson.unity.packages.default.androidLink).toBe(ANDROID)
    expect(lunaJson.unity.packages.default.iosLink).toBe(IOS)
  })

  it('maps orientation into Luna and TikTok vocabularies', () => {
    // 'auto' is OUR word; Luna's is 'unspecified' and TikTok's is 0.
    expect(lunaJson.unity.packages.default.orientation).toBe('unspecified')
    expect(lunaJson.unity.packages.tiktok.orientation).toBe(0)
  })

  it('keeps the reference-archive skeleton keys Luna exporter reads', () => {
    expect(lunaJson.unity.packages.default.supportedLanguages).toEqual(['en'])
    expect(lunaJson.unity.packages.ironsource).toMatchObject({
      appID: '',
      apiType: 0,
    })
    expect(lunaJson.unity.packages.facebook).toEqual({
      assetID: '',
      packageType: 0,
    })
  })

  it('names the creative in both manifests', () => {
    expect(lunaJson.unity.packages.default.applicationName).toBe(
      'Roadside Empire',
    )
    expect(playgroundJson).toEqual({
      title: 'Roadside Empire',
      icon: null,
      fields: {},
    })
  })

  it('carries no mraid wrapper of its own', () => {
    // Luna injects each network SDK at export time; a leaked 'mraid.js' literal
    // is rejected by the downstream validators that grep the raw HTML.
    expect(sourceHtml).not.toContain('mraid.js')
  })

  it('defines startGame before the loader ever runs', () => {
    // The boot-gate race: startGame used to be created inside __plbx_pre_boot,
    // which the runtime loader calls only after the asset unpack (~90 ms after
    // load on this build). Luna calls startGame() at load, so it hit
    // "startGame is not a function" and the creative never left the splash.
    // Position, not presence, is what proves the fix survived packaging.
    const start = sourceHtml.indexOf('window.startGame = function')
    const gate = sourceHtml.indexOf('window.__plbx_pre_boot = function')
    expect(start).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(-1)
    expect(start).toBeLessThan(gate)
  })

  it('wires the CTA, game end and lifecycle into the artifact', () => {
    expect(sourceHtml).toContain('Luna.Unity.Playable.InstallFullGame()')
    expect(sourceHtml).toContain('Luna.Unity.LifeCycle.GameEnded()')
    for (const e of ['luna:pause', 'luna:resume', 'luna:mute', 'luna:unmute'])
      expect(sourceHtml).toContain(e)
    // window.open override — dispatchers that bypass plbx_html.download.
    expect(sourceHtml).toContain('window.open = function')
  })

  it('marks the channel as luna for super-html-era games', () => {
    expect(sourceHtml).toContain('window.super_html_channel = "luna"')
  })
})

/**
 * FINDING A regression — the Luna store-URL backfill must be invisible to every
 * other network.
 *
 * The backfill used to fill `options.config.storeUrl*` IN PLACE, once, before
 * the per-network loop. But `BaseAdapter.transform` emits
 * `window.plbx_html.google_play_url = "<url>"` from those very fields for EVERY
 * network, so packaging the same build for applovin started emitting
 * `mraid.open(<scraped Google Play URL>)` where it had emitted `mraid.open()` —
 * a behaviour change on 20+ live targets shipped as a side effect of a Luna
 * feature. Both the artifact and the caller's own config object must stay
 * exactly as they were before the Luna work.
 */
describe('the Luna store-URL backfill is scoped to the luna target', () => {
  const roots: string[] = []

  // A minimal build whose game source carries the store links, exactly like the
  // real path (the editor never sets PackageConfig.storeUrl*).
  const mkBuild = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'plbx-luna-scope-'))
    roots.push(root)
    const build = join(root, 'web-mobile')
    mkdirSync(build, { recursive: true })
    writeFileSync(
      join(build, 'index.html'),
      '<!DOCTYPE html><html><head></head><body><script src="main.js"></script></body></html>',
    )
    writeFileSync(
      join(build, 'main.js'),
      `set_google_play_url("${SCOPE_ANDROID}"); set_app_store_url("${SCOPE_IOS}");`,
    )
    return build
  }

  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true })
  })

  it('leaves a non-luna artifact free of the scraped store-URL assignments', async () => {
    const build = mkBuild()
    const out = join(build, '..', 'out')
    const config = { orientation: 'portrait' as const }
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: out,
      networks: ['applovin'],
      config,
    })
    const html = readFileSync(result.results[0].outputPath, 'utf-8')
    // The <head> comment mirroring the URL is fine and predates Luna; the
    // plbx_html ASSIGNMENT is what rewires the MRAID CTA.
    expect(html).not.toContain(
      `window.plbx_html.google_play_url = "${SCOPE_ANDROID}"`,
    )
    expect(html).not.toContain(
      `window.plbx_html.appstore_url = "${SCOPE_IOS}"`,
    )
    // The caller's config object is an input, not a scratch buffer — a mutated
    // one also leaks into the next packaging run that reuses it.
    expect(config).toEqual({ orientation: 'portrait' })
  }, 60_000)

  it('produces a byte-identical applovin artifact whether or not luna is packaged too', async () => {
    const build = mkBuild()
    const alone = await packageForNetworks({
      buildDir: build,
      outputDir: join(build, '..', 'out-alone'),
      networks: ['applovin'],
      config: { orientation: 'portrait' },
    })
    const withLuna = await packageForNetworks({
      buildDir: build,
      outputDir: join(build, '..', 'out-with-luna'),
      networks: ['applovin', 'luna'],
      config: { orientation: 'portrait' },
    })
    const applovin = withLuna.results.find((r) => r.networkId === 'applovin')!
    expect(readFileSync(applovin.outputPath)).toEqual(
      readFileSync(alone.results[0].outputPath),
    )
  }, 120_000)

  it('still fills luna.json from the same resolved URLs', async () => {
    // The scoping must not turn the Luna feature off: luna keeps seeing them.
    const build = mkBuild()
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: join(build, '..', 'out-luna'),
      networks: ['luna'],
      config: { orientation: 'portrait' },
    })
    const zip = await JSZip.loadAsync(readFileSync(result.results[0].outputPath))
    const luna = JSON.parse(await zip.file('luna.json')!.async('string'))
    expect(luna.unity.packages.default.androidLink).toBe(SCOPE_ANDROID)
    expect(luna.unity.packages.default.iosLink).toBe(SCOPE_IOS)
  }, 60_000)
})
