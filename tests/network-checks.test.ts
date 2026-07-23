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

  it('is absent for MRAID networks and molocoV2', () => {
    const applovin = getNetworkChecks('applovin', true).map((c) => c.id)
    expect(applovin).not.toContain('no_forbidden_literals')
    const molocoV2 = getNetworkChecks('molocoV2', true).map((c) => c.id)
    expect(molocoV2).not.toContain('no_forbidden_literals')
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
