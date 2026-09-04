import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src/cli'

const BUILD = join(__dirname, 'fixtures/single-file-build')
const OUT = join(__dirname, 'fixtures/cli-out')

afterAll(() => { if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true }) })

describe('playable-kit package', () => {
  it('packages the named networks and prints one row each', async () => {
    const lines: string[] = []
    const code = await main(
      ['package', '--build', BUILD, '--out', OUT, '--networks', 'applovin,mintegral', '--name', 'My Game'],
      (l) => lines.push(l),
    )
    expect(code).toBe(0)
    expect(readdirSync(join(OUT, 'applovin'))).toEqual(['My_Game_applovin.html'])
    expect(readdirSync(join(OUT, 'mintegral'))).toEqual(['My_Game_mintegral.zip'])
    const table = lines.join('\n')
    expect(table).toMatch(/applovin\s+\d+\.\d\d MB\s+5\.24 MB\s+My_Game_applovin\.html/)
    expect(table).toMatch(/mintegral\s+\d+\.\d\d MB\s+5\.24 MB\s+My_Game_mintegral\.zip\s+\(My_Game_mintegral\.html\)/)
  })

  it('--networks all covers the registry', async () => {
    const lines: string[] = []
    const code = await main(['package', '--build', BUILD, '--out', OUT, '--networks', 'all', '--name', 'My Game'], (l) => lines.push(l))
    expect(code).toBe(0)
    expect(lines.filter((l) => /\d\.\d\d MB/.test(l)).length).toBeGreaterThanOrEqual(25)
  }, 120_000)

  it('unknown network → exit 1 with the list', async () => {
    const lines: string[] = []
    const code = await main(['package', '--build', BUILD, '--out', OUT, '--networks', 'nope'], (l) => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/Unknown network "nope"\. One of: .*applovin/)
  })

  it('--splash produces an artifact with the splash markup, default does not', async () => {
    const withSplash = join(OUT, 'with-splash')
    const withoutSplash = join(OUT, 'without-splash')
    const codeOn = await main(
      ['package', '--build', BUILD, '--out', withSplash, '--networks', 'applovin', '--name', 'My Game', '--splash'],
      () => {},
    )
    expect(codeOn).toBe(0)
    const htmlOn = readFileSync(join(withSplash, 'applovin', 'My_Game_applovin.html'), 'utf-8')
    expect(htmlOn).toContain('id="s"')

    const codeOff = await main(
      ['package', '--build', BUILD, '--out', withoutSplash, '--networks', 'applovin', '--name', 'My Game'],
      () => {},
    )
    expect(codeOff).toBe(0)
    const htmlOff = readFileSync(join(withoutSplash, 'applovin', 'My_Game_applovin.html'), 'utf-8')
    expect(htmlOff).not.toContain('id="s"')
  })

  it('no subcommand → usage, exit 1', async () => {
    const lines: string[] = []
    expect(await main([], (l) => lines.push(l))).toBe(1)
    expect(lines.join('\n')).toContain('playable-kit package')
  })
})
