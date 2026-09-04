import { describe, expect, it } from 'vitest'
import { getAdapter } from '../../src/packager/network-adapters'
import { HtmlBuilder } from '../../src/packager/html-builder'
import { NETWORKS } from '../../src/networks'
import type { PackageConfig } from '../../src/types'

/**
 * plbx_html is ONE API across every network. A game is written once and
 * packaged for 25+ targets, so a member only some adapters define is a
 * TypeError on the rest — and the game cannot feature-detect what it never
 * knew was optional.
 *
 * This has drifted twice: the hand-rolled Mintegral bridge silently lacked
 * game_ready/is_muted/report/tap, and the container-hook subscriptions landed
 * on Mintegral alone. Both were invisible until a game hit them in production.
 */
const config: PackageConfig = {
  storeUrlIos: 'https://apps.apple.com/app/id1',
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.test',
  orientation: 'portrait',
}
const sample = '<!DOCTYPE html><html><head></head><body></body></html>'

/** Every member game code is allowed to rely on, on every network. */
const REQUIRED_MEMBERS = [
  'download',
  'game_end',
  'game_ready',
  'game_retry',
  'is_audio',
  'is_hide_download',
  'is_muted',
  'is_game_started',
  'on_game_start',
  'on_game_close',
  'on_mute_change',
  'report',
  'tap',
  'log_event',
  'expose',
  'is_paused',
  'on_pause',
  'on_resume',
  'on_resize',
  'set_paused',
  'set_size',
] as const

/**
 * Boots an adapter's injected scripts against a fake window and returns the
 * whole window (not just plbx_html) — for lifecycle behaviour that reads a
 * property the game/container sets ON window, like TikTok's game_ready
 * deliberately NOT calling window.gameReady (it has no lifecycle at all).
 * `preset` is merged into the fake window BEFORE boot, so e.g. a pre-defined
 * window.gameReady spy is in place the moment any injected script runs.
 */
function windowFor(
  networkId: string,
  preset: Record<string, unknown> = {},
): Record<string, unknown> {
  const builder = new HtmlBuilder(sample)
  getAdapter(networkId).transform(builder, config)
  const html = builder.toHtml()
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  )
  const win: Record<string, unknown> = {
    navigator: { userAgent: 'test' },
    location: { href: '' },
    open: () => null,
    console: { log: () => {} },
    addEventListener: () => {},
    document: { querySelectorAll: () => [] },
    setTimeout: () => 0,
    innerWidth: 320,
    innerHeight: 480,
    ...preset,
  }
  for (const code of scripts) {
    try {
      new Function('window', 'parent', 'document', 'setTimeout', code)(
        win,
        win,
        win.document,
        () => 0,
      )
    } catch {
      /* network SDK shims are not under test here */
    }
  }
  return win
}

function bridgeFor(networkId: string): Record<string, unknown> {
  return (windowFor(networkId).plbx_html ?? {}) as Record<string, unknown>
}

describe('plbx_html surface is identical on every network', () => {
  const ids = Object.keys(NETWORKS)

  for (const id of ids) {
    it(`${id} exposes every required member`, () => {
      const bridge = bridgeFor(id)
      const missing = REQUIRED_MEMBERS.filter(
        (m) => typeof bridge[m] !== 'function',
      )
      expect(missing, `${id} is missing: ${missing.join(', ')}`).toEqual([])
    })
  }

  it('also carries the data members', () => {
    for (const id of ids) {
      const bridge = bridgeFor(id)
      expect(typeof bridge.google_play_url, id).toBe('string')
      expect(typeof bridge.appstore_url, id).toBe('string')
      expect(Array.isArray(bridge.external_commands), id).toBe(true)
    }
  })

  // The default is "the ad starts when the creative runs" — true everywhere
  // except Mintegral, whose container fires a separate start (§5).
  it('on_game_start fires immediately on networks without a container start', () => {
    for (const id of ['applovin', 'facebook', 'luna', 'tiktok']) {
      const bridge = bridgeFor(id)
      let ran = 0
      ;(bridge.on_game_start as (cb: () => void) => void)(() => { ran++ })
      expect(ran, id).toBe(1)
      expect((bridge.is_game_started as () => boolean)(), id).toBe(true)
    }
  })

  // log_event is a no-op stub on every network except Luna, whose adapter
  // overrides it with a real sender to window.pi (see lunaBridge in base.ts).
  // A regression that let the base no-op leak through would go unnoticed by
  // the "is it a function" check above — this asserts it is Luna's own.
  it('luna log_event is the real sender, not the base no-op', () => {
    const bridge = bridgeFor('luna')
    expect(String(bridge.log_event)).toContain('_plbx_luna')
    for (const id of ['applovin', 'facebook', 'mintegral', 'tiktok', 'molocoV2']) {
      if (!(id in NETWORKS)) continue
      const other = bridgeFor(id)
      expect(String(other.log_event), id).not.toContain('_plbx_luna')
    }
  })

  it('mintegral defers on_game_start to the container instead', () => {
    const bridge = bridgeFor('mintegral')
    let ran = 0
    ;(bridge.on_game_start as (cb: () => void) => void)(() => { ran++ })
    expect(ran).toBe(0)
    expect((bridge.is_game_started as () => boolean)()).toBe(false)
  })

  it('on_mute_change hands over the current state at least once', () => {
    for (const id of ['applovin', 'mintegral']) {
      const bridge = bridgeFor(id)
      const seen: unknown[] = []
      ;(bridge.on_mute_change as (cb: (m: unknown) => void) => void)((m) => {
        seen.push(m)
      })
      expect(seen, id).toEqual([false])
    }
  })

  it('on_pause/on_resize replay current state to a late subscriber', () => {
    for (const id of ['applovin', 'mintegral', 'luna', 'tiktok']) {
      const bridge = bridgeFor(id)
      const sizes: unknown[] = []
      ;(bridge.on_resize as (cb: (w: number, h: number) => void) => void)(
        (w, h) => sizes.push([w, h]),
      )
      expect(sizes.length, id).toBe(1)
      let paused = 0
      ;(bridge.set_paused as (p: boolean) => void)(true)
      ;(bridge.on_pause as (cb: () => void) => void)(() => paused++)
      expect(paused, id).toBe(1)
      expect((bridge.is_paused as () => boolean)(), id).toBe(true)
    }
  })

  // TikTok/Pangle have NO lifecycle at all (docs/networks/lifecycle-call-
  // direction.md) — game_ready must stay a no-op there, never reach for
  // window.gameReady the way Mintegral/Bigo's does.
  it('tiktok/pangle game_ready does NOT call window.gameReady (no lifecycle on this SDK)', () => {
    for (const id of ['tiktok', 'pangle']) {
      let calls = 0
      const win = windowFor(id, { gameReady: () => { calls++ } })
      const bridge = win.plbx_html as Record<string, (...a: unknown[]) => unknown>
      ;(bridge.game_ready as () => void)()
      expect(calls, id).toBe(0)
    }
  })
})
