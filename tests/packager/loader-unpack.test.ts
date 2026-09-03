import { describe, it, expect } from 'vitest'
import { emitUnpack } from '../../src/packager/loader/unpack'
import { emitLifecycle } from '../../src/packager/loader/lifecycle'

describe('unpack + lifecycle', () => {
  it('unpack populates __plbx_res and calls plbx_boot', () => {
    const js = emitUnpack({})
    expect(js).toContain('window.__plbx_res')
    expect(js).toContain('window.__plbx_js')
    expect(js).toContain('plbx_boot(')
    expect(js).toContain('loadAsync')
    expect(js).toContain('delete window.__plbx_zip')
  })

  it('per-file extraction has its own catch so one bad entry cannot strand boot (#5)', () => {
    // Regression: without a per-file .catch, a single rejected z.file().async()
    // leaves `pending` > 0 forever → plbx_boot() never fires → blank screen.
    const js = emitUnpack({})
    // Shared decrement+boot helper used on BOTH success and failure.
    expect(js).toContain('function _done()')
    // A per-file failure handler exists (not just the outer loadAsync catch).
    expect(js.match(/\.catch\(function/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2,
    )
  })

  it('lifecycle defines plbx_boot + plbx_boot_engine + gameReady + defer-boot gate', () => {
    const js = emitLifecycle({})
    expect(js).toContain('function plbx_boot(')
    expect(js).toContain('function plbx_boot_engine(')
    expect(js).toContain('window.gameReady')
    expect(js).toContain('__plbx_pre_boot')
    expect(js).toContain('window.__plbx_pre_boot(doBoot)')
  })

  // window.__plbx_gr is shared with plbx_html.game_ready (base.ts network
  // adapters) so a Cocos build fires gameReady exactly once whichever caller
  // — this loader's own poll, or the bridge's — gets there first. Isolate
  // just the signal() IIFE (the rest of plbx_boot calls helpers this file
  // does not define, e.g. _installPlbxUrlShim) and run it for real against a
  // fake window.
  it("gameReady signal is a no-op when window.__plbx_gr is already set (shared with plbx_html.game_ready)", () => {
    const js = emitLifecycle({})
    const signalCode = js.match(/\(function signal\(\) \{[\s\S]*?\}\)\(\);/)?.[0]
    expect(signalCode).toBeDefined()

    let calls = 0
    const win: Record<string, unknown> = {
      __plbx_gr: true,
      gameReady: () => { calls++ },
    }
    new Function('window', 'setTimeout', signalCode!)(win, () => 0)
    expect(calls).toBe(0)
  })

  it('gameReady signal calls window.gameReady and sets the shared flag when not already set', () => {
    const js = emitLifecycle({})
    const signalCode = js.match(/\(function signal\(\) \{[\s\S]*?\}\)\(\);/)?.[0]
    expect(signalCode).toBeDefined()

    let calls = 0
    const win: Record<string, unknown> = { gameReady: () => { calls++ } }
    new Function('window', 'setTimeout', signalCode!)(win, () => 0)
    expect(calls).toBe(1)
    expect(win.__plbx_gr).toBe(true)
  })
})
