import vm from 'node:vm'
import { describe, it, expect, vi } from 'vitest'
import { generatePreviewUtil } from '../../src/preview/sdk-mocks'

describe('generatePreviewUtil', () => {
  it('should return a string with report function', () => {
    const code = generatePreviewUtil({
      networkId: 'applovin',
      mraid: true,
      maxSize: 5 * 1024 * 1024,
    })
    expect(code).toContain('function report(')
    expect(code).toContain('parent.postMessage')
    expect(code).toContain('plbx:preview')
  })

  it('should include error tracking (onerror + unhandledrejection)', () => {
    const code = generatePreviewUtil({
      networkId: 'applovin',
      mraid: true,
      maxSize: 5242880,
    })
    expect(code).toContain('window.onerror')
    expect(code).toContain('unhandledrejection')
  })

  it('should wrap fetch and XMLHttpRequest for network tracking', () => {
    const code = generatePreviewUtil({
      networkId: 'applovin',
      mraid: true,
      maxSize: 5242880,
    })
    expect(code).toContain('XMLHttpRequest')
    expect(code).toContain('fetch')
  })

  it('should mock MRAID for mraid networks', () => {
    const code = generatePreviewUtil({
      networkId: 'applovin',
      mraid: true,
      maxSize: 5242880,
    })
    expect(code).toContain('window.mraid')
    expect(code).toContain("report('cta'")
  })

  it('should mock window.install for mintegral', () => {
    const code = generatePreviewUtil({
      networkId: 'mintegral',
      mraid: false,
      maxSize: 5242880,
    })
    expect(code).toContain('window.install')
    expect(code).not.toContain('window.mraid')
  })

  it('should mock ExitApi for google', () => {
    const code = generatePreviewUtil({
      networkId: 'google',
      mraid: false,
      maxSize: 5242880,
    })
    expect(code).toContain('ExitApi')
  })

  it('should mock FbPlayableAd for facebook', () => {
    const code = generatePreviewUtil({
      networkId: 'facebook',
      mraid: false,
      maxSize: 5242880,
    })
    expect(code).toContain('FbPlayableAd')
  })

  it('should map postMessage("download"/"complete") to vungle CTA/game_end (not window.open)', () => {
    // Vungle is postMessage-driven, not SDK-global-driven. The packager bridge
    // must emit exactly these two strings (see network-adapters/base.ts
    // vungleBridge) and this mock must recognize them the same way the real
    // Vungle container does, or the local validator lies about CTA/game_end.
    const code = generatePreviewUtil({
      networkId: 'vungle',
      mraid: false,
      maxSize: 5242880,
    })
    expect(code).toContain("'download'")
    expect(code).toContain('vungle_download')
    expect(code).toContain("report('cta'")
    expect(code).toContain("'complete'")
    expect(code).toContain('vungle_complete')
    expect(code).toContain("report('game_end'")
    expect(code).toContain('var _plbxExpectedCta = "vungle_download"')
  })

  describe('mraidMode (adversarial boot harness)', () => {
    const gen = (mraidMode?: string) =>
      generatePreviewUtil({
        networkId: 'applovin',
        mraid: true,
        maxSize: 5242880,
        mraidMode,
      })

    it('happy (default) auto-fires viewableChange(true) on ready', () => {
      const code = gen()
      expect(code).toContain("_fire('viewableChange', true)")
      expect(code).toContain('var _viewable = true')
    })

    it('neverViewable starts not-viewable and never auto-fires viewableChange(true)', () => {
      const code = gen('neverViewable')
      expect(code).toContain('var _viewable = false')
      expect(code).not.toContain("_fire('viewableChange', true)")
    })

    it('lostPulse fires a viewableChange(true) pulse but keeps isViewable() false at gate time', () => {
      const code = gen('lostPulse')
      expect(code).toContain('_PLBX_LOST_PULSE')
      expect(code).toContain('var _viewable = false')
    })

    it('falls back to happy behavior for an unknown mode', () => {
      const code = gen('bogusMode')
      expect(code).toContain("_fire('viewableChange', true)")
    })
  })

  it('tags CTA reports with the expected SDK method per network (no false window.open pass)', () => {
    // The validator must track the network's REAL CTA method, not a bare
    // window.open() — otherwise it shows a false success.
    const applovin = generatePreviewUtil({
      networkId: 'applovin',
      mraid: true,
      maxSize: 5242880,
    })
    expect(applovin).toContain('var _plbxExpectedCta = "mraid.open"')
    expect(applovin).toContain(
      'data.correct = data.method === _plbxExpectedCta',
    )

    expect(
      generatePreviewUtil({ networkId: 'facebook', mraid: false, maxSize: 1 }),
    ).toContain('var _plbxExpectedCta = "fbplayable"')
    expect(
      generatePreviewUtil({ networkId: 'google', mraid: false, maxSize: 1 }),
    ).toContain('var _plbxExpectedCta = "exitapi"')
    expect(
      generatePreviewUtil({ networkId: 'mintegral', mraid: false, maxSize: 1 }),
    ).toContain('var _plbxExpectedCta = "install"')
    expect(
      generatePreviewUtil({ networkId: 'tiktok', mraid: false, maxSize: 1 }),
    ).toContain('var _plbxExpectedCta = "playable_sdk"')
    // window.open is the correct CTA only for non-SDK (generic) builds.
    expect(
      generatePreviewUtil({ networkId: 'preview', mraid: false, maxSize: 1 }),
    ).toContain('var _plbxExpectedCta = "window.open"')
  })

  it('should define lifecycle trackers (gameReady, gameStart, gameClose)', () => {
    const code = generatePreviewUtil({
      networkId: 'applovin',
      mraid: true,
      maxSize: 5242880,
    })
    expect(code).toContain('gameReady')
    expect(code).toContain('gameStart')
    expect(code).toContain('gameClose')
    expect(code).toContain("report('game_ready'")
    expect(code).toContain("callCreativeHook('gameStart', 'game_start')")
  })

  // gameStart/gameClose are defined by the CREATIVE and called by the container
  // (PlayTurbo §5, §7). The mock is the container. Assigning them here overwrote
  // the creative's hooks: depending on injection order either the checklist went
  // green off the mock's own report while the creative's start/close logic never
  // ran, or the creative's assignment silenced the report and a correct build
  // showed red. The mock must look them up at call time instead.
  it('calls the creative gameStart/gameClose hooks instead of replacing them', () => {
    const code = generatePreviewUtil({
      networkId: 'mintegral',
      mraid: false,
      maxSize: 5 * 1024 * 1024,
    })
    expect(code).not.toMatch(/window\.gameStart\s*=/)
    expect(code).not.toMatch(/window\.gameClose\s*=/)
    expect(code).toContain("callCreativeHook('gameStart', 'game_start')")
    expect(code).toContain("callCreativeHook('gameClose', 'game_close')")
    // ...and it looks the function up when it fires, not when it is installed.
    expect(code).toContain('var fn = window[name]')
  })

  // gameReady and gameEnd run the other way — the creative calls them, so the
  // mock owns those globals and must keep assigning them.
  it('still owns the container-side globals (gameReady, gameEnd)', () => {
    const code = generatePreviewUtil({
      networkId: 'mintegral',
      mraid: false,
      maxSize: 5 * 1024 * 1024,
    })
    expect(code).toMatch(/window\.gameReady\s*=/)
    expect(code).toMatch(/window\.gameEnd\s*=/)
  })

  it('should mock dapi SDK for MRAID networks (ironSource)', () => {
    const code = generatePreviewUtil({
      networkId: 'ironsource',
      mraid: true,
      maxSize: 5242880,
    })
    expect(code).toContain('window.dapi')
    expect(code).toContain('getAudioVolume')
    expect(code).toContain('openStoreUrl')
    expect(code).toContain('isViewable')
    expect(code).toContain('isDemoDapi')
    expect(code).toContain('audioVolumeChange')
    expect(code).toContain('playable-audio-mute')
  })

  it('should not include dapi for non-MRAID networks', () => {
    const code = generatePreviewUtil({
      networkId: 'mintegral',
      mraid: false,
      maxSize: 5242880,
    })
    expect(code).not.toContain('window.dapi')
    expect(code).not.toContain('getAudioVolume')
  })

  it('should wrap window.open as generic CTA fallback', () => {
    const code = generatePreviewUtil({
      networkId: 'kwai',
      mraid: false,
      maxSize: 5242880,
    })
    expect(code).toContain('window.open')
    expect(code).toContain("report('cta'")
  })

  // Tencent 优量汇: the click is tracked only through _gdtUnSdk.playAble.onClick().
  // A bare window.open() must read as an incorrect CTA, and the mock must wrap
  // the real GDTUnSdk constructor rather than replace it.
  it('wraps GDTUnSdk for gdt and expects gdt_onclick as the CTA', () => {
    const code = generatePreviewUtil({
      networkId: 'gdt',
      mraid: false,
      maxSize: 3 * 1024 * 1024,
    })
    expect(code).toContain('var _plbxExpectedCta = "gdt_onclick"')
    expect(code).toContain("Object.defineProperty(window, 'GDTUnSdk'")
    expect(code).toContain("report('cta', { method: 'gdt_onclick' })")
    expect(code).toContain('pa.onClick = wrapped')
  })
})

// A game calling the global window.gameEnd() used to turn Vungle's game_end check green
// while nothing was ever posted to the container: the global reported game_end directly,
// and only plbx_html.game_end() posts 'complete'. The preview must exercise the same path
// production does, or it is a false green.
describe('Vungle game_end goes through the bridge, not straight to the report', () => {
  it('routes window.gameEnd() into plbx_html.game_end()', () => {
    const code = generatePreviewUtil({
      networkId: 'vungle',
      mraid: false,
      maxSize: 5 * 1024 * 1024,
    })
    expect(code).toContain('window.plbx_html.game_end()')
    // The 'complete' postMessage is what the mock turns back into a game_end report.
    expect(code).toContain(`if (msg === 'complete')`)
    expect(code).toContain('vungle_complete')
  })

  it('warns instead of silently passing when the bridge is missing', () => {
    const code = generatePreviewUtil({
      networkId: 'vungle',
      mraid: false,
      maxSize: 5 * 1024 * 1024,
    })
    expect(code).toContain('Vungle would never receive complete')
  })

  it('leaves other networks reporting game_end directly', () => {
    const code = generatePreviewUtil({
      networkId: 'mintegral',
      mraid: false,
      maxSize: 5 * 1024 * 1024,
    })
    expect(code).toContain(`report('game_end', {}); `)
    expect(code).not.toContain('plbx_html bridge missing')
  })
})

// Luna injects its SDK (window.Luna + window.pi) and its standard events only at
// EXPORT time, so a local preview sees neither. The mock stands in for both: it
// owns the boot (it calls startGame(), the creative must not self-start), turns
// every logCustomEvent into a counted report, and simulates the standard events
// at the moments Luna would fire them — that is the only place the caps and the
// ad-click path can be inspected before upload.
describe('Luna / Unity Playworks mock', () => {
  const luna = () =>
    generatePreviewUtil({ networkId: 'luna', mraid: false, maxSize: 5 * 1024 * 1024 })

  it('installs the SDK globals and reports events', () => {
    const code = luna()
    expect(code).toContain('window.Luna')
    expect(code).toContain('InstallFullGame')
    expect(code).toContain('GameEnded')
    expect(code).toContain('window.pi')
    expect(code).toContain('logCustomEvent')
    expect(code).toContain("report('luna_event'")
    expect(code).toContain("d.type !== 'plbx:luna'")
    expect(code).toContain('window.startGame')
  })

  it('carries the numbers the caps verdicts are computed from', () => {
    const code = luna()
    expect(code).toContain('count:')
    expect(code).toContain('total:')
    expect(code).toContain('beforeStart:')
    expect(code).toContain('valueOk:')
  })

  it('simulates the standard events Luna would inject at export', () => {
    const code = luna()
    for (const e of [
      'adLoading',
      'adReady',
      'adStarting',
      'adImpression',
      'adEngagement',
      'adClick',
    ]) {
      expect(code).toContain(e)
    }
  })

  it('fails loudly when the creative never defined startGame()', () => {
    expect(luna()).toContain('startGame() was never defined')
  })

  it('reports the CTA as luna_install so a bare window.open is not a false green', () => {
    const code = luna()
    expect(code).toContain("method: 'luna_install'")
    expect(code).toContain('"luna_install"')
  })

  it('exposes Playground.get returning the caller default, like Luna\'s own archive', () => {
    expect(luna()).toContain('Playground')
  })

  // The block is one big template literal inside sdk-mocks.ts — a stray backtick
  // would ship a broken script into every luna preview and nothing else here
  // would notice.
  it('emits parseable JavaScript', () => {
    expect(() => new Function(luna())).not.toThrow()
  })

  it('stays out of other networks', () => {
    const code = generatePreviewUtil({
      networkId: 'mintegral',
      mraid: false,
      maxSize: 5 * 1024 * 1024,
    })
    expect(code).not.toContain('window.Luna')
    expect(code).not.toContain('luna_event')
  })
})

// ---------------------------------------------------------------------------
// The Luna boot handshake is behaviour, not a string — so run the generated
// mock for real, in a vm with a virtual clock, and drive the timeline.
//
// Harness scope: only the globals the generated util actually touches. Anything
// it guards for (fetch, AudioContext, an image `src` descriptor) is left absent
// on purpose, so the harness also proves those guards hold.
// ---------------------------------------------------------------------------
class VirtualClock {
  now = 0
  private nextId = 1
  private timers = new Map<number, { at: number; fn: () => void; every?: number }>()

  setTimeout = (fn: () => void, ms = 0) => {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + ms, fn })
    return id
  }
  setInterval = (fn: () => void, ms = 0) => {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + ms, fn, every: Math.max(ms, 1) })
    return id
  }
  clear = (id: number) => {
    this.timers.delete(id)
  }
  /** Run every callback due within `ms`, in time order, like a real event loop. */
  advance(ms: number) {
    const target = this.now + ms
    for (;;) {
      let dueId = -1
      let due: { at: number; fn: () => void; every?: number } | undefined
      for (const [id, t] of this.timers) {
        if (t.at <= target && (!due || t.at < due.at)) {
          dueId = id
          due = t
        }
      }
      if (!due) break
      this.now = due.at
      if (due.every) due.at = this.now + due.every
      else this.timers.delete(dueId)
      due.fn()
    }
    this.now = target
  }
}

interface LunaHarness {
  win: any
  clock: VirtualClock
  fire(type: string): void
  reports(event: string): any[]
  errors(): string[]
}

function runLunaMock(): LunaHarness {
  const clock = new VirtualClock()
  const posted: any[] = []
  type Listener = (evt: any) => void
  const listeners: Record<string, Listener[]> = {}

  const sandbox: any = {
    console,
    URL,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    requestAnimationFrame: (fn: () => void) => clock.setTimeout(fn, 16),
    performance: { now: () => clock.now },
    location: { hostname: 'localhost', href: 'http://localhost/' },
    parent: { postMessage: (msg: any) => posted.push(msg) },
    document: {
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    Event: class {
      type: string
      constructor(type: string) {
        this.type = type
      }
    },
    XMLHttpRequest: function () {} as any,
    HTMLImageElement: function () {} as any,
  }
  sandbox.XMLHttpRequest.prototype.open = function () {}
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.addEventListener = (type: string, fn: Listener) => {
    ;(listeners[type] ||= []).push(fn)
  }
  sandbox.removeEventListener = (type: string, fn: Listener) => {
    listeners[type] = (listeners[type] || []).filter((f) => f !== fn)
  }
  sandbox.dispatchEvent = (evt: any) => {
    for (const fn of [...(listeners[evt.type] || [])]) fn(evt)
    return true
  }

  vm.createContext(sandbox)
  vm.runInContext(
    generatePreviewUtil({ networkId: 'luna', mraid: false, maxSize: 5 * 1024 * 1024 }),
    sandbox,
  )

  const seen = () => posted.filter((m) => m && m.type === 'plbx:preview')
  return {
    win: sandbox,
    clock,
    fire: (type: string) => sandbox.dispatchEvent(new sandbox.Event(type)),
    reports: (event: string) => seen().filter((m) => m.event === event),
    errors: () => seen().filter((m) => m.event === 'error').map((m) => String(m.data.message)),
  }
}

describe('Luna mock boot handshake (runs the generated code)', () => {
  // REGRESSION: the mock used to probe window.startGame exactly once, 50ms
  // after 'load'. The packaged bridge defines startGame only after the loader
  // unpacks the inlined ZIP — always later than that — so the probe missed, the
  // mock declared the artifact broken, and because window.Luna is defined the
  // creative's self-start fallback is off: the preview sat on the splash
  // forever and start_game failed for a correct artifact.
  it('boots a creative that defines startGame long after load', () => {
    const h = runLunaMock()
    h.fire('load')

    h.clock.advance(3000) // the ZIP-unpack window: nothing defined yet
    expect(h.reports('luna_lifecycle')).toHaveLength(0)
    expect(h.errors()).toEqual([]) // must NOT have given up mid-unpack

    const started = vi.fn()
    h.win.startGame = started // __plbx_pre_boot finally ran
    h.clock.advance(200)

    expect(started).toHaveBeenCalledTimes(1)
    expect(h.reports('luna_lifecycle').map((m) => m.data.name)).toEqual(['startGame'])
    expect(h.errors()).toEqual([])
  })

  it('boots on the very first tick when startGame is already there', () => {
    const h = runLunaMock()
    const started = vi.fn()
    h.win.startGame = started
    h.fire('load')

    expect(started).toHaveBeenCalledTimes(1) // synchronous, no 50ms dead time
    expect(h.reports('luna_lifecycle')[0].data.source).toBe('host')
  })

  it('reports the failure only after the whole retry window elapsed, once', () => {
    const h = runLunaMock()
    h.fire('load')

    h.clock.advance(14_000)
    expect(h.errors()).toEqual([])

    h.clock.advance(2_000)
    const dead = h.errors().filter((m) => m.includes('startGame() was never defined'))
    expect(dead).toHaveLength(1)

    h.clock.advance(10_000) // and the poll really stopped — no error spam
    expect(h.errors().filter((m) => m.includes('startGame() was never defined'))).toHaveLength(1)
  })

  // REGRESSION: adEngagement was registered per event type inside a forEach, so
  // every type got its OWN `once` closure and could only unregister itself. A
  // single tap synthesises pointerdown + mousedown (plus touchstart on a touch
  // screen), so the mock reported adEngagement 2-3x. Luna's real Ad Engagement
  // fires once per session, and the panel validates first-interaction from that
  // very per-name count — an inflated count is a wrong verdict, not cosmetics.
  it('reports adEngagement once for a tap that synthesises three input events', () => {
    const h = runLunaMock()
    h.win.startGame = () => {}
    h.fire('load')

    // one tap, as a real device delivers it
    h.fire('pointerdown')
    h.fire('touchstart')
    h.fire('mousedown')

    const engagement = () =>
      h.reports('luna_event').filter((m) => m.data.name === 'adEngagement')
    expect(engagement()).toHaveLength(1)
    expect(engagement()[0].data.count).toBe(1)

    h.fire('pointerdown') // a later, separate tap must not re-fire it either
    expect(engagement()).toHaveLength(1)
  })

  it('does not start the game twice when the manual trigger follows the poll', () => {
    const h = runLunaMock()
    const started = vi.fn()
    h.win.startGame = started
    h.fire('load')
    expect(started).toHaveBeenCalledTimes(1)

    // the panel's plbx:luna start-game button, pressed after the auto boot
    h.win.dispatchEvent(
      Object.assign(new h.win.Event('message'), { data: { type: 'plbx:luna', action: 'start-game' } }),
    )
    expect(started).toHaveBeenCalledTimes(1)
    expect(h.reports('luna_lifecycle')).toHaveLength(1)
  })
})

// The six standard events are LUNA'S OWN — the mock only simulates them because
// Luna injects the real ones at export. Luna's 256-per-session budget is charged
// to the events the GAME authors, so counting the simulated ones inflated both
// the caps verdict and the panel's "N / 256 events this session" footer by up
// to six against what Luna will actually count.
describe('Luna session budget (runs the generated code)', () => {
  it('charges only custom events against the per-session total', () => {
    const h = runLunaMock()
    h.win.startGame = () => {}
    h.fire('load')
    h.fire('pointerdown') // adEngagement

    const standard = h.reports('luna_event').filter((m) => m.data.kind === 'standard')
    // adLoading + adReady + adStarting + adEngagement, all Luna's own
    expect(standard.length).toBeGreaterThanOrEqual(4)
    expect(standard.map((m) => m.data.total)).toEqual(standard.map(() => 0))

    h.win.pi.logCustomEvent('level_1', 1)
    h.win.pi.logCustomEvent('level_2', 1)
    h.win.pi.logCustomEvent('level_1', 2)

    const custom = h.reports('luna_event').filter((m) => m.data.kind === 'custom')
    expect(custom.map((m) => m.data.total)).toEqual([1, 2, 3])
    // per-name counts are untouched — standard events keep their own group/rows
    expect(custom[2].data.count).toBe(2)
    const loading = h.reports('luna_event').filter((m) => m.data.name === 'adLoading')
    expect(loading[0].data.count).toBe(1)
  })
})

// The mock and the static gate are two validators of the SAME rule, and they
// have to agree: the kit validator's isIntegerish rejects a non-integer literal,
// so a preview that green-lights pi.logCustomEvent('frac', 1.5) tells the author
// their creative is fine right up until packaging refuses it.
//
// Call shape: everything the mock can see has already passed window.pi, and the
// plbx_html.log_event bridge coerces there (`(value | 0)`, default 1) — so a
// value that reaches pi non-integer or missing came from a DIRECT
// pi.logCustomEvent call, which is exactly the shape Luna drops.
describe('Luna custom-event value check (runs the generated code)', () => {
  const valueOkFor = (fire: (pi: any) => void) => {
    const h = runLunaMock()
    h.win.startGame = () => {}
    h.fire('load')
    fire(h.win.pi)
    const custom = h.reports('luna_event').filter((m) => m.data.kind === 'custom')
    return custom[custom.length - 1].data.valueOk
  }

  it('accepts integer values, including zero and negatives', () => {
    expect(valueOkFor((pi) => pi.logCustomEvent('level_1', 1))).toBe(true)
    expect(valueOkFor((pi) => pi.logCustomEvent('level_1', 0))).toBe(true)
    expect(valueOkFor((pi) => pi.logCustomEvent('level_1', -2))).toBe(true)
  })

  it('rejects a fractional value, exactly as the static gate does', () => {
    expect(valueOkFor((pi) => pi.logCustomEvent('frac', 1.5))).toBe(false)
  })

  it('rejects NaN/Infinity and non-numbers', () => {
    expect(valueOkFor((pi) => pi.logCustomEvent('nan', NaN))).toBe(false)
    expect(valueOkFor((pi) => pi.logCustomEvent('inf', Infinity))).toBe(false)
    expect(valueOkFor((pi) => pi.logCustomEvent('str', '5'))).toBe(false)
  })

  it('rejects a value-less direct pi.logCustomEvent call', () => {
    // Not the bridge's problem: plbx_html.log_event defaults a missing value to
    // 1 before it ever reaches pi, so a value-less call HERE is a direct one.
    expect(valueOkFor((pi) => pi.logCustomEvent('no_value'))).toBe(false)
  })

  it("leaves Luna's own standard events unflagged", () => {
    const h = runLunaMock()
    h.win.startGame = () => {}
    h.fire('load')
    const standard = h.reports('luna_event').filter((m) => m.data.kind === 'standard')
    expect(standard.length).toBeGreaterThan(0)
    expect(standard.every((m) => m.data.valueOk)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The mock never sees window.plbx_html — it is defined later by a body
// <script> the packager's network adapter injects (buildPlbxBridge in
// network-adapters/base.ts). So the phase that wraps its members has to poll
// for the bridge instead of finding it at util-run time. This harness gives
// full manual control over the timer queue: setTimeout just pushes the
// callback, and tick() drains whatever is queued right now — mirroring "one
// poll tick" for real, not by faking time.
// ---------------------------------------------------------------------------
function runPlbxCallHarness(networkId = 'mintegral', mraid = false) {
  const pending: Array<() => void> = []
  const posted: any[] = []

  const sandbox: any = {
    console,
    URL,
    setTimeout: (fn: () => void) => {
      pending.push(fn)
      return pending.length
    },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    location: { hostname: 'localhost', href: 'http://localhost/' },
    parent: { postMessage: (msg: any) => posted.push(msg) },
    document: {
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    XMLHttpRequest: function () {} as any,
    HTMLImageElement: function () {} as any,
  }
  sandbox.XMLHttpRequest.prototype.open = function () {}
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.addEventListener = () => {}
  sandbox.removeEventListener = () => {}

  vm.createContext(sandbox)
  vm.runInContext(
    generatePreviewUtil({ networkId, mraid, maxSize: 5 * 1024 * 1024 }),
    sandbox,
  )

  const tick = () => {
    const due = pending.splice(0, pending.length)
    due.forEach((fn) => fn())
  }
  const seen = () => posted.filter((m) => m && m.type === 'plbx:preview')
  return {
    win: sandbox,
    tick,
    pendingCount: () => pending.length,
    reports: (event: string) => seen().filter((m) => m.event === event),
  }
}

describe('plbx_html call tracking', () => {
  it('reports nothing before the bridge exists', () => {
    const h = runPlbxCallHarness()
    h.tick()
    expect(h.reports('plbx_call')).toHaveLength(0)
  })

  it('wraps the bridge members on the first poll tick that sees them, and counts calls', () => {
    const h = runPlbxCallHarness()
    const tap = vi.fn()
    const gameReady = vi.fn()
    const download = vi.fn()
    const expose = vi.fn()
    h.win.plbx_html = { tap, game_ready: gameReady, download, expose }

    h.tick() // the poll callback queued at util-run time sees the bridge now

    expect(h.win.plbx_html.__plbx_preview_wrapped).toBe(true)

    let receiver: any
    h.win.plbx_html.tap.call((receiver = { self: true }))
    h.win.plbx_html.tap()
    h.win.plbx_html.tap()

    const calls = h.reports('plbx_call').filter((m) => m.data.method === 'tap')
    expect(calls.map((m) => m.data.n)).toEqual([1, 2, 3])
    expect(tap).toHaveBeenCalledTimes(3)
    expect(tap.mock.instances[0]).toBe(receiver)
  })

  it("reports expose('restart', fn, 'Restart') and still calls through with all arguments", () => {
    const h = runPlbxCallHarness()
    const original = vi.fn()
    h.win.plbx_html = { expose: original }
    h.tick()

    const restartFn = () => {}
    h.win.plbx_html.expose('restart', restartFn, 'Restart')

    const calls = h.reports('plbx_call').filter((m) => m.data.method === 'expose')
    expect(calls).toHaveLength(1)
    expect(calls[0].data).toMatchObject({ method: 'expose', n: 1, arg: 'restart' })
    expect(original).toHaveBeenCalledWith('restart', restartFn, 'Restart')
  })

  it('wrapping twice does not double-count subsequent calls', () => {
    const h = runPlbxCallHarness()
    const tap = vi.fn()
    h.win.plbx_html = { tap }
    h.tick()
    expect(h.win.plbx_html.__plbx_preview_wrapped).toBe(true)

    // Nothing left scheduled once the bridge is wrapped — draining again is a
    // no-op, proving the poll doesn't keep re-wrapping forever.
    h.tick()

    h.win.plbx_html.tap()
    const calls = h.reports('plbx_call').filter((m) => m.data.method === 'tap')
    expect(calls).toHaveLength(1)
    expect(calls[0].data.n).toBe(1)
    expect(tap).toHaveBeenCalledTimes(1)
  })

  it('skips a member missing from the bridge without error', () => {
    const h = runPlbxCallHarness()
    h.win.plbx_html = { tap: vi.fn() } // no game_end, no download, ...
    expect(() => h.tick()).not.toThrow()
    expect(h.win.plbx_html.__plbx_preview_wrapped).toBe(true)
    expect(h.win.plbx_html.game_end).toBeUndefined()
  })

  it('reports a throwing original call, then rethrows it (the game keeps seeing the error)', () => {
    const h = runPlbxCallHarness()
    const boom = new Error('boom')
    h.win.plbx_html = {
      tap: () => {
        throw boom
      },
    }
    h.tick()

    expect(() => h.win.plbx_html.tap()).toThrow(boom)
    const calls = h.reports('plbx_call').filter((m) => m.data.method === 'tap')
    expect(calls).toHaveLength(1) // reported BEFORE the rethrow
  })

  it('polls up to 200 times at 50ms before giving up if the bridge never appears', () => {
    const h = runPlbxCallHarness()
    for (let i = 0; i < 199; i++) {
      expect(h.pendingCount()).toBeGreaterThan(0)
      h.tick()
    }
    // still no bridge; the 200th tick must not schedule a 201st
    h.tick()
    expect(h.pendingCount()).toBe(0)
  })

  it('is generated for every network, not gated behind mraid', () => {
    const nonMraid = generatePreviewUtil({ networkId: 'mintegral', mraid: false, maxSize: 1 })
    const mraidNet = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 1 })
    for (const code of [nonMraid, mraidNet]) {
      expect(code).toContain('_plbxCallCounts')
      expect(code).toContain('__plbx_preview_wrapped')
    }
  })

  it('uses only ES5 syntax in the call-tracking phase (no let/const/arrow functions)', () => {
    const code = generatePreviewUtil({ networkId: 'mintegral', mraid: false, maxSize: 1 })
    const marker = '/* PLBX_CALL_TRACKING */'
    const idx = code.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const phase = code.slice(idx)
    expect(phase).not.toMatch(/\blet\s/)
    expect(phase).not.toMatch(/\bconst\s/)
    expect(phase).not.toMatch(/=>/)
  })

  it('emits parseable JavaScript for a network with the MRAID SDK mock too', () => {
    const code = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 1 })
    expect(() => new Function(code)).not.toThrow()
  })
})
