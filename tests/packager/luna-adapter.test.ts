import { describe, it, expect, vi } from 'vitest'
import vm from 'node:vm'
import { LunaAdapter } from '../../src/packager/network-adapters/luna'
import { lunaBridge } from '../../src/packager/network-adapters/base'
import { HtmlBuilder } from '../../src/packager/html-builder'
import { getNetwork } from '../../src/networks'

const cfg = {
  orientation: 'portrait' as const,
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.x',
  storeUrlIos: 'https://apps.apple.com/app/id1',
}
const adapter = () => new LunaAdapter('luna', getNetwork('luna')!)

describe('LunaAdapter', () => {
  it('gates boot on startGame and self-starts without a Luna host', () => {
    const b = new HtmlBuilder('<html><head></head><body></body></html>')
    adapter().transform(b, cfg)
    const html = b.toHtml()
    expect(html).toContain('window.__plbx_pre_boot = function')
    expect(html).toContain('window.startGame = function')
    expect(html).toContain('if (!window.Luna)')
  })

  it('routes every CTA path through InstallFullGame', () => {
    const b = new HtmlBuilder('<html><head></head><body></body></html>')
    adapter().transform(b, cfg)
    const html = b.toHtml()
    expect(html).toContain('Luna.Unity.Playable.InstallFullGame()')
    // Both dispatcher paths alias the same guarded call — see lunaBridge.
    expect(html).toContain('window.plbx_html.download = _plbx_luna_install')
    expect(html).toContain('window.install = _plbx_luna_install')
    expect(html).toContain('Luna.Unity.LifeCycle.GameEnded()')
  })

  it('honours container lifecycle events', () => {
    const b = new HtmlBuilder('<html><head></head><body></body></html>')
    adapter().transform(b, cfg)
    const html = b.toHtml()
    for (const e of ['luna:pause', 'luna:resume', 'luna:mute', 'luna:unmute'])
      expect(html).toContain(e)
  })

  it('never injects mraid', () => {
    const b = new HtmlBuilder('<html><head></head><body></body></html>')
    adapter().transform(b, cfg)
    expect(b.toHtml()).not.toContain('mraid.js')
  })

  it('emits luna.json + playground.json with mapped store urls and orientation', () => {
    const files = adapter().getZipExtraFiles(cfg)
    expect(files.map((f) => f.zipPath).sort()).toEqual([
      'luna.json',
      'playground.json',
    ])
    const luna = JSON.parse(files.find((f) => f.zipPath === 'luna.json')!.content)
    expect(luna.unity.packages.default.androidLink).toBe(cfg.storeUrlAndroid)
    expect(luna.unity.packages.default.iosLink).toBe(cfg.storeUrlIos)
    expect(luna.unity.packages.default.orientation).toBe('portrait')
    expect(luna.unity.packages.tiktok.orientation).toBe(1)
    const pg = JSON.parse(
      files.find((f) => f.zipPath === 'playground.json')!.content,
    )
    expect(pg).toEqual({ title: expect.any(String), icon: null, fields: {} })
  })

  it('queues analytics until window.pi exists', () => {
    const b = new HtmlBuilder('<html><head></head><body></body></html>')
    adapter().transform(b, cfg)
    const html = b.toHtml()
    expect(html).toContain('log_event')
    expect(html).toContain('logCustomEvent')
  })
})

/**
 * Behavioural tests for the injected bridge.
 *
 * The string assertions above prove the code is PRESENT; these prove it WORKS.
 * Every finding below was type-clean and grep-visible and still dead at runtime,
 * which is exactly what a containment test cannot see.
 *
 * The bridge is executed in a node:vm context whose global object IS `window`
 * (as in a browser), because the bridge reads bare globals — `Luna`,
 * `document`, `setTimeout` — as often as it reads `window.*`. Timers are
 * collected instead of scheduled so an unbounded poll shows up as a number
 * rather than as a hung test run.
 */
function runBridge(
  opts: { luna?: any; audioContext?: any; media?: any[] } = {},
): {
  win: any
  fire: (type: string) => void
  tick: (max?: number) => number
  pending: () => number
  warns: string[]
  errors: string[]
  origOpen: ReturnType<typeof vi.fn>
} {
  const listeners: Record<string, Array<() => void>> = {}
  const timers: Array<() => void> = []
  const warns: string[] = []
  const errors: string[] = []
  const origOpen = vi.fn(() => 'real-window')
  const media = opts.media ?? []

  const win: any = {
    open: origOpen,
    addEventListener(type: string, fn: () => void) {
      ;(listeners[type] ||= []).push(fn)
    },
    document: { querySelectorAll: () => media },
    console: {
      warn: (...a: any[]) => warns.push(a.join(' ')),
      error: (...a: any[]) => errors.push(a.join(' ')),
      log: () => {},
    },
    setTimeout: (fn: () => void) => timers.push(fn),
  }
  if (opts.luna) win.Luna = opts.luna
  if (opts.audioContext) win.AudioContext = opts.audioContext
  win.window = win
  win.globalThis = win
  vm.createContext(win)
  vm.runInContext(lunaBridge(), win)

  return {
    win,
    fire: (type) => (listeners[type] || []).forEach((fn) => fn()),
    pending: () => timers.length,
    tick: (max = 1000) => {
      let n = 0
      while (timers.length && n < max) {
        timers.shift()!()
        n++
      }
      return n
    },
    warns,
    errors,
    origOpen,
  }
}

describe('lunaBridge boot gate', () => {
  it('defines startGame synchronously, before the loader is up', () => {
    // The regression: startGame used to live INSIDE __plbx_pre_boot, which the
    // runtime loader calls only after the base64/JSZip unpack. On a packaged
    // 3.5 MB artifact that is ~90 ms after the load event — and Luna calls
    // startGame() at load, hitting "startGame is not a function".
    const env = runBridge({ luna: {} })
    expect(typeof env.win.startGame).toBe('function')
  })

  it('boots when the host calls startGame before the loader arrives', () => {
    const env = runBridge({ luna: {} })
    const go = vi.fn()
    env.win.startGame()
    expect(go).not.toHaveBeenCalled()
    env.win.__plbx_pre_boot(go)
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('boots when the loader arrives first and startGame comes after', () => {
    const env = runBridge({ luna: {} })
    const go = vi.fn()
    env.win.__plbx_pre_boot(go)
    // A Luna host is present, so the creative must NOT self-start.
    expect(go).not.toHaveBeenCalled()
    env.win.startGame()
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('boots exactly once however often startGame is called', () => {
    for (const loaderFirst of [true, false]) {
      const env = runBridge({ luna: {} })
      const go = vi.fn()
      if (loaderFirst) env.win.__plbx_pre_boot(go)
      env.win.startGame()
      env.win.startGame()
      if (!loaderFirst) env.win.__plbx_pre_boot(go)
      env.win.startGame()
      expect(go).toHaveBeenCalledTimes(1)
    }
  })

  it('self-starts when there is no Luna host', () => {
    const env = runBridge()
    const go = vi.fn()
    env.win.__plbx_pre_boot(go)
    expect(go).toHaveBeenCalledTimes(1)
  })
})

describe('lunaBridge CTA', () => {
  const lunaWith = (install: any) => ({
    Unity: { Playable: { InstallFullGame: install }, LifeCycle: { GameEnded() {} } },
  })

  it('routes a bare window.open through InstallFullGame', () => {
    // Game CTA dispatchers that call window.open(link) themselves never reach
    // plbx_html.download — under Luna that click raised no Ad Click at all, for
    // every network Luna re-exports to.
    const install = vi.fn()
    const env = runBridge({ luna: lunaWith(install) })
    const ret = env.win.open('https://play.google.com/store/apps/details?id=com.x')
    expect(install).toHaveBeenCalledTimes(1)
    expect(env.origOpen).not.toHaveBeenCalled()
    expect(ret).toBeNull()
  })

  it('falls back to the real window.open with no Luna host', () => {
    const env = runBridge()
    expect(env.win.open('https://example.com')).toBe('real-window')
    expect(env.origOpen).toHaveBeenCalledTimes(1)
  })

  it('routes plbx_html.download and window.install through InstallFullGame', () => {
    const install = vi.fn()
    const env = runBridge({ luna: lunaWith(install) })
    env.win.plbx_html.download()
    env.win.install()
    env.win.super_html.download()
    expect(install).toHaveBeenCalledTimes(3)
  })
})

describe('lunaBridge audio', () => {
  class FakeAudioContext {
    suspended = 0
    resumed = 0
    constructor(public opts?: any) {}
    suspend() {
      this.suspended++
    }
    resume() {
      this.resumed++
    }
  }

  it('suspends the AudioContexts the engine created on luna:mute', () => {
    // Cocos 3.8 has no cc.audioEngine (2.x API) — it plays through Web Audio.
    // Muting only via audioEngine was a silent no-op and the ad kept playing
    // sound after Luna muted it.
    const env = runBridge({ audioContext: FakeAudioContext })
    const a = new env.win.AudioContext()
    const b = new env.win.AudioContext({ latencyHint: 'interactive' })
    env.fire('luna:mute')
    expect([a.suspended, b.suspended]).toEqual([1, 1])
    env.fire('luna:unmute')
    expect([a.resumed, b.resumed]).toEqual([1, 1])
    // Constructor options must survive the patch — Cocos passes latencyHint.
    expect(b.opts).toEqual({ latencyHint: 'interactive' })
    expect(a instanceof FakeAudioContext).toBe(true)
  })

  it('keeps the 2.x cc.audioEngine and <audio>/<video> paths', () => {
    const pauseAll = vi.fn()
    const resumeAll = vi.fn()
    const media = [{ muted: false }, { muted: false }]
    const env = runBridge({ media })
    env.win.cc = { audioEngine: { pauseAll, resumeAll } }
    env.fire('luna:mute')
    expect(pauseAll).toHaveBeenCalledTimes(1)
    expect(media.map((m) => m.muted)).toEqual([true, true])
    env.fire('luna:unmute')
    expect(resumeAll).toHaveBeenCalledTimes(1)
    expect(media.map((m) => m.muted)).toEqual([false, false])
  })

  it('keeps muting the other paths when one of them throws', () => {
    // Each path is guarded on its own: a 2.x shim that throws must not cost us
    // the Web Audio suspend that actually silences a 3.x build.
    const media = [{ muted: false }]
    const env = runBridge({ audioContext: FakeAudioContext, media })
    const ctx = new env.win.AudioContext()
    env.win.cc = {
      audioEngine: {
        pauseAll() {
          throw new Error('2.x shim exploded')
        },
      },
    }
    expect(() => env.fire('luna:mute')).not.toThrow()
    expect(ctx.suspended).toBe(1)
    expect(media[0].muted).toBe(true)
  })

  it('does not throw on a build that exposes no audio at all', () => {
    const env = runBridge()
    expect(() => env.fire('luna:mute')).not.toThrow()
    expect(() => env.fire('luna:unmute')).not.toThrow()
  })

  /**
   * A context that behaves like the real one AND like the engine driving it.
   *
   * Cocos 3.8 (cc.js, AudioContextAgent.runContext) is the reason this exists:
   *
   *   runContext = function () { ... if ("suspended" === i.state)
   *                                     i.resume().catch(...) ... }
   *
   * and it is called from AudioPlayerWeb.doPlay() and AudioPlayerWebOneShot
   * .play() — i.e. on EVERY playback attempt. A plain suspend() therefore
   * survives exactly until the game plays its next sound.
   */
  class EngineAudioContext {
    state: 'running' | 'suspended' | 'closed' = 'running'
    constructor(public opts?: any) {}
    suspend() {
      // The real one rejects/throws on a closed context.
      if (this.state === 'closed') throw new Error('InvalidStateError')
      this.state = 'suspended'
      return Promise.resolve()
    }
    resume() {
      if (this.state === 'closed') throw new Error('InvalidStateError')
      this.state = 'running'
      return Promise.resolve()
    }
    /** What cc.js does on every doPlay()/one-shot play. */
    enginePlay() {
      if (this.state === 'suspended') (this as any).resume().catch(() => {})
    }
  }

  it('keeps the engine from resuming a context Luna muted', () => {
    // The regression: mute suspended the context, the game played one more
    // sound, cc.js runContext() resumed it — and the ad was audible again
    // while the container still believed it was muted.
    const env = runBridge({ audioContext: EngineAudioContext })
    const ctx = new env.win.AudioContext()
    env.fire('luna:mute')
    expect(ctx.state).toBe('suspended')
    ctx.enginePlay()
    ctx.enginePlay()
    expect(ctx.state).toBe('suspended')
    // Only the container may bring audio back.
    env.fire('luna:unmute')
    expect(ctx.state).toBe('running')
  })

  it('births a context created after the mute already neutralised', () => {
    // Cocos builds its AudioContext lazily on the first sound, which can land
    // after Luna muted us — that first sound used to escape.
    const env = runBridge({ audioContext: EngineAudioContext })
    env.fire('luna:mute')
    const late = new env.win.AudioContext()
    expect(late.state).toBe('suspended')
    late.enginePlay()
    expect(late.state).toBe('suspended')
    env.fire('luna:unmute')
    expect(late.state).toBe('running')
  })

  it('cycles mute/unmute without stacking or leaking the original resume', () => {
    // Stashing our own no-op as "the original" on the second mute would make
    // the unmute restore a no-op — audio dead for the rest of the ad.
    const env = runBridge({ audioContext: EngineAudioContext })
    const ctx = new env.win.AudioContext()
    const orig = EngineAudioContext.prototype.resume
    for (let i = 0; i < 3; i++) {
      env.fire('luna:mute')
      ctx.enginePlay()
      expect(ctx.state).toBe('suspended')
      env.fire('luna:unmute')
      expect(ctx.resume).toBe(orig)
      expect(ctx.state).toBe('running')
      // With the real resume back, the engine is free to drive it again.
      ctx.suspend()
      ctx.enginePlay()
      expect(ctx.state).toBe('running')
    }
  })

  it('does not throw on a closed context and still mutes the live ones', () => {
    const env = runBridge({ audioContext: EngineAudioContext })
    const dead = new env.win.AudioContext()
    const live = new env.win.AudioContext()
    dead.state = 'closed'
    expect(() => env.fire('luna:mute')).not.toThrow()
    expect(live.state).toBe('suspended')
    live.enginePlay()
    expect(live.state).toBe('suspended')
    expect(() => env.fire('luna:unmute')).not.toThrow()
    expect(live.state).toBe('running')
  })
})

describe('lunaBridge analytics queue', () => {
  it('drains the backlog before the fresh event so Luna sees them in order', () => {
    const env = runBridge()
    env.win.plbx_html.log_event('a')
    env.win.plbx_html.log_event('b')
    const got: Array<[string, number]> = []
    env.win.pi = { logCustomEvent: (n: string, v: number) => got.push([n, v]) }
    env.win.plbx_html.log_event('c')
    expect(got.map((g) => g[0])).toEqual(['a', 'b', 'c'])
    env.tick()
    expect(got.map((g) => g[0])).toEqual(['a', 'b', 'c'])
    // Luna silently drops a string-named event with no integer parameter.
    expect(got.every((g) => g[1] === 1)).toBe(true)
  })

  it('queues up to the per-session cap and counts what it drops', () => {
    const env = runBridge()
    for (let i = 0; i < 300; i++) env.win.plbx_html.log_event('e' + i)
    // 256 is Luna's per-SESSION cap; 32 (the per-NAME cap) used to size the
    // whole queue and threw away events a conforming playable may send.
    expect(env.win.plbx_html.luna_dropped_events).toBe(300 - 256)
    expect(env.warns.filter((w) => w.includes('queue full')).length).toBe(1)
    const got: string[] = []
    env.win.pi = { logCustomEvent: (n: string) => got.push(n) }
    env.tick()
    expect(got.length).toBe(256)
    expect(got[0]).toBe('e0')
  })

  it('stops polling for window.pi instead of re-arming forever', () => {
    // Without a bound this left a 10 Hz timer running for the whole life of the
    // ad on any host that never injects window.pi (local dev, our preview).
    const env = runBridge()
    expect(env.tick(1000)).toBe(50)
    expect(env.pending()).toBe(0)
  })

  it('still delivers the backlog if window.pi appears after the poll gave up', () => {
    const env = runBridge()
    env.win.plbx_html.log_event('early')
    env.tick()
    expect(env.pending()).toBe(0)
    const got: string[] = []
    env.win.pi = { logCustomEvent: (n: string) => got.push(n) }
    env.win.plbx_html.log_event('late')
    expect(got).toEqual(['early', 'late'])
  })

  it('never throws when Luna own logCustomEvent does', () => {
    const env = runBridge()
    env.win.pi = {
      logCustomEvent() {
        throw new Error('pi exploded')
      },
    }
    expect(() => env.win.plbx_html.log_event('boom')).not.toThrow()
  })
})
