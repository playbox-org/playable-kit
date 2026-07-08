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
