# Free-stack playables: single-file packaging + `plbx` runtime SDK

**Date:** 2026-09-03
**Status:** approved design, not implemented
**Reference project:** a Vite + Three.js + Pixi playable currently built on
`@smoud/playable-sdk` (13 networks, PlayTurbo-verified). It migrates to this
design as the acceptance test.

## Problem

The kit packages Cocos Creator `web-mobile` builds only. `packageForNetworks`
takes a build *directory*, packs every asset into a base64 ZIP and injects the
Cocos runtime loader (`generateFullHtml`, `cocos-js-rewriter`). A Vite /
Three.js / Pixi project already produces one self-contained `index.html`; the
Cocos path cannot consume it, and the game code has no `plbx_html` adapter
that does not import `cc`.

Free-stack teams therefore use `@smoud/playable-sdk`: the ad network is a
build-time constant (`AD_NETWORK`, `AD_PROTOCOL` via bundler `define`), one
full rebuild per network, plus a hand-written `adNetworks.js` (head tags,
shims, ZIP rules) and per-project patches for what smoud gets wrong
(TikTok CTA, Mintegral call direction, double `gameEnd`). Two network
rulebooks — the kit's and smoud's — drift apart.

## Goal

One network rulebook. A free-stack game imports a typed `plbx` SDK, builds
**once**, and the kit packages that single HTML for every network through the
**same adapters, bridge, ZIP rules and naming** the Cocos path uses.
`plbx_html` events, callbacks and `plbx.expose` behave identically in a
Three.js build and in a Cocos build.

## Non-goals

- A Vite plugin. The kit exposes a bin; a plugin can wrap it later.
- Build-time network constants / tree-shaking per network.
- smoud-compatible method names (`sdk.install`, `sdk.finish`). The API is
  the `plbx_html` vocabulary.
- Rewriting the Cocos-side `plbx_html_playable.ts` template. It stays;
  it may later become a re-export of this SDK.
- Any version bump or publish. Nothing ships until the reference project
  is verified end to end (see Verification).

## Design

### 1. Packager: single-file input mode

`packageForNetworks` gains a second input path selected per build directory.

**Detection.** `PackageConfig.input?: 'auto' | 'loader' | 'single-file'`,
default `'auto'`. A single-file build references no local file — every
asset is inlined — so auto picks `single-file` when `index.html` has no
local `<script src>` / stylesheet `href` (`mraid.js` and `http(s)://` URLs
do not count), else `loader` (Cocos web-mobile and any other multi-file
build keep the runtime-loader path exactly as today). An explicit value
wins, except `single-file` forced on a build with local refs, which is an
error naming the offending file.

**Single-file path.** Same loop, same adapters, same output branches. Only
the asset-container step differs:

| Step | Cocos path | Single-file path |
|---|---|---|
| `HtmlBuilder(baseHtml)` + `adapter.transform` | yes | yes, unchanged |
| version banner, store-URL head comments, audio markers | yes | yes |
| `packDirectoryToZip` + `generateFullHtml` (runtime loader) | yes | **skipped** |
| classic-script rewrite | n/a | strip `type="module"` and `crossorigin`; move the bundle `<script>` to the end of `<body>` **after** adapter injections |
| splash | via loader, hidden on first Cocos frame | `buildSplash` markup + CSS, hidden by `plbx_html.game_ready()` (SDK `start()`) |
| forbidden / required strings | yes | yes |
| ZIP wrap, `config.json`, `getZipExtraFiles`, artifact variants, inner-name rules | yes | yes, shared code |

The bundle must run after the bridge: the game's IIFE calls `plbx.init()`
synchronously, so `window.plbx_html` and `__plbx_pre_boot` have to exist by
then. Moving the bundle to the body end after `adapter.transform` guarantees
the order regardless of where the bundler placed it. A `file://` container
refuses module scripts (CORS), so the strip is unconditional; the input must
already be a single IIFE bundle (Vite `format: 'iife'` + singlefile, or the
equivalent). The packager rejects an input with more than one `<script src>`
or any local `src` — that is a multi-file build, not a single file.

**Naming and ZIP rules** stay in the registry/adapters. Rules learned in the
reference project are checked against the kit and added where missing, for
both stacks:

- Mintegral: inner HTML named after the archive, `[^A-Za-z0-9_]` → `_`
  (already `htmlMatchesZipName`).
- Vungle: the kit ships the inner file as `source.html`, the reference
  project as `ad.html` quoting Vungle's upload spec ("Name your main html
  file 'ad.html'"). Resolve against the current Vungle spec before
  implementation; the answer applies to both stacks. `globalThis` shim for
  old Vungle WebViews (es2020 bundles reach for it) — add to the Vungle
  adapter.
- Snapchat `config.json` `{orientation}`; TikTok `{playable_orientation}`
  (present); TikTok `playable_languages` — optional, from
  `PackageConfig.languages` if set.
- Tencent Ads: absent from the registry. Add `tencent` — MRAID, ZIP,
  3 MB cap, marked unverified in the registry comment (protocol is the
  reference project's best guess; their own preview tool is the check).
- Every MRAID build carries `<script src="mraid.js">` (already).
- TikTok/Pangle SDK tag **stays** (official doc: required, "at the bottom of
  body and before the developer's own JS"). Move the injection from `<head>`
  to the body end, before the bundle, on both paths.

### 2. Bridge: pause / resume / resize on every network

`plbx_html` is one API on every network (0.3.13 rule; enforced by
`tests/packager/plbx-html-surface.test.ts`). Four members are added to the
base bridge and therefore to every adapter:

```
is_paused(): boolean
on_pause(cb: () => void): void
on_resume(cb: () => void): void
on_resize(cb: (width: number, height: number) => void): void
```

Semantics match the existing `on_*` members: a late subscriber is called
immediately with the current state (`on_pause` fires at once if already
paused; `on_resize` fires at once with the current size). Callbacks are
guarded individually — one throwing subscriber never skips the rest.

Signal sources per adapter:

| Adapter | pause / resume | resize |
|---|---|---|
| MRAID (AppLovin, Unity, ironSource, …) | `viewableChange` + `stateChange` (`hidden`) | `sizeChange`; Unity: `window.resize` (Unity's MRAID does not fire `sizeChange`) |
| DAPI (ironSource DAPI) | `viewableChange` | `adResized` |
| default (Facebook, Google, Snapchat, Smadex, TikTok, Vungle, …) | `document.visibilitychange` | `window.resize` |
| Mintegral | `on_game_close` stays a separate signal; **no pause on `gameClose`** (a paused ad froze the end card in the reference project) | `window.resize` |
| Luna | existing `luna:pause` / `luna:resume` listeners also notify subscribers (the `cc.game.pause()` calls stay) | `window.resize` |

Volume stays on `is_muted` / `on_mute_change`; no new member.

### 3. `@playbox-ai/playable-kit/sdk`

A new subpath export, browser-only, zero dependencies, no `fs`, built by tsup
as ESM + CJS + IIFE (`window.plbx` for script-tag use). Same package, same
version, same pin as the adapters it talks to.

```ts
import plbx from '@playbox-ai/playable-kit/sdk'

plbx.init(() => new App())        // boot gate, then your boot
plbx.start()                      // first frame rendered → game_ready, splash hides
plbx.download()                   // CTA
plbx.game_end()                   // round over (end card), NOT on CTA
plbx.game_retry()
plbx.tap()
plbx.report(key); plbx.log_event(name, value)
plbx.expose(name, fn, label)
plbx.is_muted(); plbx.is_paused(); plbx.is_game_started()
plbx.set_google_play_url(u); plbx.set_app_store_url(u)
plbx.on('pause' | 'resume' | 'resize' | 'mute' | 'game_start' | 'game_close', cb)
```

`init(boot)`:

1. Resolves the bridge: `window.plbx_html`, else `window.super_html`, else
   installs the **preview stub** — an object with the exact bridge surface
   and preview semantics (`download` → `window.open`, `is_game_started` →
   true, pause/resume from `visibilitychange`, resize from `window.resize`).
   So `vite dev` and a file opened in a browser work without packaging.
2. Runs `boot` through the boot gate: `window.__plbx_pre_boot(boot)` when
   defined, else `boot()` directly. Both gates the adapters define today —
   the MRAID defer-boot and Luna's `startGame` — are reached through that
   one hook, exactly as the Cocos runtime loader reaches them. `boot` runs
   at most once.
3. Wires `on('pause' | 'resume' | 'resize' | 'mute' | 'game_start' |
   'game_close')` onto the bridge's `on_*` members. Subscribing before
   `init` queues; the bridge's immediate-replay rule then delivers state.

`start()`: calls `plbx_html.game_ready()` once and removes the splash
(`FIRST_FRAME_HOOK_JS` equivalent). Mintegral's parked-until-`gameStart`
handshake is the adapter's (`on_game_start`), not the SDK's — the SDK never
calls `window.gameStart`; the container does.

Every method is a guarded pass-through: a missing member on an old bridge
logs once and no-ops, never throws.

### 4. Bin: `playable-kit package`

`bin/playable-kit.js` (tsup entry, `util.parseArgs`, no dependency):

```
npx @playbox-ai/playable-kit package \
  --build dist --out dist-networks \
  --networks all|mintegral,applovin,… \
  --name "Playturbo_Hole it" --orientation auto \
  [--android URL] [--ios URL] [--input single-file|cocos] [--no-splash]
```

Calls `packageForNetworks` with `outputTemplate '{networkId}/{name}_{networkId}.{ext}'`
(sanitised by the existing inner-name rules) and prints one row per
artifact: network, upload size, limit, file, inner entry, `!!` when over the
cap, warnings. Exit code 1 on any packaging error; over-limit is reported,
not fatal (same as the reference script). Works for Cocos dirs too.

### 5. Reference-project migration

In the reference project: remove `@smoud/playable-sdk`, `adNetworks.js`,
`scripts/build-networks.mjs`, the `define` block for `AD_NETWORK` /
`AD_PROTOCOL` / store URLs, `utils/adLifecycle.js`, `utils/cta.js`. Game
code calls `plbx.*`; store URLs via `plbx.set_*_url` at boot. Debug-flag
`define`s stay. `npm run build:networks` becomes `vite build && npx
playable-kit package …`.

## Error handling

- Single-file input with local `<script src>` or a stylesheet link →
  `Error: not a single-file build (…)`, naming the offending tag.
- Missing `index.html` → existing error.
- Forbidden / required string violations → existing abort per network.
- SDK: no bridge → preview stub with a single console line; bridge member
  missing → one warning per member, no-op.

## Testing

Kit (vitest):

- `tests/packager/single-file.test.ts`: a 20-line IIFE fixture
  (`tests/fixtures/single-file-build/index.html`) packaged for **every**
  registry network — file per network exists, size under cap, forbidden /
  required strings hold, module attributes gone, bundle after bridge,
  `config.json` and inner names per network, Google variants, Luna extras.
  Byte-for-byte: the `<head>`/bridge portion equals what the Cocos path
  emits for the same network (diff limited to the payload block).
- `tests/packager/plbx-html-surface.test.ts`: four new members on every
  adapter, immediate replay for late subscribers, throwing subscriber
  isolation.
- `tests/sdk/*.test.ts` (jsdom): boot gate with and without
  `__plbx_pre_boot`, boot-once, preview stub semantics, event wiring, old
  bridge without the new members → no-op.
- `tests/public-api.test.ts`: `sdk` subpath exported.
- bin: one test running the CLI against the fixture, checking the table
  and exit codes.

Reference project:

- Build + package 13 networks; run `validateArtifact` per artifact; compare
  against the current smoud `dist-networks` (head tags, inner names,
  `config.json`); open each in the kit preview (Mintegral, MRAID, TikTok
  mocks) and check lifecycle beacons; PlayTurbo upload for Mintegral.

## Verification gate before any bump

All of the above green, plus one Cocos build packaged on the branch is
byte-identical to 0.3.13 output except the bridge additions and the TikTok
tag position. Only then: patch bump, release notes, PR.

## Open follow-ups (not in this spec)

- Cocos template `plbx_html_playable.ts` → re-export of `/sdk`.
- Vite plugin wrapping the bin.
- `playable_languages` for TikTok from a real config source.
