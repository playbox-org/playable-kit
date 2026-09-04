# Free-stack playables (single-file packaging + `plbx` SDK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package a Vite/Three.js/Pixi single-file build through the kit's existing network adapters, give free-stack games a typed `plbx` SDK, and migrate the reference project off `@smoud/playable-sdk`.

**Architecture:** `packageForNetworks` gets a second input path that skips the Cocos runtime loader and feeds the already-inlined HTML straight through the adapters, ZIP rules and naming. The `plbx_html` bridge grows pause/resume/resize for every network. A new `@playbox-ai/playable-kit/sdk` subpath wraps the bridge with a typed API and a boot gate; a bin drives the packager from a shell.

**Tech Stack:** TypeScript, tsup (ESM+CJS), vitest 2 (+ jsdom for SDK tests), cheerio, `node:util.parseArgs`. Reference project: Vite 5 + `vite-plugin-singlefile`, Three.js, Pixi.

**Spec:** `docs/superpowers/specs/2026-09-03-free-stack-sdk-design.md`

## Global Constraints

- Work in the kit worktree `playable-kit/.worktrees/free-stack-sdk` (branch `feat/free-stack-sdk`, base `origin/main` = 0.3.13). Package manager: `pnpm`. Run tests with `pnpm vitest run <file>`; full suite `pnpm test`; lint `pnpm lint`; types `pnpm typecheck`.
- **No version bump, no publish, no tag.** `package.json` `version` stays `0.3.13` until the Verification gate (Task 10) is green and the user says so.
- `plbx_html` is ONE API on every network: any member added to the bridge must exist on all 25+ adapters (`tests/packager/plbx-html-surface.test.ts` enforces).
- Every injected JS string is ES5 (`var`, `function`), wrapped in `try/catch` where it touches a container global. No `let`/`const`/arrows in bridge code.
- Lifecycle direction rule (`docs/networks/lifecycle-call-direction.md`): the SDK never calls `window.gameStart`/`gameClose`; the container does.
- Commit after every task: `git add <files> && git commit -m "<type>(<scope>): <subject>"`. Conventional Commits, English, no bump.
- Reference project lives outside the kit: `Playables/_Prod/hole-it-c1/recreation` (its own git repo, remote `Magic-Quick/hole-it`). Commit there on a branch `feat/plbx-sdk`; never push.

## File Structure

Kit (`playable-kit/.worktrees/free-stack-sdk`):

| File | Responsibility |
|---|---|
| `src/packager/html-builder.ts` (modify) | DOM edits: body-end `<script src>`, head `<style>`, body prepend, local-ref scan, classic-bundle rewrite |
| `src/packager/network-adapters/base.ts` (modify) | bridge members `is_paused/on_pause/on_resume/on_resize/set_paused/set_size`; `lifecycleSignals()`; SDK tag at body end; Luna pause → bridge |
| `src/packager/single-file.ts` (create) | `detectInputKind()`, `applySingleFileRewrite()` — the only single-file-specific packaging code |
| `src/packager/splash.ts` (modify) | `SINGLE_FILE_SPLASH_HOOK_JS` — hide splash on `game_ready` |
| `src/packager/runtime-loader.ts` (modify) | split `generatePayloadJs` so a finished HTML string can become a Moloco payload |
| `src/packager/packager.ts` (modify) | branch on input kind; single-file skips the loader |
| `src/types.ts` (modify) | `PackageConfig.input` |
| `src/networks.ts` (modify) | Vungle `htmlFileName: 'ad.html'` |
| `src/sdk/index.ts` (create) | the `plbx` SDK (browser-only) |
| `src/cli.ts` (create) | `playable-kit package …` bin |
| `tsup.config.ts`, `package.json` (modify) | `sdk` + `cli` entries, `exports["./sdk"]`, `bin`, jsdom devDep |
| `tests/fixtures/single-file-build/index.html` (create) | Vite-like single-file fixture |
| `tests/packager/single-file.test.ts` (create) | every network through the single-file path |
| `tests/packager/plbx-html-lifecycle.test.ts` (create) | pause/resume/resize behaviour |
| `tests/sdk/plbx-sdk.test.ts` (create) | SDK under jsdom |
| `tests/cli.test.ts` (create) | bin against the fixture |
| `README.md`, `docs/networks/lifecycle-call-direction.md` (modify) | usage + the new bridge members |

Reference project (`hole-it-c1/recreation`): `package.json`, `vite.config.js`, `src/main.js`, `src/App.js`, `src/utils/cta.js`, `src/ui/HUD.js`, `src/ui/EndCard.js` modified; `adNetworks.js`, `scripts/build-networks.mjs`, `src/utils/adLifecycle.js` deleted; `scripts/validate-networks.mjs` created.

---

### Task 1: HtmlBuilder — body-end script src, head style, body prepend, local refs, classic bundle

**Files:**
- Modify: `src/packager/html-builder.ts`
- Test: `tests/packager/html-builder.test.ts`

**Interfaces:**
- Produces:
  - `injectBodyScriptSrc(src: string): void` — `<script src>` appended at the end of `<body>`.
  - `injectHeadStyle(css: string): void` — `<style>` appended to `<head>`.
  - `prependBody(html: string): void` — raw HTML as first child of `<body>`.
  - `getLocalRefs(): string[]` — `script[src]` and `link[rel=stylesheet][href]` that are neither `http(s)://` nor `mraid.js`. Empty ⇒ single-file build.
  - `toClassicBundle(): void` — removes `type="module"` and `crossorigin` from every `<script>`, moves the largest inline `<script>` to the end of `<body>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/packager/html-builder.test.ts` inside `describe('HtmlBuilder', …)`:

```ts
  describe('single-file helpers', () => {
    const vite =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<script type="module" crossorigin>(function(){window.__bundle=1})();</script>' +
      '<style>body{margin:0}</style></head>' +
      '<body><canvas id="game"></canvas></body></html>'

    it('injectBodyScriptSrc appends a src script at the end of body', () => {
      const b = new HtmlBuilder(vite)
      b.injectBodyScriptSrc('https://cdn.example/sdk.js')
      const html = b.toHtml()
      const at = html.indexOf('<script src="https://cdn.example/sdk.js"></script>')
      expect(at).toBeGreaterThan(html.indexOf('<canvas'))
      expect(at).toBeLessThan(html.indexOf('</body>'))
    })

    it('injectHeadStyle and prependBody land where the splash needs them', () => {
      const b = new HtmlBuilder(vite)
      b.injectHeadStyle('#s{color:red}')
      b.prependBody('<div id="s">splash</div>')
      const html = b.toHtml()
      expect(html.indexOf('<style>#s{color:red}</style>')).toBeLessThan(html.indexOf('</head>'))
      expect(html.indexOf('<div id="s">')).toBeLessThan(html.indexOf('<canvas'))
    })

    it('getLocalRefs ignores http(s) and mraid.js', () => {
      const b = new HtmlBuilder(
        '<html><head><script src="mraid.js"></script>' +
          '<script src="https://x/y.js"></script>' +
          '<link rel="stylesheet" href="style.css"></head>' +
          '<body><script src="game.js"></script></body></html>',
      )
      expect(b.getLocalRefs()).toEqual(['game.js', 'style.css'])
      expect(new HtmlBuilder(vite).getLocalRefs()).toEqual([])
    })

    it('toClassicBundle strips module attrs and moves the bundle after body scripts', () => {
      const b = new HtmlBuilder(vite)
      b.injectBodyScript('window.plbx_html = {};')
      b.toClassicBundle()
      const html = b.toHtml()
      expect(html).not.toContain('type="module"')
      expect(html).not.toContain('crossorigin')
      const bridgeAt = html.indexOf('window.plbx_html = {}')
      const bundleAt = html.indexOf('window.__bundle=1')
      expect(bridgeAt).toBeGreaterThan(-1)
      expect(bundleAt).toBeGreaterThan(bridgeAt)
      expect(bundleAt).toBeLessThan(html.indexOf('</body>'))
      // moved, not copied
      expect(html.split('window.__bundle=1').length).toBe(2)
    })
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/packager/html-builder.test.ts`
Expected: 4 failures, `injectBodyScriptSrc is not a function` etc.

- [ ] **Step 3: Implement**

Add to `src/packager/html-builder.ts` after `injectHeadComment`:

```ts
  /** Inject a <script src="..."> at the END of <body>. Network SDKs that the
   *  spec wants "at the bottom of body, before the developer's own JS" (TikTok)
   *  go here; the single-file path moves the game bundle after it. */
  injectBodyScriptSrc(src: string): void {
    this.$('body').append(`<script src="${src}"></script>\n`)
  }

  /** Append a <style> block to <head>. */
  injectHeadStyle(css: string): void {
    this.$('head').append(`<style>${css}</style>\n`)
  }

  /** Insert raw HTML as the first child of <body> (splash overlay). */
  prependBody(html: string): void {
    this.$('body').prepend(html)
  }

  /**
   * Local script/stylesheet references. A single-file build has none: every
   * asset is already inlined. `mraid.js` and http(s) URLs are container-served
   * by design and do not count.
   */
  getLocalRefs(): string[] {
    const isLocal = (ref: string) =>
      !!ref && !/^https?:\/\//i.test(ref) && ref !== 'mraid.js'
    const refs: string[] = []
    this.$('script[src]').each((_, el) => {
      const s = this.$(el).attr('src') || ''
      if (isLocal(s)) refs.push(s)
    })
    this.$('link[rel="stylesheet"][href]').each((_, el) => {
      const h = this.$(el).attr('href') || ''
      if (isLocal(h)) refs.push(h)
    })
    return refs
  }

  /**
   * Classic-script rewrite for single-file builds.
   *
   * A `file://` container refuses module scripts ("Do not use crossorigin,
   * type=module…"), so the attributes go. Without `type="module"` an inline
   * script is no longer deferred — it runs where it stands, and a Vite build
   * puts it in <head>, before <body> exists. So the bundle (the largest inline
   * script) is moved to the very end of <body>: after the DOM it queries and
   * after every bridge script the adapters appended. cheerio's append() MOVES
   * an existing node, so the bundle is not duplicated.
   */
  toClassicBundle(): void {
    let bundle: ReturnType<CheerioAPI> | null = null
    let bundleLen = -1
    this.$('script').each((_, el) => {
      const $el = this.$(el)
      if ($el.attr('type') === 'module') $el.removeAttr('type')
      $el.removeAttr('crossorigin')
      if ($el.attr('src')) return
      const len = ($el.html() || '').length
      if (len > bundleLen) {
        bundleLen = len
        bundle = $el
      }
    })
    if (bundle) this.$('body').append(bundle)
  }
```

Add the type import at the top: `import type { CheerioAPI } from 'cheerio'`. If `ReturnType<CheerioAPI>` does not type-check, use `let bundle: cheerio.Cheerio<cheerio.Element> | null = null`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run tests/packager/html-builder.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/packager/html-builder.ts tests/packager/html-builder.test.ts
git commit -m "feat(html-builder): single-file helpers — body-end src, head style, local refs, classic bundle"
```

---

### Task 2: Bridge — `is_paused` / `on_pause` / `on_resume` / `on_resize` on every network

**Files:**
- Modify: `src/packager/network-adapters/base.ts` (`buildPlbxBridge`, new `lifecycleSignals`, `BaseAdapter.transform`, `lunaBridge`)
- Test: `tests/packager/plbx-html-surface.test.ts`, create `tests/packager/plbx-html-lifecycle.test.ts`

**Interfaces:**
- Produces on `window.plbx_html` (every network):
  - `is_paused(): boolean`
  - `on_pause(cb: () => void)`, `on_resume(cb: () => void)` — `on_pause` replays immediately when already paused.
  - `on_resize(cb: (w: number, h: number) => void)` — replays immediately with `window.innerWidth/innerHeight`.
  - `set_paused(p: boolean)`, `set_size(w: number, h: number)` — container-side setters the adapters' signal scripts call; games do not.
- Produces in base.ts: `export function lifecycleSignals(mraid: boolean): string`.

- [ ] **Step 1: Extend the surface test**

In `tests/packager/plbx-html-surface.test.ts` add to `REQUIRED_MEMBERS`:

```ts
  'is_paused',
  'on_pause',
  'on_resume',
  'on_resize',
  'set_paused',
  'set_size',
```

and a new `it` at the end of the describe:

```ts
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
```

The fake window in that file needs `innerWidth`/`innerHeight`: add `innerWidth: 320, innerHeight: 480,` to the `win` literal in `bridgeFor`.

- [ ] **Step 2: Write the behavioural test**

Create `tests/packager/plbx-html-lifecycle.test.ts`:

```ts
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
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm vitest run tests/packager/plbx-html-surface.test.ts tests/packager/plbx-html-lifecycle.test.ts`
Expected: FAIL — missing members / `plbx.on_pause is not a function`.

- [ ] **Step 4: Add the members to `buildPlbxBridge`**

In `src/packager/network-adapters/base.ts`, inside the object literal returned by `buildPlbxBridge`, after the `on_mute_change` line add:

```js
  // Container signals: paused = not viewable / page hidden / host said so.
  // Subscribers replay: on_pause fires at once when already paused, on_resize
  // at once with the current size — same late-subscriber rule as on_*.
  // set_paused / set_size are called by the adapter's signal script (below the
  // bridge) and by preview mocks; game code only subscribes.
  _paused: false,
  _pause_subs: [],
  _resume_subs: [],
  _resize_subs: [],
  is_paused: function() { return this._paused; },
  on_pause: function(cb) { if (typeof cb !== 'function') return; this._pause_subs.push(cb); if (this._paused) { try { cb(); } catch (e) {} } },
  on_resume: function(cb) { if (typeof cb !== 'function') return; this._resume_subs.push(cb); },
  on_resize: function(cb) { if (typeof cb !== 'function') return; this._resize_subs.push(cb); try { cb(window.innerWidth, window.innerHeight); } catch (e) {} },
  set_paused: function(p) {
    p = !!p;
    if (p === this._paused) return;
    this._paused = p;
    var subs = p ? this._pause_subs : this._resume_subs;
    for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) {} }
  },
  set_size: function(w, h) {
    for (var i = 0; i < this._resize_subs.length; i++) { try { this._resize_subs[i](w, h); } catch (e) {} }
  },
```

- [ ] **Step 5: Add `lifecycleSignals` and inject it**

After `mraidDeferBootGate()` in base.ts add:

```ts
/**
 * Container → bridge signal wiring for pause/resume/resize. Injected right
 * after the bridge on every network. Page visibility + window resize are the
 * baseline every container has; MRAID adds its own viewability, state and
 * size events (Unity's MRAID never fires sizeChange, so the window listener
 * is what covers it there). Never throws: a stub container missing any of
 * these is a no-op, not a broken ad.
 */
export function lifecycleSignals(mraid: boolean): string {
  const mraidPart = mraid
    ? `
  function attach() {
    try { mraid.addEventListener('viewableChange', function(v) { b.set_paused(!v); }); } catch(e) {}
    try { mraid.addEventListener('stateChange', function(s) { if (s === 'hidden') b.set_paused(true); }); } catch(e) {}
    try { mraid.addEventListener('sizeChange', function(w, h) { b.set_size(w, h); }); } catch(e) {}
    try { if (typeof mraid.isViewable === 'function' && !mraid.isViewable()) b.set_paused(true); } catch(e) {}
  }
  if (window.mraid) {
    try { (mraid.getState && mraid.getState() === 'loading') ? mraid.addEventListener('ready', attach) : attach(); } catch(e) {}
  }`
    : ''
  return `(function() {
  var b = window.plbx_html;
  if (!b || typeof b.set_paused !== 'function') return;
  try { document.addEventListener('visibilitychange', function() { b.set_paused(document.visibilityState === 'hidden'); }); } catch(e) {}
  try { window.addEventListener('resize', function() { b.set_size(window.innerWidth, window.innerHeight); }); } catch(e) {}${mraidPart}
})();`
}
```

In `BaseAdapter.transform`, right after the line `builder.injectBodyScript(bridge + (storeSetup ? '\n' + storeSetup : ''))` add:

```ts
    builder.injectBodyScript(lifecycleSignals(this.networkConfig.mraid))
```

- [ ] **Step 6: Luna forwards its pause/resume**

In `lunaBridge()` replace the two `luna:pause` / `luna:resume` listeners with:

```js
window.addEventListener('luna:pause', function() { try { if (window.cc && cc.game) cc.game.pause(); } catch(e) {} try { window.plbx_html.set_paused(true); } catch(e) {} });
window.addEventListener('luna:resume', function() { try { if (window.cc && cc.game) cc.game.resume(); } catch(e) {} try { window.plbx_html.set_paused(false); } catch(e) {} });
```

- [ ] **Step 7: Run the whole suite**

Run: `pnpm test`
Expected: PASS. If a test asserts an exact count of `<script>` blocks or the byte size of the bridge, update the number with a comment naming this task.

- [ ] **Step 8: Commit**

```bash
git add src/packager/network-adapters/base.ts tests/packager/plbx-html-surface.test.ts tests/packager/plbx-html-lifecycle.test.ts
git commit -m "feat(bridge): is_paused/on_pause/on_resume/on_resize on every network"
```

---

### Task 3: Network SDK tags at the end of `<body>`; Vungle `ad.html`

**Files:**
- Modify: `src/packager/network-adapters/base.ts:~580` (`BaseAdapter.transform`), `src/networks.ts` (vungle)
- Test: `tests/packager/network-adapters.test.ts`, `tests/networks.test.ts`

**Interfaces:**
- Consumes: `HtmlBuilder.injectBodyScriptSrc` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `tests/packager/network-adapters.test.ts` (top-level `describe` block at the end of the file):

```ts
describe('network SDK tag position', () => {
  const html = '<!DOCTYPE html><html><head></head><body><canvas></canvas></body></html>'
  const config = { orientation: 'portrait' as const }

  for (const id of ['tiktok', 'pangle', 'bigo', 'gdt']) {
    it(`${id}: the SDK script sits at the end of body, after the bridge`, () => {
      const b = new HtmlBuilder(html)
      getAdapter(id).transform(b, config)
      const out = b.toHtml()
      const sdkAt = out.indexOf('<script src="https://')
      expect(sdkAt).toBeGreaterThan(out.indexOf('<canvas'))
      expect(sdkAt).toBeLessThan(out.indexOf('</body>'))
      expect(out.indexOf('</head>')).toBeLessThan(sdkAt)
    })
  }

  it('google keeps exitapi.js in head (its meta tags must precede it)', () => {
    const b = new HtmlBuilder(html)
    getAdapter('google').transform(b, config)
    const out = b.toHtml()
    expect(out.indexOf('exitapi.js')).toBeLessThan(out.indexOf('</head>'))
  })
})
```

Add to `tests/networks.test.ts` inside its main describe:

```ts
  it('vungle names the inner HTML ad.html (Adaptive Creative spec)', () => {
    expect(getNetwork('vungle')!.htmlFileName).toBe('ad.html')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/packager/network-adapters.test.ts tests/networks.test.ts`
Expected: the four position tests + vungle test FAIL.

- [ ] **Step 3: Implement**

In `BaseAdapter.transform` replace

```ts
    if (this.networkConfig.sdkUrl) {
      builder.injectHeadScript(this.networkConfig.sdkUrl)
    }
```

with

```ts
    // TikTok's spec: "Place the following code at the bottom of body and
    // before the developer's own JS." Body end it is; the single-file path
    // moves the game bundle after this, the Cocos loader boots later anyway.
    // Google is the exception — ExitApi must follow its ad.size/ad.orientation
    // metas in <head>, and GoogleAdapter owns that order.
    if (this.networkConfig.sdkUrl && this.networkId !== 'google') {
      builder.injectBodyScriptSrc(this.networkConfig.sdkUrl)
    } else if (this.networkConfig.sdkUrl) {
      builder.injectHeadScript(this.networkConfig.sdkUrl)
    }
```

Check `src/packager/network-adapters/google.ts`: if it already injects `exitapi.js` itself, keep only the non-google branch. Run `grep -n sdkUrl src/packager/network-adapters/google.ts` to decide.

In `src/networks.ts` vungle entry add:

```ts
    // Liftoff Monetize "Adaptive Creative" upload: "Name your main html file
    // 'ad.html'". That is the postMessage('download'|'complete') contract our
    // vungleBridge implements — not the MRAID/index.html path PlayTurbo lists.
    htmlFileName: 'ad.html',
```

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: PASS. `tests/packager/network-adapters.test.ts:525,611` only assert the URL is present and stay green. Fix any test that asserted the tag in `<head>` for tiktok/pangle by pointing it at `</body>`.

- [ ] **Step 5: Commit**

```bash
git add src/packager/network-adapters/base.ts src/networks.ts tests/packager/network-adapters.test.ts tests/networks.test.ts
git commit -m "fix(adapters): network SDK tags at body end per TikTok spec; vungle inner file ad.html"
```

---

### Task 4: Single-file packaging path

**Files:**
- Create: `src/packager/single-file.ts`
- Modify: `src/packager/splash.ts` (add `SINGLE_FILE_SPLASH_HOOK_JS`), `src/packager/runtime-loader.ts` (`htmlToPayloadJs`), `src/packager/packager.ts`, `src/types.ts`, `src/index.ts`
- Create: `tests/fixtures/single-file-build/index.html`, `tests/packager/single-file.test.ts`

**Interfaces:**
- Consumes: `HtmlBuilder.getLocalRefs/toClassicBundle/injectHeadStyle/prependBody/injectBodyScript` (Task 1), `buildSplash` (existing).
- Produces:
  - `PackageConfig.input?: 'auto' | 'loader' | 'single-file'` (types.ts).
  - `detectInputKind(builder: HtmlBuilder, explicit?: PackageConfig['input']): 'loader' | 'single-file'` — throws when `'single-file'` is forced on a build with local refs.
  - `applySingleFileRewrite(builder: HtmlBuilder, splash: SplashOptions | null): void`.
  - `SINGLE_FILE_SPLASH_HOOK_JS: string` (splash.ts).
  - `htmlToPayloadJs(fullHtml: string): string` (runtime-loader.ts) — the cheerio strip + inject-helper half of `generatePayloadJs`, which now calls it.

- [ ] **Step 1: Create the fixture**

`tests/fixtures/single-file-build/index.html` — the shape `vite build` + `vite-plugin-singlefile` + `format: 'iife'` produces:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>Single File Fixture</title>
  <script type="module" crossorigin>(function(){"use strict";var c=document.getElementById("game");window.__fixture={canvas:!!c,bridge:typeof window.plbx_html,booted:false};var b=window.plbx_html;if(b&&typeof b.on_game_start==="function"){b.on_game_start(function(){window.__fixture.started=true})}var boot=function(){window.__fixture.booted=true;if(b&&b.game_ready)b.game_ready()};if(typeof window.__plbx_pre_boot==="function"){window.__plbx_pre_boot(boot)}else{boot()}})();</script>
  <style>html,body{margin:0;background:#000}#game{width:100%;height:100%}</style>
</head>
<body>
  <canvas id="game"></canvas>
</body>
</html>
```

- [ ] **Step 2: Write the failing test**

Create `tests/packager/single-file.test.ts`:

```ts
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { afterAll, describe, expect, it } from 'vitest'
import { packageForNetworks } from '../../src/packager/packager'
import { detectInputKind } from '../../src/packager/single-file'
import { HtmlBuilder } from '../../src/packager/html-builder'
import { NETWORKS, getNetwork } from '../../src/networks'
import { getAdapter } from '../../src/packager/network-adapters'

const FIXTURES = join(__dirname, '../fixtures')
const BUILD = join(FIXTURES, 'single-file-build')
const COCOS = join(FIXTURES, 'sample-build')
const OUT = join(FIXTURES, 'single-file-out')

afterAll(() => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
})

/** The primary HTML of a result — the file itself, or the entry inside its ZIP. */
async function primaryHtml(outputPath: string): Promise<string> {
  if (outputPath.endsWith('.html') || outputPath.endsWith('.js')) return readFileSync(outputPath, 'utf-8')
  const zip = await JSZip.loadAsync(readFileSync(outputPath))
  const entry = Object.keys(zip.files).find((f) => f.endsWith('.html'))!
  return zip.files[entry].async('string')
}

describe('input detection', () => {
  it('single-file when nothing local is referenced', () => {
    const b = new HtmlBuilder(readFileSync(join(BUILD, 'index.html'), 'utf-8'))
    expect(detectInputKind(b)).toBe('single-file')
  })
  it('loader when the build references local files (Cocos, plain multi-file)', () => {
    const b = new HtmlBuilder(readFileSync(join(COCOS, 'index.html'), 'utf-8'))
    expect(detectInputKind(b)).toBe('loader')
    expect(detectInputKind(b, 'loader')).toBe('loader')
  })
  it('forcing single-file on a multi-file build throws and names the ref', () => {
    const b = new HtmlBuilder(readFileSync(join(COCOS, 'index.html'), 'utf-8'))
    expect(() => detectInputKind(b, 'single-file')).toThrow(/not a single-file build.*cocos-js\/cc\.js/)
  })
  it('explicit loader on a single-file build is honoured', () => {
    const b = new HtmlBuilder(readFileSync(join(BUILD, 'index.html'), 'utf-8'))
    expect(detectInputKind(b, 'loader')).toBe('loader')
  })
})

describe('single-file packaging — every network', () => {
  const ids = Object.keys(NETWORKS)

  it('emits an artifact per network, within limits', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD,
      outputDir: OUT,
      networks: ids,
      config: { orientation: 'portrait' },
      templateVariables: { assetTitle: 'Fixture Game' },
      packagerVersion: '0.3.13',
    })
    const failed = result.results.filter((r) => !r.outputPath)
    expect(failed.map((r) => r.networkId)).toEqual([])
    for (const r of result.results) {
      expect(existsSync(r.outputPath), r.networkId).toBe(true)
      expect(r.withinLimit, `${r.networkId} ${r.outputSize} > ${r.maxSize}`).toBe(true)
    }
  }, 120_000)

  it('the HTML is a classic script with the bundle after the bridge, no loader', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD, outputDir: OUT, networks: ['applovin', 'mintegral', 'tiktok', 'google', 'luna', 'vungle'],
      config: { orientation: 'portrait' }, templateVariables: { assetTitle: 'Fixture Game' }, packagerVersion: '0.3.13',
    })
    for (const r of result.results) {
      const html = await primaryHtml(r.outputPath)
      expect(html, r.networkId).not.toContain('type="module"')
      expect(html, r.networkId).not.toContain('crossorigin')
      expect(html, r.networkId).not.toContain('__plbx_zip')
      const bridgeAt = html.indexOf('window.plbx_html = window.plbx_html ||')
      const bundleAt = html.indexOf('window.__fixture=')
      expect(bridgeAt, r.networkId).toBeGreaterThan(-1)
      expect(bundleAt, r.networkId).toBeGreaterThan(bridgeAt)
      // network SDK tags (TikTok) precede the bundle
      const sdkAt = html.indexOf('<script src="https://')
      if (sdkAt > -1 && r.networkId !== 'google') expect(sdkAt, r.networkId).toBeLessThan(bundleAt)
      // splash present and armed on game_ready
      expect(html, r.networkId).toContain('id="s"')
      expect(html, r.networkId).toContain('__plbx_splash_hide')
    }
  })

  it('inner names and config.json follow the network rules', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD, outputDir: OUT, networks: ['mintegral', 'vungle', 'snapchat', 'tiktok', 'luna'],
      config: { orientation: 'portrait' }, templateVariables: { assetTitle: 'Fixture Game' }, packagerVersion: '0.3.13',
    })
    const byId = Object.fromEntries(result.results.map((r) => [r.networkId, r]))
    const names = async (p: string) => Object.keys((await JSZip.loadAsync(readFileSync(p))).files)
    expect(byId.mintegral.outputPath.endsWith('Fixture_Game.zip')).toBe(true)
    expect(await names(byId.mintegral.outputPath)).toContain('Fixture_Game.html')
    expect(await names(byId.vungle.outputPath)).toContain('ad.html')
    expect(await names(byId.snapchat.outputPath)).toEqual(expect.arrayContaining(['index.html', 'config.json']))
    const tt = await JSZip.loadAsync(readFileSync(byId.tiktok.outputPath))
    expect(JSON.parse(await tt.files['config.json'].async('string'))).toEqual({ playable_orientation: 1 })
    expect(await names(byId.luna.outputPath)).toEqual(expect.arrayContaining(['source.html', 'luna.json', 'playground.json']))
  })

  it('the bridge block is byte-identical to the Cocos path for the same network', async () => {
    const cfg = { orientation: 'portrait' as const }
    for (const id of ['applovin', 'mintegral', 'facebook']) {
      const single = new HtmlBuilder(readFileSync(join(BUILD, 'index.html'), 'utf-8'))
      const cocos = new HtmlBuilder(readFileSync(join(COCOS, 'index.html'), 'utf-8'))
      getAdapter(id).transform(single, cfg)
      getAdapter(id).transform(cocos, cfg)
      const block = (h: string) => h.match(/<script>window\.plbx_html = [\s\S]*?<\/script>/)?.[0]
      expect(block(single.toHtml()), id).toBeDefined()
      expect(block(single.toHtml()), id).toBe(block(cocos.toHtml()))
    }
  })

  it('molocoV2 launcher payload carries the bundle', async () => {
    const result = await packageForNetworks({
      buildDir: BUILD, outputDir: OUT, networks: ['molocoV2'],
      config: { orientation: 'portrait' }, templateVariables: { assetTitle: 'Fixture Game' }, packagerVersion: '0.3.13',
    })
    const r = result.results[0]
    expect(r.secondaryPath).toBeDefined()
    const payload = readFileSync(r.secondaryPath!, 'utf-8')
    expect(payload).toContain('window.__fixture=')
    expect(payload).not.toContain('__plbx_zip')
    expect(getNetwork('molocoV2')!.launcherPayload!.launcherMaxSize).toBe(3 * 1024)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run tests/packager/single-file.test.ts`
Expected: FAIL — `single-file` module missing.

- [ ] **Step 4: Types + splash hook**

`src/types.ts`, in `PackageConfig` after `appName?: string`:

```ts
  /** Input kind. 'loader' = pack assets + Cocos/engine-agnostic runtime loader
   *  (the only path before 0.3.14). 'single-file' = the build is already one
   *  self-contained index.html (Vite singlefile, IIFE bundle): no loader, the
   *  adapters run on it directly. 'auto' (default) = single-file when the HTML
   *  references no local file. */
  input?: 'auto' | 'loader' | 'single-file'
```

`src/packager/splash.ts`, after `FIRST_FRAME_HOOK_JS`:

```ts
/**
 * Splash hide hook for the single-file path. No Cocos director to watch:
 * the game itself says when the first frame is up by calling
 * plbx_html.game_ready() (SDK: plbx.start()). Wraps whatever game_ready the
 * adapter installed so the network still hears it. 8s ceiling as a net.
 */
export const SINGLE_FILE_SPLASH_HOOK_JS =
  '(function(){var done=false;' +
  'function hide(){if(done)return;done=true;' +
  'try{window.__plbx_splash_hide&&window.__plbx_splash_hide()}catch(e){}}' +
  'var b=window.plbx_html;' +
  'if(b){var gr=b.game_ready;b.game_ready=function(){' +
  'try{if(typeof gr==="function")gr.apply(b,arguments)}catch(e){}hide()}}' +
  'setTimeout(hide,8000);' +
  '})();'
```

- [ ] **Step 5: `single-file.ts`**

Create `src/packager/single-file.ts`:

```ts
import { HtmlBuilder } from './html-builder'
import { buildSplash, SINGLE_FILE_SPLASH_HOOK_JS } from './splash'
import type { SplashOptions } from './splash'
import type { PackageConfig } from '../types'

export type InputKind = 'loader' | 'single-file'

/**
 * Which packaging path a build takes. A single-file build references no local
 * file — everything is inlined — so that is the whole test. Anything else
 * (Cocos web-mobile, a plain multi-file HTML build) goes through the runtime
 * loader as before. An explicit choice wins, except that 'single-file' on a
 * build with local refs is a lie the packager refuses to act on.
 */
export function detectInputKind(
  builder: HtmlBuilder,
  explicit?: PackageConfig['input'],
): InputKind {
  const refs = builder.getLocalRefs()
  if (explicit === 'single-file' && refs.length) {
    throw new Error(
      `not a single-file build: index.html references local file(s) ${refs.join(', ')} — ` +
        `inline them (Vite: vite-plugin-singlefile) or drop config.input`,
    )
  }
  if (explicit && explicit !== 'auto') return explicit
  return refs.length ? 'loader' : 'single-file'
}

/**
 * Turn an adapter-transformed single-file HTML into the shippable artifact:
 * splash overlay (hidden on game_ready), then the classic-bundle rewrite that
 * puts the game after every bridge script. Runs AFTER adapter.transform and
 * the packager's own head injections, so the bundle ends up last.
 */
export function applySingleFileRewrite(
  builder: HtmlBuilder,
  splash: SplashOptions | null,
): void {
  if (splash) {
    const s = buildSplash(splash)
    builder.injectHeadStyle(s.styleCss)
    builder.prependBody(s.bodyHtml)
    builder.injectBodyScript(s.hideJs + SINGLE_FILE_SPLASH_HOOK_JS)
  }
  builder.toClassicBundle()
}
```

- [ ] **Step 6: `htmlToPayloadJs` in runtime-loader.ts**

Change `generatePayloadJs` so the cheerio strip + inject-helper part is a separate exported function:

```ts
export function generatePayloadJs(params: { …unchanged… }): string {
  return htmlToPayloadJs(generateFullHtml(params))
}

/**
 * Wrap a finished single-document HTML as a Moloco V2 payload.js: strip what
 * the launcher already provides, then an IIFE that injects the remaining
 * <head> and <body> into the live document. Engine-agnostic — used by both
 * the loader path (via generatePayloadJs) and the single-file path.
 */
export function htmlToPayloadJs(fullHtml: string): string {
  const $ = cheerio.load(fullHtml, {
    decodeEntities: false,
  } as unknown as Parameters<typeof cheerio.load>[1])
  // …the existing body of generatePayloadJs from `$('script[src="mraid.js"]').remove()` to the final `return (…)` moves here verbatim…
}
```

- [ ] **Step 7: Wire the packager**

In `src/packager/packager.ts`:

1. Imports: `import { detectInputKind, applySingleFileRewrite } from './single-file'` and `import { htmlToPayloadJs } from './runtime-loader'` (extend the existing runtime-loader import).

2. Right after `const baseHtml = readFileSync(htmlPath, 'utf-8')`:

```ts
  const inputKind = detectInputKind(new HtmlBuilder(baseHtml), options.config.input)
  const splashOpts = (cfg: PackageConfig) =>
    cfg.showSplash === false
      ? null
      : splashLogoDataUrl
        ? { customLogo: { dataUrl: splashLogoDataUrl }, logoScale: cfg.splashLogoScale }
        : {}
```

3. In the per-network loop, after the hostile-MP3 head-comment injection (the last `builder.injectHeadComment(...)`) and BEFORE the `warnings` block:

```ts
      // Single-file input: the build IS the artifact. Splash + classic-bundle
      // rewrite happen on the builder itself so every branch below (inline
      // HTML, single-file ZIP, plain ZIP, launcher payload) ships the same
      // document. The loader path leaves the builder alone and lets
      // generateFullHtml rewrite it.
      if (inputKind === 'single-file') {
        applySingleFileRewrite(builder, splashOpts(packageConfig))
      }
```

4. Launcher-payload branch: replace the `packDirectoryToZip … generatePayloadJs({...})` block with

```ts
        const payloadJs =
          inputKind === 'single-file'
            ? htmlToPayloadJs(builder.toHtml())
            : generatePayloadJs({
                originalHtml: builder.toHtml(),
                zipBase64: (await packDirectoryToZip(options.buildDir, undefined, {
                  excludeExtensions: ['.css', '.html'],
                  transform: (path, content) =>
                    shouldRewriteCocosJs(path)
                      ? rewriteCocosJs(content.toString('utf-8'), { selfContained: launcherSelfContained })
                      : null,
                })).toString('base64'),
                cssContent: extractAndMinifyCss(options.buildDir),
                buildDir: options.buildDir,
                loaderMode: launcherLoaderMode,
              })
```

5. Inlined-HTML branch (`if (needsInlinedHtml) {`): replace the `packDirectoryToZip` + `extractAndMinifyCss` + `generateFullHtml` trio with

```ts
          let zipBase64 = ''
          let cssContent = ''
          let finalHtml: string
          if (inputKind === 'single-file') {
            finalHtml = builder.toHtml()
          } else {
            const selfContained = effectiveLoaderMode === 'self-contained'
            const zipBuffer = await packDirectoryToZip(options.buildDir, undefined, {
              excludeExtensions: ['.css', '.html'],
              transform: (path, content) =>
                shouldRewriteCocosJs(path)
                  ? rewriteCocosJs(content.toString('utf-8'), { selfContained })
                  : null,
            })
            zipBase64 = zipBuffer.toString('base64')
            cssContent = extractAndMinifyCss(options.buildDir)
            finalHtml = generateFullHtml({
              originalHtml: builder.toHtml(),
              zipBase64,
              cssContent,
              buildDir: options.buildDir,
              loaderMode: effectiveLoaderMode,
              showSplash: packageConfig.showSplash !== false,
              splashLogoDataUrl,
              splashLogoScale: packageConfig.splashLogoScale,
            })
          }
```

6. In the non-wrap per-encoding branch, force a single encoding for single-file:

```ts
            const encodings =
              inputKind === 'single-file'
                ? (['base64'] as const)
                : resolveInlinedEncodings(packageConfig, effectiveLoaderMode)
```

(`'base64'` here just means "the one finalHtml"; the base122 branch is never entered.)

7. Plain-ZIP branch (`else { // ZIP — copy build dir`): for single-file there is nothing to copy but `index.html`, which is deleted anyway; `cpSync` of a one-file dir is harmless. No change.

8. `src/index.ts`: export `detectInputKind`, `applySingleFileRewrite` from `./packager/single-file`, `SINGLE_FILE_SPLASH_HOOK_JS` from `./packager/splash`, `htmlToPayloadJs` from `./packager/runtime-loader`. Add the four names to `REQUIRED_EXPORTS` in `tests/public-api.test.ts` under a `// added in 0.3.14 — free-stack single-file path` comment.

- [ ] **Step 8: Run the new test, then everything**

Run: `pnpm vitest run tests/packager/single-file.test.ts`
Expected: PASS. If `it('emits an artifact per network…')` reports a network missing an output, read that network's error from `onProgress` (add a temporary `onProgress: (id, s, m) => s === 'error' && console.error(id, m)`) and fix the branch — do not exclude the network.

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green. `tests/engine-agnostic.test.ts` (plain multi-file build) must still take the loader path.

- [ ] **Step 9: Commit**

```bash
git add src/packager/single-file.ts src/packager/splash.ts src/packager/runtime-loader.ts src/packager/packager.ts src/types.ts src/index.ts tests/fixtures/single-file-build tests/packager/single-file.test.ts tests/public-api.test.ts
git commit -m "feat(packager): single-file input path — no loader, same adapters, ZIP rules and naming"
```

---

### Task 5: `@playbox-ai/playable-kit/sdk`

**Files:**
- Create: `src/sdk/index.ts`
- Modify: `tsup.config.ts`, `package.json` (exports, typesVersions, devDependency `jsdom`)
- Create: `tests/sdk/plbx-sdk.test.ts`

**Interfaces:**
- Consumes: bridge members from Task 2 (`on_pause`, `on_resume`, `on_resize`, `set_paused`, `set_size`, `is_paused`) and the existing ones; `window.__plbx_pre_boot`.
- Produces (default export `plbx`, named export `plbx`, type `PlbxEvent`):

```ts
type PlbxEvent = 'pause' | 'resume' | 'resize' | 'mute' | 'game_start' | 'game_close'
plbx.init(boot?: () => void): void
plbx.start(): void
plbx.download(url?: string): void
plbx.game_end(): void
plbx.game_retry(): void
plbx.tap(): void
plbx.report(key: string): void
plbx.log_event(name: string, value?: number): void
plbx.expose(name: string, fn: () => void, label?: string): void
plbx.is_muted(): boolean
plbx.is_paused(): boolean
plbx.is_game_started(): boolean
plbx.is_audio(): boolean
plbx.is_hide_download(): boolean
plbx.set_google_play_url(url: string): void
plbx.set_app_store_url(url: string): void
plbx.on(event: PlbxEvent, cb: (...args: any[]) => void): void
```

- [ ] **Step 1: Add jsdom**

Run: `pnpm add -D jsdom@^25`
Expected: `package.json` devDependencies gains `jsdom`; lockfile updated.

- [ ] **Step 2: Write the failing tests**

Create `tests/sdk/plbx-sdk.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run tests/sdk/plbx-sdk.test.ts`
Expected: FAIL — cannot find module `../../src/sdk/index`.

- [ ] **Step 4: Implement the SDK**

Create `src/sdk/index.ts`:

```ts
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
```

- [ ] **Step 5: Build entries and package exports**

`tsup.config.ts` — add `sdk: 'src/sdk/index.ts'` to `entry`.

`package.json` — add to `exports` (after `"./types"`):

```json
    "./sdk": {
      "import": { "types": "./dist/sdk.d.ts", "default": "./dist/sdk.js" },
      "require": { "types": "./dist/sdk.d.cts", "default": "./dist/sdk.cjs" }
    }
```

and to `typesVersions["*"]`: `"sdk": ["./dist/sdk.d.cts"]`.

- [ ] **Step 6: Public-API guard**

`tests/public-api.test.ts` — add a second describe:

```ts
describe('sdk subpath', () => {
  it('exports plbx as default and named', async () => {
    const mod = await import('../src/sdk/index')
    expect(mod.default).toBe(mod.plbx)
    expect(typeof mod.plbx.init).toBe('function')
  })
})
```

(`window` is touched lazily, so this loads under the node environment.)

- [ ] **Step 7: Run tests, build, check the artifact**

Run: `pnpm vitest run tests/sdk/plbx-sdk.test.ts tests/public-api.test.ts && pnpm build && ls dist/sdk.js dist/sdk.cjs dist/sdk.d.ts && ! grep -q "require(\"fs\")\|from \"fs\"\|from 'fs'" dist/sdk.js && echo "sdk is fs-free"`
Expected: tests PASS, three files listed, `sdk is fs-free`.

- [ ] **Step 8: Commit**

```bash
git add src/sdk/index.ts tsup.config.ts package.json pnpm-lock.yaml tests/sdk/plbx-sdk.test.ts tests/public-api.test.ts
git commit -m "feat(sdk): @playbox-ai/playable-kit/sdk — typed plbx shell over the bridge with boot gate and preview stub"
```

---

### Task 6: Bin — `playable-kit package`

**Files:**
- Create: `src/cli.ts`
- Modify: `tsup.config.ts`, `package.json` (`bin`, `files` unchanged — `dist` already shipped)
- Create: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `packageForNetworks`, `NETWORKS`, `PackageConfig.input` (Task 4).
- Produces: `export async function main(argv: string[], log?: (line: string) => void): Promise<number>`; bin `playable-kit`.

```
playable-kit package [--build dist] [--out dist-networks] [--networks all|a,b,c]
                     [--name "Asset Title"] [--orientation auto|portrait|landscape]
                     [--android URL] [--ios URL] [--input auto|loader|single-file] [--no-splash]
```

- [ ] **Step 1: Write the failing test**

Create `tests/cli.test.ts`:

```ts
import { existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src/cli'

const BUILD = join(__dirname, 'fixtures/single-file-build')
const OUT = join(__dirname, 'fixtures/cli-out')

afterAll(() => { if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true }) })

describe('playable-kit package', () => {
  it('packages the named networks and prints one row each', async () => {
    const lines: string[] = []
    const code = await main(
      ['package', '--build', BUILD, '--out', OUT, '--networks', 'applovin,mintegral', '--name', 'My Game'],
      (l) => lines.push(l),
    )
    expect(code).toBe(0)
    expect(readdirSync(join(OUT, 'applovin'))).toEqual(['My_Game_applovin.html'])
    expect(readdirSync(join(OUT, 'mintegral'))).toEqual(['My_Game_mintegral.zip'])
    const table = lines.join('\n')
    expect(table).toMatch(/applovin\s+\d+\.\d\d MB\s+5\.24 MB\s+My_Game_applovin\.html/)
    expect(table).toMatch(/mintegral\s+\d+\.\d\d MB\s+5\.24 MB\s+My_Game_mintegral\.zip\s+\(My_Game_mintegral\.html\)/)
  })

  it('--networks all covers the registry', async () => {
    const lines: string[] = []
    const code = await main(['package', '--build', BUILD, '--out', OUT, '--networks', 'all', '--name', 'My Game'], (l) => lines.push(l))
    expect(code).toBe(0)
    expect(lines.filter((l) => /\d\.\d\d MB/.test(l)).length).toBeGreaterThanOrEqual(25)
  }, 120_000)

  it('unknown network → exit 1 with the list', async () => {
    const lines: string[] = []
    const code = await main(['package', '--build', BUILD, '--out', OUT, '--networks', 'nope'], (l) => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/Unknown network "nope"\. One of: .*applovin/)
  })

  it('no subcommand → usage, exit 1', async () => {
    const lines: string[] = []
    expect(await main([], (l) => lines.push(l))).toBe(1)
    expect(lines.join('\n')).toContain('playable-kit package')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/cli.test.ts`
Expected: FAIL — module `../src/cli` not found.

- [ ] **Step 3: Implement**

Create `src/cli.ts`:

```ts
import { parseArgs } from 'node:util'
import { resolve, basename } from 'node:path'
import { packageForNetworks } from './packager/packager'
import { NETWORKS } from './networks'
import { KIT_VERSION } from './version'
import type { Orientation, PackageConfig } from './types'

const USAGE = `playable-kit ${KIT_VERSION}

  playable-kit package [--build dist] [--out dist-networks] [--networks all|a,b,c]
                       [--name "Asset Title"] [--orientation auto|portrait|landscape]
                       [--android URL] [--ios URL] [--input auto|loader|single-file] [--no-splash]

Packages a web build (a Vite single-file index.html, a Cocos web-mobile dir, or
any index.html + assets) for every ad network. Output: <out>/<network>/<name>_<network>.<html|zip>.`

const mb = (b: number) => `${(b / 1e6).toFixed(2)} MB`

export async function main(
  argv: string[],
  log: (line: string) => void = (l) => console.log(l),
): Promise<number> {
  const [cmd, ...rest] = argv
  if (cmd !== 'package') {
    log(USAGE)
    return 1
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      build: { type: 'string', default: 'dist' },
      out: { type: 'string', default: 'dist-networks' },
      networks: { type: 'string', default: 'all' },
      name: { type: 'string' },
      orientation: { type: 'string', default: 'auto' },
      android: { type: 'string' },
      ios: { type: 'string' },
      input: { type: 'string', default: 'auto' },
      'no-splash': { type: 'boolean', default: false },
    },
  })

  const buildDir = resolve(values.build!)
  const outputDir = resolve(values.out!)
  const networks =
    values.networks === 'all'
      ? Object.keys(NETWORKS)
      : values.networks!.split(',').map((s) => s.trim()).filter(Boolean)
  for (const n of networks) {
    if (!NETWORKS[n]) {
      log(`Unknown network "${n}". One of: ${Object.keys(NETWORKS).join(', ')}`)
      return 1
    }
  }
  const name = values.name || basename(buildDir)
  const config: PackageConfig = {
    orientation: values.orientation as Orientation,
    storeUrlAndroid: values.android,
    storeUrlIos: values.ios,
    input: values.input as PackageConfig['input'],
    showSplash: !values['no-splash'],
  }

  const errors: string[] = []
  const result = await packageForNetworks({
    buildDir,
    outputDir,
    networks,
    config,
    templateVariables: { assetTitle: name, name: name.replace(/[^A-Za-z0-9._-]+/g, '_') },
    outputTemplate: '{networkId}/{name}_{networkId}.{ext}',
    onProgress: (id, status, message) => {
      if (status === 'error') errors.push(`${id}: ${message}`)
      else if (message) log(`  ${id}: ${message}`)
    },
  })

  log('')
  log('  network            upload    limit    file  (zip entry)')
  log('  ' + '-'.repeat(78))
  let anyOver = false
  for (const r of result.results) {
    if (!r.outputPath) continue
    const over = !r.withinLimit
    if (over) anyOver = true
    const entry = r.outputPath.endsWith('.zip') ? innerEntryLabel(r.networkId, r.outputPath) : ''
    log(
      `  ${r.networkId.padEnd(18)} ${(mb(r.outputSize) + (over ? ' !!' : '')).padEnd(9)} ` +
        `${mb(r.maxSize).padEnd(8)} ${basename(r.outputPath)}${entry}`,
    )
  }
  if (anyOver) log("\n  !! over that network's limit — it will be refused on upload")
  for (const e of errors) log(`  ERROR ${e}`)
  log(`\n  ${outputDir}\n`)
  return errors.length ? 1 : 0
}

/** "(inner.html)" for the table — the inner name mirrors the archive base for
 *  htmlMatchesZipName networks, else the literal / index.html. */
function innerEntryLabel(resultId: string, zipPath: string): string {
  // Result ids carry suffixes for variants ("google-portrait", "facebook-zip").
  const id = Object.keys(NETWORKS).find((n) => resultId === n || resultId.startsWith(`${n}-`))
  const net = id ? NETWORKS[id] : undefined
  const inner = net?.htmlFileName
    ? net.htmlFileName
    : net?.htmlMatchesZipName
      ? basename(zipPath, '.zip') + '.html'
      : 'index.html'
  return `  (${inner})`
}

/* c8 ignore next 3 */
if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
```

If `resolveInnerHtmlName` sanitises the base differently from `{name}` above (Mintegral: `[^A-Za-z0-9_]` → `_`), the test's expected file names tell you — match the packager, not the CLI.

`tsup.config.ts` — export an array: the existing config (add `cli` is NOT added there) plus:

```ts
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    define: { __KIT_VERSION__: JSON.stringify(pkg.version) },
  },
```

`package.json` — add `"bin": { "playable-kit": "./dist/cli.cjs" }`.

- [ ] **Step 4: Run tests, build, smoke the bin**

Run: `pnpm vitest run tests/cli.test.ts && pnpm build && node dist/cli.cjs package --build tests/fixtures/single-file-build --out /tmp/pk-smoke --networks applovin --name Smoke && ls /tmp/pk-smoke/applovin && rm -rf /tmp/pk-smoke`
Expected: PASS; table printed; `Smoke_applovin.html` listed.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tsup.config.ts package.json tests/cli.test.ts
git commit -m "feat(cli): playable-kit package — package any web build for every network from a shell"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md`, `docs/networks/lifecycle-call-direction.md`

- [ ] **Step 1: README**

Add after "## Entry points":

````markdown
- `@playbox-ai/playable-kit/sdk` — game-side SDK for non-Cocos builds
  (Vite / Three.js / Pixi). Browser-only, zero deps.

## Free-stack builds (Vite / Three.js / Pixi)

Build once, package for every network. The build must be ONE self-contained
`index.html` (Vite: `vite-plugin-singlefile` + `build.rollupOptions.output.format = 'iife'`).

```ts
import plbx from '@playbox-ai/playable-kit/sdk'

plbx.set_google_play_url('https://play.google.com/store/apps/details?id=…')
plbx.set_app_store_url('https://apps.apple.com/app/id…')
plbx.on('pause', () => game.pause())
plbx.on('resume', () => game.resume())
plbx.on('mute', (muted) => sound.setMuted(muted))
plbx.init(() => new Game())   // boot runs through the network's boot gate
// after the first frame:   plbx.start()
// CTA:                     plbx.download()
// end card:                plbx.game_end()
```

```
vite build && npx playable-kit package --build dist --out dist-networks --networks all --name "My Game"
```

Without a packaged bridge (`vite dev`, a browser tab) the SDK installs a
preview stub: CTA opens the store URL, pause/resume follow page visibility.
````

- [ ] **Step 2: Lifecycle doc**

Append to `docs/networks/lifecycle-call-direction.md` a section:

```markdown
## Pause, resume, resize — container signals on the bridge

Since 0.3.14 every bridge carries `is_paused()`, `on_pause(cb)`,
`on_resume(cb)`, `on_resize(cb)`. They are fed by `lifecycleSignals()` in
`base.ts`: page visibility + window resize everywhere; MRAID adds
`viewableChange` / `stateChange('hidden')` / `sizeChange`; Luna forwards
`luna:pause` / `luna:resume`. Mintegral's `gameClose` does NOT pause — a paused
ad froze its own end card in production. Late subscribers get the current
state at once (`on_pause` when already paused, `on_resize` with the current
size). `set_paused` / `set_size` are container-side; game code only subscribes.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/networks/lifecycle-call-direction.md
git commit -m "docs: free-stack usage, bridge pause/resume/resize"
```

---

### Task 8: Cocos output parity check (no code — a verification task)

Prove the Cocos path is byte-identical to 0.3.13 except the intended changes: bridge members + `lifecycleSignals` script, and the TikTok/Pangle/Bigo/GDT tag position.

- [ ] **Step 1: Package the Cocos fixture with 0.3.13**

```bash
cd /Users/pavelsamoylenko/Documents/GitHub/Playbox/playable-kit
git worktree add /tmp/kit-0313 v0.3.13 2>/dev/null || git worktree add /tmp/kit-0313 origin/main
cd /tmp/kit-0313 && pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile
pnpm build
node -e "
const {packageForNetworks}=require('./dist/index.cjs');
packageForNetworks({buildDir:'tests/fixtures/sample-build',outputDir:'/tmp/parity/old',networks:['applovin','mintegral','tiktok','facebook','luna'],config:{orientation:'portrait'},packagerVersion:'0.3.13'}).then(r=>console.log(r.results.map(x=>x.networkId+' '+x.outputSize).join('\n')))"
```

- [ ] **Step 2: Package with the branch**

```bash
cd /Users/pavelsamoylenko/Documents/GitHub/Playbox/playable-kit/.worktrees/free-stack-sdk && pnpm build
node -e "
const {packageForNetworks}=require('./dist/index.cjs');
packageForNetworks({buildDir:'tests/fixtures/sample-build',outputDir:'/tmp/parity/new',networks:['applovin','mintegral','tiktok','facebook','luna'],config:{orientation:'portrait'},packagerVersion:'0.3.13'}).then(r=>console.log(r.results.map(x=>x.networkId+' '+x.outputSize).join('\n')))"
```

- [ ] **Step 3: Diff the HTML artifacts**

```bash
for n in applovin facebook; do
  diff <(sed 's/><\?/>\n</g' /tmp/parity/old/$n/index.html) <(sed 's/><\?/>\n</g' /tmp/parity/new/$n/index.html) > /tmp/parity/$n.diff; wc -l /tmp/parity/$n.diff
done
grep -c "is_paused\|lifecycleSignals\|set_paused" /tmp/parity/applovin.diff
```

Expected: every `+` line in the diffs belongs to the bridge object (`_paused`, `is_paused`, `on_pause`, `on_resume`, `on_resize`, `set_paused`, `set_size`) or the `lifecycleSignals` IIFE; `-` lines: none for applovin/facebook. For the ZIP networks unzip both and diff the inner HTML the same way; tiktok additionally shows the `playable-sdk.js` tag moved from `<head>` to before `</body>`. Anything else is a regression — fix it before going on.

- [ ] **Step 4: Clean up**

```bash
cd /Users/pavelsamoylenko/Documents/GitHub/Playbox/playable-kit && git worktree remove --force /tmp/kit-0313; rm -rf /tmp/parity
```

No commit (nothing changed). Record the diff summary in the PR description later.

---

### Task 9: Reference project — migrate `hole-it-c1/recreation` to `plbx`

Works in `/Users/pavelsamoylenko/Documents/GitHub/Playbox/Playables/_Prod/hole-it-c1` (separate git repo). Branch first: `git checkout -b feat/plbx-sdk`.

**Files (all under `recreation/`):**
- Modify: `package.json`, `vite.config.js`, `src/main.js`, `src/App.js`, `src/utils/cta.js`, `src/ui/HUD.js`, `src/ui/EndCard.js`
- Delete: `adNetworks.js`, `scripts/build-networks.mjs`, `src/utils/adLifecycle.js`
- Create: `scripts/validate-networks.mjs`

**Interfaces:**
- Consumes: `@playbox-ai/playable-kit/sdk` (Task 5) linked from the kit worktree; `playable-kit package` bin (Task 6).

- [ ] **Step 1: Swap the dependency**

```bash
cd /Users/pavelsamoylenko/Documents/GitHub/Playbox/Playables/_Prod/hole-it-c1/recreation
npm uninstall @smoud/playable-sdk
npm install ../../../../playable-kit/.worktrees/free-stack-sdk
```

Expected: `package.json` dependencies gain `"@playbox-ai/playable-kit": "file:../../../../playable-kit/.worktrees/free-stack-sdk"` (a symlink into the built worktree; run `pnpm build` in the kit after every kit change).

- [ ] **Step 2: `vite.config.js` — remove the network layer**

Delete: the `adNetworks.js` import, the whole "WHICH AD NETWORK THIS FILE IS FOR" block (`network`, `adNetwork`, `adProtocol`, `GOOGLE_PLAY_URL`, `APP_STORE_URL`, `buildHash`), `moveBundleToBodyEnd`, `adNetworkTags`, and from `define` the five keys `AD_NETWORK`, `AD_PROTOCOL`, `GOOGLE_PLAY_URL`, `APP_STORE_URL`, `BUILD_HASH`. `plugins: [viteSingleFile()]`. Keep `build` (iife, `emptyOutDir: false`, `outDir`), `assetsInclude`, the debug-flag defines. The classic-script rewrite is the packager's now.

- [ ] **Step 3: `src/main.js`**

```js
import plbx from '@playbox-ai/playable-kit/sdk';
import { App } from './App.js';
import { CONFIG, TUNING } from './config.js';

// The store listings. Literal strings on purpose: the packager greps the
// source for set_google_play_url("…") / set_app_store_url("…") and mirrors
// them into the artifact's <head> for validators that read the raw HTML
// (Unity Creative Pack). No region in either — see playable-kit's
// store-url-extractor for why /us/ is rejected.
plbx.set_google_play_url("https://play.google.com/store/apps/details?id=com.rocket.holeit");
plbx.set_app_store_url("https://apps.apple.com/app/id6740699102");

// Boot goes through the network's gate (MRAID viewability, Luna startGame):
// an ad preloaded in a hidden WebView must not build a 0x0 canvas.
plbx.init(() => {
  const app = new App();
  app.start();
  if (import.meta.env.DEV || __DEBUG_TOOLS__) {
    window.__app = app;
    window.__tuning = TUNING;
    window.__cfg = CONFIG.gameplay.holeZones;
  }
});
```

- [ ] **Step 4: `src/App.js`**

Imports: replace `import { sdk } from '@smoud/playable-sdk';` with `import plbx from '@playbox-ai/playable-kit/sdk';`; delete the `adLifecycle.js` import.

`_initAdNetwork()` becomes:

```js
  _initAdNetwork() {
    plbx.on('pause', () => { this._adPaused = true; this.sound.suspend(); });
    plbx.on('resume', () => { this._adPaused = false; this.sound.resume(); });
    // Fires at once with the current state, then on every container toggle.
    plbx.on('mute', (muted) => this.sound.setMasterVolume(muted ? 0 : 1));
  }
```

(The Mintegral parked-until-`gameStart` handshake, the first-touch `gameStart`, and the 5 s safety timer are all gone: the bridge owns the container hooks — see `lifecycle-call-direction.md`.)

Where `sdk.start(); reportReady(...)` was:

```js
    // First frame is up: game_ready on the bridge (Mintegral/TikTok/Moloco
    // hear it), and the packager's splash hides on it.
    plbx.start();
```

In `PHASES.END_CARD`, replace `sdk.finish(); … reportEnd({...});` with:

```js
        // The round is over. Not the CTA — that is plbx.download() in cta.js.
        plbx.game_end();
```

- [ ] **Step 5: `src/utils/cta.js`**

Replace the file's imports and `openStore` with:

```js
import plbx from '@playbox-ai/playable-kit/sdk';
import { t } from './i18n.js';

/** One CTA for every button. The bridge picks the network's own call. */
export function openStore() {
  plbx.download();
}
```

Keep `ctaText`, `CTA_OUTLINE_WIN`, `CTA_OUTLINE_FAIL`. `HUD.js` / `EndCard.js` keep calling `openStore()` — no change there. Delete `src/utils/adLifecycle.js`, `adNetworks.js`, `scripts/build-networks.mjs`.

- [ ] **Step 6: `package.json` scripts + validation script**

Replace `"build:networks"` with:

```json
    "build:networks": "SHIP=1 vite build && playable-kit package --build dist --out dist-networks --networks mintegral,applovin,unity,ironsource,google,smadex,snapchat,liftoff,vungle,gdt,tiktok,pangle,facebook --name \"Playturbo_Hole it\" && node scripts/validate-networks.mjs"
```

(`gdt` is the kit's id for Tencent. `ironsource-dapi` is dropped: the kit has no DAPI target; flag it in the hand-off.)

Create `scripts/validate-networks.mjs`:

```js
// Runs the kit's validator over every artifact build:networks produced.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { validateArtifact, getNetwork, maxSizeForFormat } from '@playbox-ai/playable-kit';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist-networks');
let failed = 0;
for (const networkId of readdirSync(OUT)) {
  const dir = join(OUT, networkId);
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    const zip = file.endsWith('.zip');
    let html;
    if (zip) {
      const z = await JSZip.loadAsync(readFileSync(path));
      const entry = Object.keys(z.files).find((f) => f.endsWith('.html'));
      html = await z.files[entry].async('string');
    } else {
      html = readFileSync(path, 'utf-8');
    }
    const network = getNetwork(networkId);
    const checks = validateArtifact({
      networkId,
      html,
      buildDir: join(ROOT, 'dist'),
      files: [{ kind: zip ? 'zip' : 'html', sizeBytes: statSync(path).size, maxSizeBytes: maxSizeForFormat(network, zip ? 'zip' : 'html') }],
    });
    const bad = checks.filter((c) => c.status === 'failed');
    const warn = checks.filter((c) => c.status === 'warning');
    console.log(`${networkId.padEnd(12)} ${file}  ${bad.length ? 'FAIL' : 'ok'}${warn.length ? `  (${warn.length} warnings)` : ''}`);
    for (const c of bad) console.log(`    ✗ ${c.label}: ${c.detail || ''}`);
    for (const c of warn) console.log(`    ! ${c.label}: ${c.detail || ''}`);
    failed += bad.length;
  }
}
process.exit(failed ? 1 : 0);
```

(`jszip` resolves through the kit's dependency; if npm did not hoist it, `npm install jszip --no-save`.)

- [ ] **Step 7: Build, package, validate**

Run: `npm run build:networks`
Expected: 13 rows, none `!!`; validator prints `ok` for every artifact. Fix what fails — in the kit if it is a rule, in the game if it is a call.

- [ ] **Step 8: Dev-server smoke**

Run: `npm run dev` and open it in a browser. Expected in the console: `[plbx] no network bridge — preview stub…`, the game boots, the CTA opens the Play Store URL in a new tab, backgrounding the tab pauses the music.

- [ ] **Step 9: Commit (no push)**

```bash
git add -A recreation && git commit -m "feat(networks): playable-kit sdk + packager replace smoud and the hand-rolled network layer"
```

---

### Task 10: Verification gate (before any bump)

- [ ] **Step 1: Kit suite green**

Run in the kit worktree: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 2: Reference artifacts vs the smoud build**

For each of the 13 networks compare the new `dist-networks/<n>/` against the smoud-era output (kept in git before Task 9: `git stash` is not needed — `git show HEAD~1:recreation/dist-networks/...` is not tracked, so use the copy in `Playturbo_Hole it_all.zip` in the project root). Check: same archive naming, same inner names (`ad.html` for Vungle, stem for Mintegral), `config.json` present for Snapchat/TikTok, `mraid.js` on every MRAID build, TikTok/Pangle SDK tag before the bundle, Google meta tags, no `type="module"`.

- [ ] **Step 3: Preview mocks**

Serve the artifacts through the extension's preview server (`plbx-cocos-extension` dev preview: Package tab → Preview) or the platform validator (`apps/tools`) for Mintegral, AppLovin, TikTok: lifecycle beacons `game_ready`, `game_end`, CTA must light up; pausing the mock must stop the music.

- [ ] **Step 4: PlayTurbo**

Hand `Playturbo_Hole_it_mintegral.zip` to the user for a PlayTurbo upload (browser action). Record the verdict.

- [ ] **Step 5: Hand-off**

Report: test counts, parity diff summary (Task 8), validator table (Task 9 step 7), PlayTurbo verdict, and the open items — Vungle `ad.html` decision, `ironsource-dapi` dropped, `playable_languages` not emitted. Only then does the user decide on the 0.3.14 bump + release notes + PRs (kit, then the reference project).
