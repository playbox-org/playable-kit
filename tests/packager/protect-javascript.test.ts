import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runInNewContext, Script } from 'vm'
import { load } from 'cheerio'
import JSZip from 'jszip'
// @ts-expect-error jsdom is a test-only dependency without declarations.
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { NETWORKS } from '../../src/networks'
import { packageForNetworks } from '../../src/packager/packager'
import { protectJavaScript, protectPlayableHtml } from '../../src/packager/protect-javascript'
import { buildPreviewRendition } from '../../src/preview/preview-rendition'
import { validateArtifact } from '../../src/validation/validate-artifact'

const roots: string[] = []
const game = `(() => {
  // Design notes must not ship.
  function mergeMoonGems(score) { return "Merge moon gems " + score; }
  document.getElementById("game").textContent = mergeMoonGems(7);
  document.getElementById("cta").onclick = () => window.plbx_html.download();
})();`
const html = `<!doctype html><html><head><title>Owned test ad</title></head><body>
<div id="game"></div><button id="cta">Install</button><script type="module">${game}</script></body></html>`
const config = {
  orientation: 'portrait' as const,
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.playbox.test',
  storeUrlIos: 'https://apps.apple.com/app/id123',
}
function workspace(entry = html) {
  const root = mkdtempSync(join(tmpdir(), 'plbx-protection-'))
  roots.push(root)
  const buildDir = join(root, 'build'), outputDir = join(root, 'out')
  mkdirSync(buildDir)
  writeFileSync(join(buildDir, 'index.html'), entry)
  return { buildDir, outputDir, config, packagerVersion: '0.4.4' }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('minifies private names and escapes strings without dynamic code or corrupting assets', () => {
  const source = `(() => { function mergeMoonGems(value) { return value + "Merge moon gems"; }
    window.result = mergeMoonGems(window.input); window.asset = "data:image/png;base64,abcd";
    window.unicode = "\u2603"; window.close = "</script>"; })();\n//# sourceMappingURL=game.js.map`
  const code = protectJavaScript(source)
  expect(code).not.toMatch(/mergeMoonGems|Merge moon gems|sourceMappingURL|eval\s*\(|new Function|\n|<\/script/i)
  expect(code).toContain('data:image/png;base64,abcd')
  const window = { input: 7 } as Record<string, unknown>
  runInNewContext(code, { window }, { contextCodeGeneration: { strings: false, wasm: false } })
  expect(window).toMatchObject({ result: '7Merge moon gems', unicode: '\u2603', close: '</script>' })
  expect(protectJavaScript(source)).toBe(code)
  expect(protectJavaScript('/*! Engine license MIT */\n' + source)).toContain('/*! Engine license MIT */')
  expect(protectJavaScript('/*! license </script> */\n' + source)).not.toContain('</script>')
  expect(() => protectJavaScript('const broken = ;')).toThrow()
  const document = protectPlayableHtml(`${html}<script type="application/json">{"label":"data"}</script>`)
  expect(document).toContain('{"label":"data"}')
  expect(document).not.toContain('Merge moon gems')
})

it('ships protected, valid HTML/ZIP/payload artifacts for every target, keeping source unchanged', async () => {
  const input = workspace()
  const { results } = await packageForNetworks({ ...input, networks: Object.keys(NETWORKS) })
  expect(results.length).toBeGreaterThanOrEqual(Object.keys(NETWORKS).length)
  for (const result of results) {
    expect(result.outputPath, result.networkId).not.toBe('')
    expect(result.withinLimit, result.networkId).toBe(true)
    let document: string
    if (result.format === 'zip') {
      const zip = await JSZip.loadAsync(readFileSync(result.outputPath))
      const entry = Object.keys(zip.files).find(name => name.endsWith('.html'))!
      document = await zip.file(entry)!.async('string')
    } else document = readFileSync(result.secondaryPath || result.outputPath, 'utf8')
    expect(document, result.networkId).not.toMatch(/mergeMoonGems|Merge moon gems|Design notes/)
    if (result.format !== 'launcher-payload') {
      const networkId = Object.keys(NETWORKS).find(id => result.networkId === id || result.networkId.startsWith(id + '-'))!
      const failed = validateArtifact({ networkId, html: document, buildDir: input.buildDir,
        files: [{ kind: result.format, sizeBytes: result.outputSize, maxSizeBytes: result.maxSize }] })
        .filter(check => check.status === 'failed')
      expect(failed, result.networkId).toEqual([])
    }
  }
  expect(readFileSync(join(input.buildDir, 'index.html'), 'utf8')).toBe(html)
})

it('retains every readable input byte and private repack member alongside protected releases', async () => {
  const input = workspace(html.replace('</body>', '<script src="main.js"></script></body>'))
  writeFileSync(join(input.buildDir, 'main.js'), game + '\n//# sourceMappingURL=main.js.map')
  writeFileSync(join(input.buildDir, 'main.js.map'), JSON.stringify({ sourcesContent: [game] }))
  mkdirSync(join(input.buildDir, 'assets'))
  writeFileSync(join(input.buildDir, 'assets', 'pixel.bin'), Buffer.from([0, 128, 255]))
  const snapshot = () => Object.fromEntries(
    (readdirSync(input.buildDir, { recursive: true }) as string[]).sort()
      .filter(path => statSync(join(input.buildDir, path)).isFile())
      .map(path => [path, readFileSync(join(input.buildDir, path))]),
  )
  const original = snapshot()
  const { results } = await packageForNetworks({ ...input, networks: ['applovin', 'yandex', 'plbx'] })
  expect(results.map(result => [result.networkId, result.format])).toEqual([
    ['applovin', 'html'], ['yandex', 'zip'], ['plbx', 'zip'],
  ])
  expect(snapshot()).toEqual(original)

  for (const result of results) {
    expect(result.outputPath).not.toBe('')
    const output = readFileSync(result.outputPath)
    expect(output).not.toEqual(original['index.html'])
    const archive = result.format === 'zip' ? await JSZip.loadAsync(output) : null
    const document = archive
      ? await archive.file(result.networkId === 'plbx' ? 'source.html' : 'index.html')!.async('string')
      : output.toString('utf8')
    expect(document).not.toMatch(/mergeMoonGems|Merge moon gems|Design notes|sourceMappingURL/)
    const encoded = document.match(/window\.__plbx_zip = "([^"]+)"/)
    const scripts = encoded ? await JSZip.loadAsync(Buffer.from(encoded[1], 'base64')) : archive!
    expect(Object.keys(scripts.files)).not.toContain('main.js.map')
    const releaseScript = await scripts.file(result.networkId === 'yandex' ? 'res.js' : 'main.js')!.async('nodebuffer')
    expect(releaseScript).not.toEqual(original['main.js'])
    expect(releaseScript.toString('utf8')).not.toMatch(/mergeMoonGems|Merge moon gems|Design notes|sourceMappingURL/)

    if (result.networkId === 'plbx') {
      const repack = await JSZip.loadAsync(await archive!.file('build.zip')!.async('nodebuffer'))
      const members = Object.keys(repack.files).filter(path => !repack.files[path].dir).sort()
      expect(members).toEqual(Object.keys(original))
      for (const path of members) {
        expect(await repack.file(path)!.async('nodebuffer'), path).toEqual(original[path])
      }
    }
  }
})

it('rejects overlapping outputs before any writes or progress, including a later target', async () => {
  for (const scenario of ['direct', 'nested', 'later', 'alias', 'template', 'staging', 'file-alias']) {
    const input = workspace()
    const root = join(input.buildDir, '..')
    mkdirSync(join(input.buildDir, 'assets'))
    writeFileSync(join(input.buildDir, 'assets', 'index.html'), html)
    symlinkSync(input.buildDir, join(root, 'alias'), 'dir')
    const snapshot = () => Object.fromEntries(
      (readdirSync(root, { recursive: true }) as string[]).sort()
        .map(path => [path, statSync(join(root, path)).isFile() ? readFileSync(join(root, path)) : null]),
    )
    const onProgress = vi.fn()
    const outputDir = scenario === 'alias' ? join(root, 'alias')
      : scenario === 'nested' ? join(input.buildDir, 'assets')
      : scenario === 'template' || scenario === 'file-alias' ? input.outputDir : input.buildDir
    const outputTemplate = scenario === 'later' ? '{networkId}/index.{ext}'
      : scenario === 'template' ? '../build/index.{ext}' : 'index.{ext}'
    const networks = scenario === 'later' ? ['applovin', 'yandex'] : ['applovin']
    if (scenario === 'later') {
      mkdirSync(join(input.buildDir, 'yandex'))
      writeFileSync(join(input.buildDir, 'yandex', 'source.js'), game)
    }
    if (scenario === 'staging') {
      mkdirSync(join(input.buildDir, '_temp_yandex'))
      writeFileSync(join(input.buildDir, '_temp_yandex', 'source.js'), game)
      networks[0] = 'yandex'
    }
    if (scenario === 'file-alias') {
      mkdirSync(input.outputDir)
      symlinkSync(join(input.buildDir, 'index.html'), join(input.outputDir, 'index.html'))
    }
    const expected = snapshot()
    await expect(packageForNetworks({ ...input, outputDir, outputTemplate, networks, onProgress }))
      .rejects.toThrow(/output.*overlap.*input build/i)
    expect(onProgress).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(expected)
  }
})

it('keeps the preview playable and MRAID CTA working with dynamic code disabled', async () => {
  const input = workspace()
  const { results } = await packageForNetworks({ ...input, networks: ['applovin'] })
  const artifact = readFileSync(results[0].outputPath, 'utf8')
  const preview = buildPreviewRendition({ html: artifact, networkId: 'applovin', mode: 'happy' })
  expect(preview).not.toContain('Merge moon gems')
  const dom = new JSDOM(artifact, { runScripts: 'outside-only', url: 'https://playable.test/' })
  const clicks: string[] = []
  try {
    const window = dom.window
    window.mraid = { open: (url: string) => clicks.push(url), isViewable: () => true, getState: () => 'default', addEventListener() {} }
    window.gameReady = () => {}
    window.eval = () => { throw new Error('eval is forbidden') }
    window.Function = function () { throw new Error('Function is forbidden') } as unknown as typeof Function
    const $ = load(artifact)
    $('script:not([src])').each((_, script) => {
      new Script($(script).text()).runInContext(dom.getInternalVMContext())
    })
    expect(window.document.getElementById('game')!.textContent).toBe('Merge moon gems 7')
    window.document.getElementById('cta')!.click()
    expect(clicks).toEqual([config.storeUrlAndroid])
  } finally { dom.window.close() }
})

it('protects loader ZIP members and boot scripts, excludes maps, and retains Cocos boot ordering', async () => {
  const input = workspace('<html><body><script src="main.js"></script><script>System.import("game");</script></body></html>')
  writeFileSync(join(input.buildDir, 'main.js'), game)
  writeFileSync(join(input.buildDir, 'main.js.map'), '{"sourcesContent":["Merge moon gems"]}')
  const { results } = await packageForNetworks({ ...input, networks: ['applovin', 'yandex'] })
  const artifact = readFileSync(results[0].outputPath, 'utf8')
  expect(artifact).not.toMatch(/Merge moon gems|mergeMoonGems/)
  const encoded = artifact.match(/window\.__plbx_zip = "([^"]+)"/)![1]
  const zip = await JSZip.loadAsync(Buffer.from(encoded, 'base64'))
  expect(Object.keys(zip.files)).not.toContain('main.js.map')
  expect(await zip.file('main.js')!.async('string')).not.toContain('Merge moon gems')
  const calls: string[] = []
  const context = { window: {} as Record<string, () => void>, System: { import: (name: string) => calls.push(name) } }
  const boot = load(artifact)('script:not([src])').eq(1).text()
  runInNewContext(boot, context)
  expect(calls).toEqual([])
  context.window.__plbx_boot()
  expect(calls).toEqual(['game'])
  const plainZip = await JSZip.loadAsync(readFileSync(results[1].outputPath))
  expect(Object.keys(plainZip.files)).not.toContain('main.js.map')
  expect(await plainZip.file('res.js')!.async('string')).not.toContain('Merge moon gems')
})
