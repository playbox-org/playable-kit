import { describe, expect, it } from 'vitest'
import { getAdapter } from '../../src/packager/network-adapters'
import { HtmlBuilder } from '../../src/packager/html-builder'
import type { PackageConfig } from '../../src/types'

/**
 * pause/resume/resize are container signals. Each adapter's signal script
 * wires them from the container's own events (MRAID viewableChange, page
 * visibility, Luna's custom events) into the bridge; this runs those scripts
 * against a fake window and fires the events.
 */
const config: PackageConfig = { orientation: 'portrait' }
const sample = '<!DOCTYPE html><html><head></head><body></body></html>'

type Fn = (...a: unknown[]) => unknown
type Listeners = Record<string, Fn[]>

function boot(networkId: string, mraidState = 'default') {
  const builder = new HtmlBuilder(sample)
  getAdapter(networkId).transform(builder, config)
  const scripts = [...builder.toHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const winL: Listeners = {}
  const docL: Listeners = {}
  const mraidL: Listeners = {}
  const on = (bag: Listeners) => (ev: string, fn: Fn) => (bag[ev] = bag[ev] || []).push(fn)
  const doc = {
    visibilityState: 'visible',
    addEventListener: on(docL),
    querySelectorAll: () => [],
    getElementById: () => null,
  }
  const win: Record<string, unknown> = {
    innerWidth: 320,
    innerHeight: 480,
    navigator: { userAgent: 'test' },
    location: { href: '' },
    open: () => null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    addEventListener: on(winL),
    document: doc,
    setTimeout: () => 0,
  }
  if (mraidState !== 'none') {
    win.mraid = {
      getState: () => mraidState,
      isViewable: () => mraidState === 'default',
      addEventListener: on(mraidL),
      getMaxSize: () => ({ width: 320, height: 480 }),
      open: () => {},
    }
  }
  for (const code of scripts) {
    try {
      new Function('window', 'parent', 'document', 'setTimeout', 'mraid', code)(
        win, win, doc, () => 0, win.mraid,
      )
    } catch { /* shims not under test */ }
  }
  const fire = (bag: Listeners, ev: string, ...args: unknown[]) =>
    (bag[ev] || []).forEach((fn) => fn(...args))
  return { plbx: win.plbx_html as Record<string, Fn>, winL, docL, mraidL, doc, fire }
}

describe('plbx_html pause/resume/resize signals', () => {
  it('generic network: page visibility drives pause/resume', () => {
    const { plbx, docL, doc, fire } = boot('facebook', 'none')
    const log: string[] = []
    plbx.on_pause(() => log.push('pause'))
    plbx.on_resume(() => log.push('resume'))
    doc.visibilityState = 'hidden'
    fire(docL, 'visibilitychange')
    doc.visibilityState = 'visible'
    fire(docL, 'visibilitychange')
    expect(log).toEqual(['pause', 'resume'])
    expect(plbx.is_paused()).toBe(false)
  })

  it('generic network: window resize reaches on_resize', () => {
    const { plbx, winL, fire } = boot('facebook', 'none')
    const sizes: unknown[] = []
    plbx.on_resize((w: unknown, h: unknown) => sizes.push([w, h]))
    fire(winL, 'resize')
    expect(sizes).toEqual([[320, 480], [320, 480]])
  })

  it('MRAID network: viewableChange pauses and resumes, sizeChange resizes', () => {
    const { plbx, mraidL, fire } = boot('applovin')
    const log: unknown[] = []
    plbx.on_pause(() => log.push('pause'))
    plbx.on_resume(() => log.push('resume'))
    plbx.on_resize((w: unknown, h: unknown) => log.push([w, h]))
    fire(mraidL, 'viewableChange', false)
    fire(mraidL, 'viewableChange', true)
    fire(mraidL, 'sizeChange', 640, 960)
    expect(log).toEqual([[320, 480], 'pause', 'resume', [640, 960]])
  })

  it('MRAID network: a not-yet-viewable ad starts paused', () => {
    const { plbx } = boot('applovin', 'hidden')
    expect(plbx.is_paused()).toBe(true)
  })

  it('MRAID network still in "loading" attaches on ready', () => {
    const { plbx, mraidL, fire } = boot('applovin', 'loading')
    expect(mraidL.ready?.length).toBeGreaterThan(0)
    fire(mraidL, 'ready')
    expect(mraidL.viewableChange?.length).toBeGreaterThan(0)
    expect(typeof plbx.is_paused).toBe('function')
  })

  it('Luna: luna:pause / luna:resume reach the bridge', () => {
    const { plbx, winL, fire } = boot('luna', 'none')
    const log: string[] = []
    plbx.on_pause(() => log.push('pause'))
    plbx.on_resume(() => log.push('resume'))
    fire(winL, 'luna:pause')
    fire(winL, 'luna:resume')
    expect(log).toEqual(['pause', 'resume'])
  })

  it('a throwing subscriber does not stop the others', () => {
    const { plbx } = boot('facebook', 'none')
    let second = 0
    plbx.on_pause(() => { throw new Error('boom') })
    plbx.on_pause(() => second++)
    plbx.set_paused(true)
    expect(second).toBe(1)
  })

  it('set_paused is idempotent', () => {
    const { plbx } = boot('facebook', 'none')
    let n = 0
    plbx.on_pause(() => n++)
    plbx.set_paused(true)
    plbx.set_paused(true)
    expect(n).toBe(1)
  })
})
