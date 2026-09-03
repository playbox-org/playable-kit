/**
 * `plbx` — the game-side SDK for free-stack playables (Vite / Three.js / Pixi
 * / anything that is not Cocos). Browser-only, zero dependencies.
 *
 * It is a typed shell over `window.plbx_html`, the bridge every network
 * adapter injects at packaging time. The bridge owns the per-network rules
 * (which SDK call is the CTA, who calls gameStart, when to pause); this file
 * owns none — it only forwards, gates boot, and stands in for the bridge when
 * the file runs outside a packaged build (vite dev, a browser tab).
 */

export type PlbxEvent =
  | 'pause'
  | 'resume'
  | 'resize'
  | 'mute'
  | 'game_start'
  | 'game_close'

type Bridge = Record<string, any>
type Handler = (...args: any[]) => void

const EVENT_MEMBER: Record<PlbxEvent, string> = {
  pause: 'on_pause',
  resume: 'on_resume',
  resize: 'on_resize',
  mute: 'on_mute_change',
  game_start: 'on_game_start',
  game_close: 'on_game_close',
}

/**
 * The bridge a file gets when no adapter injected one: the packager's
 * defaults, so game code behaves the same in `vite dev` as in a packaged
 * preview build. CTA = window.open, the ad starts when the creative runs,
 * pause/resume from page visibility, resize from the window.
 */
function previewStub(): Bridge {
  const subs: Record<string, Handler[]> = { pause: [], resume: [], resize: [], mute: [] }
  const b: Bridge = {
    google_play_url: '',
    appstore_url: '',
    _paused: false,
    download(url?: string) {
      const u = url || this.google_play_url || this.appstore_url || ''
      if (u) window.open(u, '_blank')
    },
    game_end() {},
    game_ready() {},
    game_retry() {},
    report() {},
    tap() {},
    log_event() {},
    is_audio: () => true,
    is_hide_download: () => false,
    is_muted: () => false,
    is_game_started: () => true,
    is_paused() { return this._paused },
    on_game_start(cb: Handler) { try { cb() } catch { /* subscriber's problem */ } },
    on_game_close() {},
    on_mute_change(cb: Handler) { subs.mute.push(cb); try { cb(false) } catch { /* ditto */ } },
    on_pause(cb: Handler) { subs.pause.push(cb); if (this._paused) { try { cb() } catch { /* ditto */ } } },
    on_resume(cb: Handler) { subs.resume.push(cb) },
    on_resize(cb: Handler) { subs.resize.push(cb); try { cb(window.innerWidth, window.innerHeight) } catch { /* ditto */ } },
    set_paused(p: boolean) {
      p = !!p
      if (p === this._paused) return
      this._paused = p
      for (const fn of p ? subs.pause : subs.resume) { try { fn() } catch { /* ditto */ } }
    },
    set_size(w: number, h: number) {
      for (const fn of subs.resize) { try { fn(w, h) } catch { /* ditto */ } }
    },
    external_commands: [] as Array<{ name: string; label: string }>,
    expose(name: string, fn: Handler, label?: string) {
      if (typeof name !== 'string' || typeof fn !== 'function') return
      this[name] = fn
      if (!this.external_commands.some((c: { name: string }) => c.name === name)) {
        this.external_commands.push({ name, label: label || name })
      }
    },
  }
  try {
    document.addEventListener('visibilitychange', () => b.set_paused(document.visibilityState === 'hidden'))
    window.addEventListener('resize', () => b.set_size(window.innerWidth, window.innerHeight))
  } catch { /* no DOM events here — a worker or a test stub */ }
  return b
}

class Plbx {
  private bridge: Bridge | null = null
  private booted = false
  private started = false
  private pending: Array<[PlbxEvent, Handler]> = []
  private warned: Record<string, true> = {}

  /**
   * Resolve the bridge, wire queued subscriptions, then run `boot` through
   * the adapter's boot gate (`window.__plbx_pre_boot`: MRAID viewability,
   * Luna's startGame) — the same hook the Cocos runtime loader uses. Call it
   * first thing; `boot` runs at most once however many times init is called.
   */
  init(boot?: () => void): void {
    this.ensureBridge()
    if (!boot) return
    const go = () => {
      if (this.booted) return
      this.booted = true
      boot()
    }
    const gate = (window as any).__plbx_pre_boot
    if (typeof gate === 'function') gate(go)
    else go()
  }

  /** First frame is on screen: game_ready (once). The splash hides on it. */
  start(): void {
    if (this.started) return
    this.started = true
    this.call('game_ready')
  }

  download(url?: string): void { this.call('download', url) }
  game_end(): void { this.call('game_end') }
  game_retry(): void { this.call('game_retry') }
  tap(): void { this.call('tap') }
  report(key: string): void { this.call('report', key) }
  log_event(name: string, value?: number): void { this.call('log_event', name, value) }
  expose(name: string, fn: () => void, label?: string): void { this.call('expose', name, fn, label) }

  is_muted(): boolean { return !!this.call('is_muted') }
  is_paused(): boolean { return !!this.call('is_paused') }
  is_game_started(): boolean { const r = this.call('is_game_started'); return r === undefined ? true : !!r }
  is_audio(): boolean { const r = this.call('is_audio'); return r === undefined ? true : !!r }
  is_hide_download(): boolean { return !!this.call('is_hide_download') }

  set_google_play_url(url: string): void { this.ensureBridge().google_play_url = url }
  set_app_store_url(url: string): void { this.ensureBridge().appstore_url = url }

  /** Subscribe to a container signal. Before init the subscription is queued. */
  on(event: PlbxEvent, cb: Handler): void {
    if (!this.bridge) { this.pending.push([event, cb]); return }
    this.call(EVENT_MEMBER[event], cb)
  }

  private ensureBridge(): Bridge {
    if (this.bridge) return this.bridge
    const w = window as any
    let b: Bridge | undefined = w.plbx_html || w.super_html
    if (!b) {
      b = previewStub()
      w.plbx_html = b
      console.info('[plbx] no network bridge — preview stub (CTA opens the store URL in a new tab)')
    }
    if (!w.super_html) w.super_html = b
    this.bridge = b
    for (const [ev, cb] of this.pending) this.call(EVENT_MEMBER[ev], cb)
    this.pending = []
    return b
  }

  private call(member: string, ...args: unknown[]): unknown {
    const b = this.ensureBridge()
    const fn = b[member]
    if (typeof fn !== 'function') {
      if (!this.warned[member]) {
        this.warned[member] = true
        console.warn(`[plbx] bridge has no ${member}() — repackage with a newer playable-kit`)
      }
      return undefined
    }
    try {
      return fn.apply(b, args)
    } catch (e) {
      console.error(`[plbx] ${member} threw`, e)
      return undefined
    }
  }
}

export const plbx = new Plbx()
export default plbx
