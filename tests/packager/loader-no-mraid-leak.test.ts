import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { emitSharedHelpers } from '../../src/packager/loader/shared'
import { emitLifecycle } from '../../src/packager/loader/lifecycle'
import { generateSelfContainedLoader } from '../../src/packager/loader'
import { getAdapter } from '../../src/packager/network-adapters'
import { packageForNetworks } from '../../src/packager/packager'

// Facebook/Moloco validators reject any HTML containing the literal `mraid.js`
// ("Playable shouldn't include the 'mraid.js' function"). The self-contained
// loader is emitted into EVERY build, including non-MRAID networks (mraid:false,
// e.g. facebook/moloco) where no `<script src="mraid.js">` is injected — so the
// network-agnostic loader source must not leak the token itself. Real MRAID
// networks still get their legit `<script src="mraid.js">` from BaseAdapter.
describe('self-contained loader does not leak mraid tokens (FB/Moloco validator)', () => {
  it('emitSharedHelpers() contains no mraid token', () => {
    expect(emitSharedHelpers()).not.toMatch(/mraid/i)
  })

  it('emitLifecycle() contains no mraid token', () => {
    expect(emitLifecycle({})).not.toMatch(/mraid/i)
  })

  it('assembled loader ships no whole-line comments and no mraid token', () => {
    const loader = generateSelfContainedLoader({})
    expect(loader).not.toMatch(/mraid/i)
    const commentLines = loader
      .split('\n')
      .filter((l) => l.trim().startsWith('//'))
    expect(commentLines).toEqual([])
  })
})

// The unit checks above only cover the loader. The token can also arrive from the
// splash, an adapter, or the game's own index.html — anything landing in the
// plaintext HTML (game assets live in the base64/base122 container, invisible to a
// substring scan). These two layers close that gap: the adapter declares `mraid.js`
// forbidden for every mraid:false network (so packageForNetworks aborts the build
// instead of silently shipping a rejectable creative), and the end-to-end pass
// scans the actual file we would upload.
describe('mraid.js is a forbidden string on non-MRAID networks', () => {
  it('moloco (mraid:false) forbids it', () => {
    expect(getAdapter('moloco').getForbiddenStrings()).toContain('mraid.js')
  })

  it('facebook (mraid:false) forbids it', () => {
    expect(getAdapter('facebook').getForbiddenStrings()).toContain('mraid.js')
  })

  it('mintegral keeps its own forbidden strings on top of the base ones', () => {
    expect(getAdapter('mintegral').getForbiddenStrings()).toEqual(
      expect.arrayContaining(['mraid.js', 'preview-util.js', 'preview-util']),
    )
  })

  it('applovin (mraid:true) does NOT forbid it — the MRAID script tag is required', () => {
    expect(getAdapter('applovin').getForbiddenStrings()).not.toContain(
      'mraid.js',
    )
  })
})

const BUILD_DIR = join(__dirname, '../fixtures/mraid-leak-build')
const OUT_DIR = join(__dirname, '../fixtures/mraid-leak-output')

describe('packaged HTML (end-to-end)', () => {
  beforeAll(() => {
    mkdirSync(join(BUILD_DIR, 'assets'), { recursive: true })
    writeFileSync(
      join(BUILD_DIR, 'index.html'),
      '<!DOCTYPE html><html><head><title>Game</title></head><body><canvas id="GameCanvas"></canvas><script src="main.js"></script></body></html>',
    )
    writeFileSync(join(BUILD_DIR, 'main.js'), 'console.log("game")')
    writeFileSync(join(BUILD_DIR, 'assets', 'sprite.png'), Buffer.alloc(200))
  })

  afterAll(() => {
    for (const dir of [BUILD_DIR, OUT_DIR]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  })

  async function packHtml(networkId: string): Promise<string> {
    rmSync(OUT_DIR, { recursive: true, force: true })
    const result = await packageForNetworks({
      buildDir: BUILD_DIR,
      outputDir: OUT_DIR,
      networks: [networkId],
      config: { orientation: 'portrait' },
    })
    return readFileSync(result.results[0].outputPath, 'utf-8')
  }

  it('moloco build ships zero mraid.js occurrences', async () => {
    expect(await packHtml('moloco')).not.toContain('mraid.js')
  }, 60000)

  it('facebook build ships zero mraid.js occurrences', async () => {
    expect(await packHtml('facebook')).not.toContain('mraid.js')
  }, 60000)

  it('applovin build still ships the MRAID script tag', async () => {
    expect(await packHtml('applovin')).toContain('mraid.js')
  }, 60000)

  // Proves the guard is wired, not just declared: a moloco build whose plaintext
  // HTML carries the token (here via customInjectBody — same shape as the loader
  // regression that reached production: one comment + one dead conditional) must
  // fail the network instead of writing a file the validator would reject.
  it('fails the network instead of shipping a build that carries the token', async () => {
    rmSync(OUT_DIR, { recursive: true, force: true })
    const errors: string[] = []
    const result = await packageForNetworks({
      buildDir: BUILD_DIR,
      outputDir: OUT_DIR,
      networks: ['moloco'],
      config: {
        orientation: 'portrait',
        customInjectBody:
          "// mraid.js is provided by the ad SDK\nif (0) { load('mraid.js'); }",
      },
      onProgress: (_id, status, message) => {
        if (status === 'error' && message) errors.push(message)
      },
    })

    expect(result.results[0].outputPath).toBe('')
    expect(errors.join('\n')).toContain('mraid.js')
  }, 60000)
})
