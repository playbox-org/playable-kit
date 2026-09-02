import { describe, expect, it } from 'vitest'

import {
  getNetworkChecks,
  MOLOCO_V2_TRACKED_MACROS,
} from '../src/checks/network-checks'

describe('getNetworkChecks', () => {
  it('produces a boot + no-errors baseline for a generic network', () => {
    const checks = getNetworkChecks('applovin', true)
    const ids = checks.map((c) => c.id)
    expect(ids.length).toBeGreaterThan(2)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('emits per-macro checks for molocoV2 instead of the generic CTA check', () => {
    const checks = getNetworkChecks('molocoV2', true)
    const ids = checks.map((c) => c.id)
    for (const macro of MOLOCO_V2_TRACKED_MACROS) {
      expect(ids).toContain(`macro_${macro.key}`)
    }
  })

  it('requires the full lifecycle for mintegral', () => {
    const ids = getNetworkChecks('mintegral', false).map((c) => c.id)
    expect(ids.join(',')).toMatch(/game_?ready|gameReady|lifecycle/i)
  })
})

// Non-MRAID upload validators (Moloco, Facebook) substring-scan the raw HTML
// and reject on any 'mraid.js' hit — even in a comment or a conditional. The
// preview validator surfaces that as a static check for mraid:false networks;
// MRAID networks legitimately ship the tag, and molocoV2's launcher requires it.
describe('no_forbidden_literals check', () => {
  it('exists for non-MRAID networks (moloco, facebook)', () => {
    for (const id of ['moloco', 'facebook']) {
      const check = getNetworkChecks(id, false).find(
        (c) => c.id === 'no_forbidden_literals',
      )
      expect(check).toBeDefined()
      expect(check!.label).toContain('mraid.js')
    }
  })

  it('is absent for MRAID networks with nothing to forbid, and molocoV2', () => {
    const applovin = getNetworkChecks('applovin', true).map((c) => c.id)
    expect(applovin).not.toContain('no_forbidden_literals')
    // molocoV2 returns early with its macro suite; its tracker-domain list is
    // enforced at packaging only, and never reached the checklist.
    const molocoV2 = getNetworkChecks('molocoV2', true).map((c) => c.id)
    expect(molocoV2).not.toContain('no_forbidden_literals')
  })

  // The row used to be gated on `!mraid`, which silently dropped it for Unity —
  // an MRAID network that forbids window.top. The gate is now "does this network
  // forbid anything", so the preview checklist can't diverge from the packager.
  it('exists for unity, an MRAID network with its own forbidden string', () => {
    const check = getNetworkChecks('unity', true).find(
      (c) => c.id === 'no_forbidden_literals',
    )
    expect(check).toBeDefined()
    expect(check!.label).toContain('window.top')
    expect(check!.hint).toContain('windowEvents')
  })

  it('lists a network-specific string alongside mraid.js (mintegral)', () => {
    const check = getNetworkChecks('mintegral', false).find(
      (c) => c.id === 'no_forbidden_literals',
    )
    expect(check).toBeDefined()
    expect(check!.label).toContain('preview-util.js')
    expect(check!.label).toContain('mraid.js')
  })
})

// Vungle's Adaptive Creative rule is the opposite of Mintegral's: `complete` and the
// CTA's `download` must NEVER fire together, and completion only reaches the container
// through the bridge (plbx_html.game_end → parent.postMessage('complete', '*')). The
// shared hint used to tell every GAME_END_REQUIRED network to call window.gameEnd()
// "before or alongside the CTA" — for Vungle that is the forbidden move, and the bare
// global never posts anything.
describe('game_end hint is network-correct', () => {
  it('tells Vungle to go through the bridge and to keep complete away from the CTA', () => {
    const check = getNetworkChecks('vungle', true).find((c) => c.id === 'game_end')
    expect(check).toBeDefined()
    expect(check!.hint).toContain('plbx_html.game_end()')
    expect(check!.hint).toContain('postMessage("complete"')
    expect(check!.hint).toMatch(/never fire together with the CTA/i)
    expect(check!.hint).not.toMatch(/alongside the CTA/i)
  })

  it('leaves the Mintegral hint alone — there gameEnd must precede the CTA', () => {
    const check = getNetworkChecks('mintegral', true).find((c) => c.id === 'game_end')
    expect(check).toBeDefined()
    expect(check!.hint).toContain('window.gameEnd()')
    expect(check!.hint).toContain('alongside the CTA')
  })
})

// Luna is a packaging TARGET, not a delivery network: Luna calls startGame(),
// Luna's standard Ad Click fires only from InstallFullGame(), and its analytics
// live under hard caps. None of that maps onto the gameReady/gameStart/gameEnd
// lifecycle sets, so the luna checks are their own two entries.
describe('luna checks', () => {
  it('cover the boot gate, CTA and events', () => {
    const ids = getNetworkChecks('luna', false).map((c) => c.id)
    expect(ids).toContain('start_game')
    expect(ids).toContain('cta')
    expect(ids).toContain('luna_events')
  })

  it('label the CTA with Luna\'s own API', () => {
    const cta = getNetworkChecks('luna', false).find((c) => c.id === 'cta')
    expect(cta!.label).toBe('CTA (Luna.Unity.Playable.InstallFullGame)')
    expect(cta!.hint).toContain('InstallFullGame()')
  })

  it('do not borrow the gameReady/gameEnd lifecycle of other networks', () => {
    const ids = getNetworkChecks('luna', false).map((c) => c.id)
    expect(ids).not.toContain('game_ready')
    expect(ids).not.toContain('game_start')
    expect(ids).not.toContain('game_end')
    expect(ids).not.toContain('game_close')
  })

  it('stay out of every other network', () => {
    for (const id of ['applovin', 'mintegral', 'molocoV2']) {
      const ids = getNetworkChecks(id, true).map((c) => c.id)
      expect(ids).not.toContain('start_game')
      expect(ids).not.toContain('luna_events')
    }
  })
})
