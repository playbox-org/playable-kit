// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyFn = (...a: unknown[]) => unknown
const w = window as unknown as Record<string, unknown>

/** A bridge shaped like the packager's, recording calls. */
function fakeBridge() {
  const calls: string[] = []
  const subs: Record<string, AnyFn[]> = {}
  const sub = (k: string) => (cb: AnyFn) => (subs[k] = subs[k] || []).push(cb)
  const b: Record<string, unknown> = {
    google_play_url: '',
    appstore_url: '',
    download: (u?: string) => calls.push(`download:${u ?? ''}`),
    game_ready: () => calls.push('game_ready'),
    game_end: () => calls.push('game_end'),
    game_retry: () => calls.push('game_retry'),
    tap: () => calls.push('tap'),
    report: (k: string) => calls.push(`report:${k}`),
    log_event: (n: string, v?: number) => calls.push(`log:${n}:${v}`),
    expose: (n: string) => calls.push(`expose:${n}`),
    is_muted: () => true,
    is_paused: () => false,
    is_game_started: () => true,
    is_audio: () => true,
    is_hide_download: () => false,
    on_pause: sub('pause'),
    on_resume: sub('resume'),
    on_resize: sub('resize'),
    on_mute_change: sub('mute'),
    on_game_start: sub('game_start'),
    on_game_close: sub('game_close'),
    external_commands: [],
  }
  return { b, calls, subs }
}

async function freshSdk() {
  vi.resetModules()
  const mod = await import('../../src/sdk/index')
  return mod.default
}

beforeEach(() => {
  delete w.plbx_html
  delete w.super_html
  delete w.__plbx_pre_boot
})

describe('plbx sdk', () => {
  it('init boots through __plbx_pre_boot when the adapter defined one', async () => {
    const { b } = fakeBridge()
    w.plbx_html = b
    let release: (() => void) | null = null
    w.__plbx_pre_boot = (go: () => void) => { release = go }
    const plbx = await freshSdk()
    let booted = 0
    plbx.init(() => booted++)
    expect(booted).toBe(0)
    release!()
    release!()
    expect(booted).toBe(1)
  })

  it('init boots immediately without a gate, and only once', async () => {
    w.plbx_html = fakeBridge().b
    const plbx = await freshSdk()
    let booted = 0
    plbx.init(() => booted++)
    plbx.init(() => booted++)
    expect(booted).toBe(1)
  })

  it('without any bridge, installs the preview stub and window.open is the CTA', async () => {
    const plbx = await freshSdk()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    plbx.init()
    expect(typeof (w.plbx_html as Record<string, unknown>).download).toBe('function')
    expect(w.super_html).toBe(w.plbx_html)
    plbx.set_google_play_url('https://play.google.com/store/apps/details?id=x')
    plbx.download()
    expect(open).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=x', '_blank')
    expect(plbx.is_game_started()).toBe(true)
    expect(plbx.is_muted()).toBe(false)
  })

  it('preview stub: page visibility drives pause/resume', async () => {
    const plbx = await freshSdk()
    plbx.init()
    const log: string[] = []
    plbx.on('pause', () => log.push('pause'))
    plbx.on('resume', () => log.push('resume'))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(log).toEqual(['pause', 'resume'])
  })

  it('start calls game_ready exactly once', async () => {
    const { b, calls } = fakeBridge()
    w.plbx_html = b
    const plbx = await freshSdk()
    plbx.init()
    plbx.start()
    plbx.start()
    expect(calls).toEqual(['game_ready'])
  })

  it('on() before init is queued and wired at init', async () => {
    const { b, subs } = fakeBridge()
    w.plbx_html = b
    const plbx = await freshSdk()
    const cb = () => {}
    plbx.on('pause', cb)
    expect(subs.pause).toBeUndefined()
    plbx.init()
    expect(subs.pause).toEqual([cb])
  })

  it('pass-throughs reach the bridge with their arguments', async () => {
    const { b, calls } = fakeBridge()
    w.plbx_html = b
    const plbx = await freshSdk()
    plbx.init()
    plbx.download('https://x')
    plbx.game_end()
    plbx.game_retry()
    plbx.tap()
    plbx.report('k')
    plbx.log_event('lvl', 2)
    plbx.expose('restart', () => {}, 'Restart')
    plbx.set_app_store_url('https://apps.apple.com/app/id1')
    expect(calls).toEqual(['download:https://x', 'game_end', 'game_retry', 'tap', 'report:k', 'log:lvl:2', 'expose:restart'])
    expect((w.plbx_html as Record<string, unknown>).appstore_url).toBe('https://apps.apple.com/app/id1')
    expect(plbx.is_muted()).toBe(true)
  })

  it('an old bridge without a member warns once and never throws', async () => {
    const { b } = fakeBridge()
    delete b.on_pause
    delete b.is_paused
    w.plbx_html = b
    const plbx = await freshSdk()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    plbx.init()
    expect(() => plbx.on('pause', () => {})).not.toThrow()
    expect(() => plbx.on('pause', () => {})).not.toThrow()
    expect(plbx.is_paused()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(2) // on_pause once, is_paused once
  })

  it('a method called before init initialises without booting anything', async () => {
    const { b, calls } = fakeBridge()
    w.plbx_html = b
    const plbx = await freshSdk()
    plbx.tap()
    expect(calls).toEqual(['tap'])
  })
})
