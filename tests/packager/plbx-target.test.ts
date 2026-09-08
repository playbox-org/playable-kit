import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { join, relative } from 'path'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { packageForNetworks } from '../../src/packager/packager'
import { getNetwork } from '../../src/networks'
import { BaseAdapter } from '../../src/packager/network-adapters/base'
import { LunaAdapter } from '../../src/packager/network-adapters/luna'
import {
  PlbxAdapter,
  PLBX_ARCHIVE_MEMBERS,
} from '../../src/packager/network-adapters/plbx'
import type { PackageConfig } from '../../src/types'

/**
 * The `plbx` target is the repack source: ONE network-agnostic archive the
 * extension uploads to the private repack service, which turns it into every
 * per-network artifact. The archive is exactly three members —
 *
 *   source.html  the ordinary kit output (self-contained loader, default Cocos
 *                rewrite, plain bridge, telemetry slot) — runnable, reviewable;
 *   build.zip    the build directory exactly as built, file for file, no
 *                exclusions and no rewrite — what the repack service extracts;
 *   plbx.json    metadata (kit version, app name, orientation, store URLs).
 *
 * These tests only look at what lands inside that archive, the way the Luna
 * e2e suite does, because that is the contract every downstream consumer
 * (plbx-collector's src/repack/*) is written against.
 */

const GP = 'https://play.google.com/store/apps/details?id=com.plbx.demo'
const AS = 'https://apps.apple.com/app/id123456789'

const FIXTURE = join(
  __dirname,
  '../../../plbx-cocos-extension/tests/fixtures/roadside-build/web-mobile',
)
const HAS_FIXTURE = existsSync(join(FIXTURE, 'index.html'))

/** Every file under `dir`, relative, forward slashes, sorted. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out.sort()
}

function makeBuild(): { root: string; build: string } {
  const root = mkdtempSync(join(tmpdir(), 'plbx-target-'))
  const build = join(root, 'web-mobile')
  mkdirSync(join(build, 'assets'), { recursive: true })
  mkdirSync(join(build, 'cocos-js'), { recursive: true })
  writeFileSync(
    join(build, 'index.html'),
    '<!DOCTYPE html><html><head><title>Demo</title>' +
      '<link rel="stylesheet" href="style.css"></head>' +
      '<body><script src="main.js"></script></body></html>',
  )
  writeFileSync(
    join(build, 'main.js'),
    `set_google_play_url("${GP}"); set_app_store_url("${AS}"); console.log("game");`,
  )
  writeFileSync(join(build, 'style.css'), 'body { margin: 0; background: #123; }')
  writeFileSync(join(build, 'assets', 'sprite.png'), randomBytes(512))
  writeFileSync(
    join(build, 'cocos-js', 'cc.js'),
    'var x = new XMLHttpRequest(); var u = new URL("a", "http://b/"); ' +
      'var s = document.createElement("script");',
  )
  return { root, build }
}

async function readArchive(zipPath: string) {
  const zip = await JSZip.loadAsync(readFileSync(zipPath))
  const entries = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .sort()
  const sourceHtml = await zip.file('source.html')!.async('string')
  const buildZipBuf = await zip.file('build.zip')!.async('nodebuffer')
  const plbx = JSON.parse(await zip.file('plbx.json')!.async('string'))
  const buildZip = await JSZip.loadAsync(buildZipBuf)
  return { entries, sourceHtml, buildZip, plbx }
}

/** The payload the self-contained loader carries inside source.html. */
async function embeddedPayload(sourceHtml: string): Promise<JSZip> {
  const m = /<script>window\.__plbx_zip = "([^"]*)";<\/script>/.exec(sourceHtml)
  expect(m, 'source.html carries the self-contained payload').not.toBeNull()
  return JSZip.loadAsync(Buffer.from(m![1], 'base64'))
}

describe('plbx target (synthetic build)', () => {
  let root = ''
  let build = ''
  let entries: string[] = []
  let sourceHtml = ''
  let buildZip: JSZip
  let plbx: any

  beforeAll(async () => {
    ;({ root, build } = makeBuild())
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: join(root, 'out'),
      networks: ['plbx'],
      config: { orientation: 'portrait' },
      templateVariables: { assetTitle: 'Demo' },
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].outputPath.endsWith('.zip')).toBe(true)
    ;({ entries, sourceHtml, buildZip, plbx } = await readArchive(
      result.results[0].outputPath,
    ))
  }, 60_000)

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('packages a build into exactly source.html, build.zip and plbx.json', () => {
    expect(entries).toEqual(['build.zip', 'plbx.json', 'source.html'])
    expect([...PLBX_ARCHIVE_MEMBERS].sort()).toEqual(entries)
  })

  it('keeps source.html runnable: self-contained loader, default rewrite applied, plbx_html bridge, no Luna, no mraid', async () => {
    expect(sourceHtml).toContain('window.__plbx_zip = "')
    expect(sourceHtml).toContain('_XMLLocalRequest')
    expect(sourceHtml).toContain('window.plbx_html')
    expect(sourceHtml).not.toContain('Luna.')
    expect(sourceHtml).not.toContain('mraid.js')
    // The payload inside source.html is the ordinary one: the Cocos rewrite
    // applied, so the self-contained loader can actually serve it.
    const payload = await embeddedPayload(sourceHtml)
    const cc = await payload.file('cocos-js/cc.js')!.async('string')
    expect(cc).toContain('_XMLLocalRequest')
    expect(cc).not.toContain('new XMLHttpRequest')
  })

  it('stores build.zip as the build produced it, file for file, including index.html and the CSS', async () => {
    const zipEntries = Object.keys(buildZip.files)
      .filter((n) => !buildZip.files[n].dir)
      .sort()
    const diskEntries = walk(build)
    expect(zipEntries).toEqual(diskEntries)
    expect(zipEntries).toContain('index.html')
    expect(zipEntries).toContain('style.css')
    for (const name of diskEntries) {
      const fromZip = await buildZip.file(name)!.async('nodebuffer')
      const fromDisk = readFileSync(join(build, name))
      expect(fromZip.equals(fromDisk), `${name} is byte-identical`).toBe(true)
    }
    const cc = await buildZip.file('cocos-js/cc.js')!.async('string')
    expect(cc).toContain('XMLHttpRequest')
    expect(cc).not.toContain('_XMLLocalRequest')
  })

  it('fills plbx.json from the same backfill luna.json gets', () => {
    expect(plbx.orientation).toBe('portrait')
    expect(plbx.appName).toBe('Demo')
    expect(plbx.storeUrls).toEqual({ googlePlay: GP, appStore: AS })
    expect(Number.isNaN(Date.parse(plbx.createdAt))).toBe(false)
    expect(typeof plbx.kitVersion).toBe('string')
    expect(plbx.kitVersion.length).toBeGreaterThan(0)
    expect(Object.keys(plbx).sort()).toEqual([
      'appName',
      'createdAt',
      'kitVersion',
      'orientation',
      'storeUrls',
    ])
  })
})

describe('plbx target (outputDir nested under the build dir)', () => {
  let root = ''
  let build = ''

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  /**
   * `build.zip` is a snapshot of the build directory, so it must be taken
   * BEFORE the packager writes anything into that directory. A caller is free
   * to point `outputDir` at a subdirectory of `buildDir` (the extension's
   * default is `<build>/output`), and the packager stages the inner HTML in
   * `_temp_<networkId>/` next to the archive it is about to write — so a
   * snapshot taken after that staging swallows the packager's own in-flight
   * artifact and ships it back to the repack service.
   */
  it("does not capture the packager's own temp files when outputDir is nested under buildDir", async () => {
    ;({ root, build } = makeBuild())
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: join(build, 'out'),
      networks: ['plbx'],
      config: { orientation: 'portrait' },
      templateVariables: { assetTitle: 'Demo' },
    })
    expect(result.results).toHaveLength(1)
    const { buildZip } = await readArchive(result.results[0].outputPath)
    const zipEntries = Object.keys(buildZip.files).sort()
    expect(zipEntries.filter((n) => n.includes('_temp_'))).toEqual([])
    expect(zipEntries.filter((n) => n.startsWith('out/'))).toEqual([])
    expect(zipEntries).toContain('index.html')
  }, 60_000)
})

describe('plbx adapter and the widened getZipExtraFiles hook', () => {
  const cfg: PackageConfig = {
    orientation: 'portrait',
    storeUrlAndroid: GP,
    storeUrlIos: AS,
    appName: 'Demo',
  }
  const ctx = { buildDir: '/nonexistent', kitVersion: '0.0.0-test' }

  it('widening getZipExtraFiles leaves the Luna adapter and the base default untouched', () => {
    const files = new LunaAdapter('luna', getNetwork('luna')!).getZipExtraFiles(
      cfg,
      ctx,
    )
    expect(Array.isArray(files)).toBe(true)
    expect(files.map((f) => f.zipPath).sort()).toEqual([
      'luna.json',
      'playground.json',
    ])
    for (const f of files) expect(typeof f.content).toBe('string')

    const base = new BaseAdapter('x', {
      id: 'x',
      name: 'X',
      format: 'zip',
      maxSize: 1,
      mraid: false,
      inlineAssets: true,
    })
    expect(base.getZipExtraFiles({ orientation: 'auto' })).toEqual([])
    expect(base.getZipExtraFiles({ orientation: 'auto' }, ctx)).toEqual([])
  })

  it('the plbx adapter refuses to run without the packager context', async () => {
    const a = new PlbxAdapter('plbx', getNetwork('plbx')!)
    await expect(a.getZipExtraFiles(cfg)).rejects.toThrow(/buildDir/)
  })
})

describe.skipIf(!HAS_FIXTURE)('plbx target (real Cocos 3.8 build)', () => {
  const OUT = join(__dirname, '../fixtures/plbx-target-output')
  let sourceHtml = ''
  let buildZip: JSZip
  let entries: string[] = []

  beforeAll(async () => {
    const result = await packageForNetworks({
      buildDir: FIXTURE,
      outputDir: OUT,
      networks: ['plbx'],
      config: { orientation: 'auto' },
      templateVariables: { assetTitle: 'Roadside Empire' },
    })
    expect(result.results).toHaveLength(1)
    ;({ entries, sourceHtml, buildZip } = await readArchive(
      result.results[0].outputPath,
    ))
  }, 120_000)

  afterAll(() => {
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
  })

  it('round-trips the roadside build byte for byte', async () => {
    expect(entries).toEqual(['build.zip', 'plbx.json', 'source.html'])
    const diskEntries = walk(FIXTURE)
    const zipEntries = Object.keys(buildZip.files)
      .filter((n) => !buildZip.files[n].dir)
      .sort()
    expect(zipEntries).toEqual(diskEntries)
    for (const name of diskEntries) {
      const fromZip = await buildZip.file(name)!.async('nodebuffer')
      const fromDisk = readFileSync(join(FIXTURE, name))
      expect(fromZip.equals(fromDisk), `${name} is byte-identical`).toBe(true)
    }
  }, 120_000)

  it('the source.html of a real build is self-contained and has no Luna', () => {
    expect(sourceHtml).toContain('window.__plbx_zip = "')
    expect(sourceHtml).not.toContain('Luna.')
    expect(sourceHtml).not.toContain('mraid.js')
  })
})
