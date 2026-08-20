import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import JSZip from 'jszip'
import { basename, join } from 'path'
import {
  resolveInnerHtmlName,
  packageForNetworks,
} from '../../src/packager/packager'
import { getNetwork } from '../../src/networks'

describe('resolveInnerHtmlName', () => {
  it('defaults to index.html', () => {
    expect(
      resolveInnerHtmlName({ htmlFileName: undefined } as any, 'out/web.zip', {}),
    ).toEqual({
      innerHtmlName: 'index.html',
      outputPath: 'out/web.zip',
    })
  })

  it('honours a literal htmlFileName and never renames the zip', () => {
    expect(
      resolveInnerHtmlName({ htmlFileName: 'source.html' } as any, 'out/web.zip', {}),
    ).toEqual({
      innerHtmlName: 'source.html',
      outputPath: 'out/web.zip',
    })
  })

  it('htmlFileName wins over htmlMatchesZipName', () => {
    const cfg = { htmlFileName: 'source.html', htmlMatchesZipName: true } as any
    expect(resolveInnerHtmlName(cfg, 'out/RISE_01.zip', {}).innerHtmlName).toBe(
      'source.html',
    )
  })

  it('still applies the Mintegral zip-naming rule to both names', () => {
    // Regression net for the extraction: htmlMatchesZipName renames the outer
    // .zip as well, and sanitizes to [A-Za-z0-9_].
    expect(
      resolveInnerHtmlName({ htmlMatchesZipName: true } as any, 'out/RISE play-01.zip', {}),
    ).toEqual({
      innerHtmlName: 'RISE_play_01.html',
      outputPath: 'out/RISE_play_01.zip',
    })
  })

  it('falls back to the asset title when the template left the basename "index"', () => {
    expect(
      resolveInnerHtmlName({ htmlMatchesZipName: true } as any, 'out/index.zip', {
        assetTitle: 'My Game',
      }),
    ).toEqual({
      innerHtmlName: 'My_Game.html',
      outputPath: 'out/My_Game.zip',
    })
  })
})

/**
 * FINDING 3 regression. The plain-zip branch of packageForNetworks destructured
 * only `innerHtmlName` and threw the returned `outputPath` away, so a zip
 * network combining htmlMatchesZipName with singleFileZip:false wrote
 * `My_Game.html` INSIDE an archive that stayed `index.zip` — exactly the
 * mismatch the rule exists to prevent (the wrap branch already reassigns it).
 * No registry entry hits that combination today, so the test pins the flag onto
 * the one plain-zip network (yandex) for the duration and restores it.
 */
describe('a plain-zip network honours htmlMatchesZipName on both names', () => {
  it('renames the archive to match the inner HTML', async () => {
    const net = getNetwork('yandex')!
    const previous = net.htmlMatchesZipName
    net.htmlMatchesZipName = true
    const root = fs.mkdtempSync(join(os.tmpdir(), 'plbx-zipname-'))
    try {
      const result = await packageForNetworks({
        buildDir: join(__dirname, '..', 'fixtures', 'plain-html-build'),
        outputDir: join(root, 'out'),
        networks: ['yandex'],
        config: { orientation: 'portrait' },
        templateVariables: { assetTitle: 'My Game' },
      })
      const outputPath = result.results[0].outputPath
      expect(basename(outputPath)).toBe('My_Game.zip')
      const zip = await JSZip.loadAsync(fs.readFileSync(outputPath))
      expect(Object.keys(zip.files)).toContain('My_Game.html')
    } finally {
      net.htmlMatchesZipName = previous
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})

/**
 * The plain-zip branch cpSync's the whole build into the temp dir and THEN
 * writes the transformed HTML. While the inner name was always index.html that
 * write overwrote the copied original; now that the name can differ (Luna's
 * source.html, Mintegral's <Playable>.html) the copy would survive alongside it
 * and the archive would ship two entry points — one of them the raw build, with
 * no network bridge, no CTA wiring and no lifecycle hooks. A loader that opens
 * index.html gets that one.
 */
describe('a renamed inner HTML leaves no untransformed original behind', () => {
  it('drops the build\'s own index.html from the archive', async () => {
    const net = getNetwork('yandex')!
    const previous = net.htmlMatchesZipName
    net.htmlMatchesZipName = true
    const root = fs.mkdtempSync(join(os.tmpdir(), 'plbx-zipname-'))
    try {
      const result = await packageForNetworks({
        buildDir: join(__dirname, '..', 'fixtures', 'plain-html-build'),
        outputDir: join(root, 'out'),
        networks: ['yandex'],
        config: { orientation: 'portrait' },
        templateVariables: { assetTitle: 'My Game' },
      })
      const zip = await JSZip.loadAsync(
        fs.readFileSync(result.results[0].outputPath),
      )
      const names = Object.keys(zip.files)
      expect(names).toContain('My_Game.html')
      expect(names).not.toContain('index.html')
      // and the surviving one is the TRANSFORMED html, not the copied source
      const html = await zip.file('My_Game.html')!.async('string')
      expect(html).toContain('plbx_html')
    } finally {
      net.htmlMatchesZipName = previous
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('still ships index.html for a network that does not rename it', async () => {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'plbx-zipname-'))
    try {
      const result = await packageForNetworks({
        buildDir: join(__dirname, '..', 'fixtures', 'plain-html-build'),
        outputDir: join(root, 'out'),
        networks: ['yandex'],
        config: { orientation: 'portrait' },
      })
      const zip = await JSZip.loadAsync(
        fs.readFileSync(result.results[0].outputPath),
      )
      expect(Object.keys(zip.files)).toContain('index.html')
      const html = await zip.file('index.html')!.async('string')
      expect(html).toContain('plbx_html')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
