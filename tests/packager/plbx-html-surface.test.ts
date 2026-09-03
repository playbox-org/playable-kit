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
  'expose',
  'is_paused',
  'on_pause',
  'on_resume',
  'on_resize',
  'set_paused',
  'set_size',
] as const

function bridgeFor(networkId: string): Record<string, unknown> {
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
  return (win.plbx_html ?? {}) as Record<string, unknown>
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
})
