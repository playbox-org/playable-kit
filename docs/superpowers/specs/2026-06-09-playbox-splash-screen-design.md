# Playbox Splash Screen — Design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)
**Version target:** v0.2.13

## Problem

Packaged playables briefly show a grey `#333` screen before Cocos renders its
first frame. The grey comes from the original Cocos `index.html` body
(`background-color:#333`) and is visible from page parse until Cocos paints —
covering the base64-ZIP unpack window (all self-contained builds) and, for MRAID
networks, the defer-boot wait. It reads as a broken/ugly flash.

A branded PLBX loading splash already exists but is wired ONLY into the MolocoV2
launcher (`launcher-builder.ts`, `includeSplash` → pulsing PLBX rainbow mark +
PLAYBOX wordmark on a radial-dark backdrop, hidden via `window.__plbx_splash_hide()`).
The standard self-contained HTML path (`generateFullHtml`, used by Unity /
AppLovin / ironSource / Facebook / Moloco-html / etc.) has no splash.

## Goal

Show the PLBX splash from page parse until Cocos's first rendered frame, for any
self-contained HTML build, toggleable from the panel, with the byte cost surfaced
to the user. No network requests (self-contained / no-network policy preserved).

## Non-goals

- No real-progress wiring for the bar (indeterminate animation only).
- No change to the MolocoV2 launcher's existing splash behaviour (hide on
  `game_ready` stays).
- No splash for ZIP-branch networks that copy the raw build dir (Google/Pangle/
  TikTok/Vungle/Mintegral zip path writes `index.html` as-is) — out of scope here;
  the flash there is the same Cocos HTML but the single-file `generateFullHtml`
  path is the one packaged for the affected networks. (If needed later, the same
  splash module can be applied to the ZIP branch.)

## Architecture

Three units plus settings/UI plumbing.

### 1. `src/packager/splash.ts` (new — single source of truth)

Extract the splash markup/style currently inline in `launcher-builder.ts` so both
the launcher and `generateFullHtml` share one definition (DRY).

```
buildSplash(opts: { withProgressBar?: boolean }): {
  styleCss: string;   // contents for a <style> block (#s overlay, logo pulse, bar)
  bodyHtml: string;   // <div id="s">…PLBX logo + PLAYBOX wordmark + bar…</div>
  hideJs: string;     // defines window.__plbx_splash_hide() (fade .5s → remove)
}

splashByteCost(opts?: { withProgressBar?: boolean }): number
  // Buffer.byteLength(styleCss + bodyHtml + hideJs + FIRST_FRAME_HOOK_JS, 'utf8')
  // Splash markup is static → cost is effectively constant; reported as the raw
  // (uncompressed) bytes added to an HTML build — the honest maximum (gzip on the
  // CDN/ad-network shrinks it further).
```

- Reuses the existing `PLBX_LOGO_SVG`. Visual: pulsing rainbow logo + `PLAYBOX`
  wordmark + an **indeterminate** CSS progress bar (animated track, no JS state).
- `#s` overlay: `position:fixed`, full-screen, high `z-index` (above the Cocos
  canvas), radial-dark backdrop, `transition:opacity .5s`; `.h` class → opacity 0.
- `hideJs` defines `window.__plbx_splash_hide()` (idempotent; fade then remove).

### 2. `launcher-builder.ts` refactor

Replace the inline splash construction (current lines ~108-137) with a call into
`buildSplash()`. The launcher keeps its own hide trigger (moloco `game_ready` →
`__plbx_splash_hide`, 12s fallback) — only the markup/style/hideJs source moves.
Behaviour unchanged; covered by existing moloco-v2 tests.

### 3. `runtime-loader.ts` — inject into `generateFullHtml` + first-frame hide

Gated on `loaderOptions`/params carrying `showSplash` (threaded from PackageConfig).

- **Inject style:** append `buildSplash().styleCss` into the `<head>` `<style>`.
- **Inject overlay:** insert `buildSplash().bodyHtml` immediately after the opening
  `<body ...>` tag of the rewritten Cocos HTML (paints before GameDiv).
- **Inject hideJs + first-frame hook** into the loader's injection block, next to
  the `doBoot` path.

**First-frame hide hook (`FIRST_FRAME_HOOK_JS`):** after boot runs, hide on the
first rendered Cocos frame, layered for robustness, NO arbitrary-timer-as-primary:

1. Once `window.cc` is available, register `cc.director.once(cc.Director.EVENT_END_FRAME, __plbx_splash_hide)` (Cocos 3.8 emits this after each rendered frame). The exact event constant is verified against the build's engine during implementation; if `EVENT_END_FRAME` is unavailable, fall back to `EVENT_AFTER_DRAW`.
2. Fallback: a short double-`requestAnimationFrame` after boot.
3. Absolute fallback: `setTimeout(__plbx_splash_hide, 8000)` so the splash can
   never get stuck (e.g. boot that never paints).

The `.5s` fade-out masks any micro-gap between splash removal and the first scene
frame. The splash stays up through the MRAID defer-boot wait (boot — hence the
first frame — only happens after `__plbx_pre_boot` releases).

### 4. Settings / config plumbing

- `shared/types.ts`: `PackageConfig.showSplash?: boolean`.
- `settings.ts`: `showSplash` setting, **default `true`**; `toPackageConfig()`
  (the single source per the f1afc74 fix) forwards it to `PackageConfig`. Both
  config builders (panel handler in `main.ts`, auto-package hook in `hooks.ts`)
  inherit it via `toPackageConfig()`.
- `packager.ts`: pass `showSplash` into `generateFullHtml(params)`.

### 5. IPC + panel UI

- `main.ts`: IPC method `get-splash-info` → `{ bytes: splashByteCost() }`.
- `panels/default.ts` (Package tab): checkbox **“Show Playbox splash”** bound to
  the `showSplash` setting (default checked). Adjacent helper text:
  **“≈ X.X KB added per HTML build”**, where `X.X` = `bytes/1024` from
  `get-splash-info`. When unchecked, `generateFullHtml` injects no splash.

## Data flow

```
panel checkbox ─► settings.showSplash ─► toPackageConfig() ─► PackageConfig.showSplash
                                                                      │
packageForNetworks ─► generateFullHtml({ …, showSplash }) ────────────┘
   showSplash=true → inject buildSplash() style+body + FIRST_FRAME_HOOK_JS
   runtime: parse → #s overlay paints → ZIP unpack → (MRAID: defer-boot wait) →
            __plbx_boot → first Cocos frame → __plbx_splash_hide() (fade → remove)

panel ─IPC get-splash-info─► splashByteCost() ─► “≈ X.X KB added”
```

## Error handling / edge cases

- `__plbx_splash_hide` idempotent and null-safe (no-op if `#s` already gone).
- First-frame hook wrapped in try/catch; absolute 8s timeout guarantees removal.
- `showSplash=false` → zero injection, zero byte cost, no behaviour change.
- No-network: splash is fully inline (SVG + CSS + JS); no external fetch.
- Does not interfere with the MRAID defer-boot gate (orthogonal: gate controls
  *when* boot fires; splash controls *what's shown* until the first frame).

## Testing (TDD)

Unit:
- `splash.test.ts`: `buildSplash({withProgressBar:true})` returns markup containing
  the PLBX logo, `PLAYBOX` wordmark, an indeterminate bar element, and `hideJs`
  defining `window.__plbx_splash_hide`; `splashByteCost()` returns a positive,
  stable number.
- `runtime-loader`/`packager` test: `generateFullHtml({showSplash:true})` output
  contains `id="s"` + splash CSS + the first-frame hook; `{showSplash:false}`
  contains none of them.
- `settings.test.ts`: `toPackageConfig()` forwards `showSplash` (default true;
  explicit false honoured) — regression mirror of the loaderMode plumbing fix.
- `launcher-builder` tests stay green after the refactor (markup parity).

Integration / browser-verify:
- A packaged build with `showSplash:true` shows `#s` at load and removes it after
  Cocos renders (poll: `#s` gone and `cc.director.getScene()` truthy).

## Affected files

`src/packager/splash.ts` (new), `launcher-builder.ts`, `runtime-loader.ts`,
`shared/types.ts`, `settings.ts`, `main.ts`, `hooks.ts` (via toPackageConfig),
`panels/default.ts`; tests `splash.test.ts` (new), `packager.test.ts`,
`settings.test.ts`, integration browser-verify.
