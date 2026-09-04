import { describe, expect, it } from 'vitest'
import { getAdapter } from '../../src/packager/network-adapters'
import { HtmlBuilder } from '../../src/packager/html-builder'
import type { PackageConfig } from '../../src/types'

/**
 * Behavioural cover for the PlayTurbo lifecycle directions (§5, §7): the
 * container CALLS window.gameStart/gameClose, the creative DEFINES them.
 *
 * String assertions elsewhere only prove the code was emitted. This runs it:
 * every <script> the adapter injects is executed against a fake window, then
 * the container's calls are simulated.
 */
const config: PackageConfig = {
  storeUrlIos: 'https://apps.apple.com/app/id123',
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.test',
  orientation: 'portrait',
}

const sampleHtml =
  '<!DOCTYPE html><html><head></head><body><script src="main.js"></script></body></html>'

type FakeWindow = Record<string, unknown>

/**
 * Run the adapter's injected scripts against a fresh fake window.
 *
 * `timers`, when passed, captures every `setTimeout(cb, ms)` callback
 * scheduled during boot (and by anything called later against the returned
 * window) instead of letting a real timer fire — tests that need to advance
 * a poll (game_ready's bounded retry) shift a callback off this array and
 * call it themselves. Without it, `setTimeout` is a no-op stub (matches the
 * historical behaviour of every other test in this file, none of which care
 * about timing).
 */
function bootCreative(timers?: Array<() => void>): FakeWindow {
  const builder = new HtmlBuilder(sampleHtml)
  getAdapter('mintegral').transform(builder, config)
  const html = builder.toHtml()

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  )
  const win: FakeWindow = {
    navigator: { userAgent: 'test' },
    location: { href: '' },
    open: () => null,
    console: { log: () => {} },
  }
  const fakeSetTimeout = (cb: () => void) => {
    if (timers) timers.push(cb)
    return 0
  }
  for (const code of scripts) {
    // The banner script uses console styling and nothing else we care about;
    // anything that throws in this stub environment is not part of the contract.
    try {
      new Function('window', 'parent', 'document', 'setTimeout', code)(
        win,
        win,
        { querySelectorAll: () => [] },
        fakeSetTimeout,
      )
    } catch {
      /* not under test */
    }
  }
  return win
}

type BridgeFn = (...args: unknown[]) => unknown
const plbx = (w: FakeWindow) => w.plbx_html as Record<string, BridgeFn>

describe('Mintegral lifecycle direction', () => {
  it('runs a subscriber when the container calls gameStart', () => {
    const win = bootCreative()
    let started = 0
    plbx(win).on_game_start(() => { started++ })

    expect(started).toBe(0) // container has not called yet
    ;(win.gameStart as () => void)()
    expect(started).toBe(1)
    expect(plbx(win).is_game_started()).toBe(true)
  })

  it('calls a late subscriber immediately', () => {
    // Cocos boots asynchronously: a scene subscribing in onLoad is routinely
    // later than the container's gameStart. Missing it silently was the bug.
    const win = bootCreative()
    ;(win.gameStart as () => void)()
    let started = 0
    plbx(win).on_game_start(() => { started++ })
    expect(started).toBe(1)
  })

  it('keeps one throwing subscriber from skipping the rest', () => {
    const win = bootCreative()
    const ran: string[] = []
    plbx(win).on_game_start(() => { ran.push('a'); throw new Error('boom') })
    plbx(win).on_game_start(() => { ran.push('b') })
    ;(win.gameStart as () => void)()
    expect(ran).toEqual(['a', 'b'])
  })

  it('does NOT run the close hook when the CTA is tapped', () => {
    // download() used to call gameClose(), so the spec's own example hook
    // ("turn off this background music") killed the audio mid-ad.
    const win = bootCreative()
    let closed = 0
    plbx(win).on_game_close(() => { closed++ })
    win.install = () => {}
    plbx(win).download()
    expect(closed).toBe(0)
  })

  it('does NOT run the close hook when the game reports game_end', () => {
    const win = bootCreative()
    let closed = 0
    let ended = 0
    plbx(win).on_game_close(() => { closed++ })
    win.gameEnd = () => { ended++ }
    plbx(win).game_end()
    expect(ended).toBe(1) // creative → container, still forwarded
    expect(closed).toBe(0) // container → creative, not ours to fire
  })

  it('runs the close hook when the container calls gameClose', () => {
    const win = bootCreative()
    let closed = 0
    plbx(win).on_game_close(() => { closed++ })
    ;(win.gameClose as () => void)()
    expect(closed).toBe(1)
  })

  it('forwards game_retry to window.gameRetry (§6)', () => {
    const win = bootCreative()
    let retried = 0
    win.gameRetry = () => { retried++ }
    plbx(win).game_retry()
    expect(retried).toBe(1)
  })

  it('preserves a gameStart the game assigned first', () => {
    // The spec shows `function gameStart() { … }` inside the playable.
    const builder = new HtmlBuilder(sampleHtml)
    getAdapter('mintegral').transform(builder, config)
    const html = builder.toHtml()
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1],
    )
    let own = 0
    const win: FakeWindow = {
      navigator: { userAgent: 'test' },
      console: { log: () => {} },
      gameStart: () => { own++ },
    }
    for (const code of scripts) {
      try {
        new Function('window', 'parent', 'document', code)(win, win, {
          querySelectorAll: () => [],
        })
      } catch {
        /* not under test */
      }
    }
    let subbed = 0
    plbx(win).on_game_start(() => { subbed++ })
    ;(win.gameStart as () => void)()
    expect(own).toBe(1)
    expect(subbed).toBe(1)
  })

  // §4: gameReady() is CALLED BY THE CREATIVE — a free-stack single-file
  // build has no runtime loader to fire it, so plbx_html.game_ready() is the
  // only thing that ever does. See docs/networks/lifecycle-call-direction.md.
  it('game_ready calls window.gameReady when it is already defined, once', () => {
    const win = bootCreative()
    let calls = 0
    win.gameReady = () => { calls++ }
    plbx(win).game_ready()
    plbx(win).game_ready()
    expect(calls).toBe(1)
    expect(win.__plbx_gr).toBe(true)
  })

  it('game_ready polls when window.gameReady is not defined yet', () => {
    const timers: Array<() => void> = []
    const win = bootCreative(timers)
    let calls = 0
    plbx(win).game_ready() // window.gameReady not defined yet — schedules a poll
    expect(calls).toBe(0)
    expect(timers.length).toBeGreaterThan(0)
    win.gameReady = () => { calls++ }
    timers.shift()!() // advance the fake setTimeout — the poll runs again
    expect(calls).toBe(1)
    expect(win.__plbx_gr).toBe(true)
  })
})
