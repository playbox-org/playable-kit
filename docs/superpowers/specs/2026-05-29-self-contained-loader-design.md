# Self-Contained Loader — Design

**Date:** 2026-05-29
**Status:** Approved (design) — pending implementation plan
**Topic:** Replace SystemJS-interception runtime loader with a super-html-style, cache-native self-contained loader.

## Problem

PLBX-packaged Cocos playables show a **gray screen** in the real AppLovin iOS validator and in production (video+playable combo), while super-html builds of the same game are stable. Root cause (verified on real iOS 18.x device): the current loader depends on the browser environment, and the validator loads the playable in a **null-origin sandbox** (`<iframe sandbox="allow-scripts" srcdoc=...>`, no `allow-same-origin` → `origin="null"`, `baseURI="about:srcdoc"`) on **WebKit**. Two distinct bugs only manifest there:

- **Bug #1 (null-origin, any engine):** SystemJS absolutizes the importmap target `cc` against `about:srcdoc` at parse time → `about:cocos-js/cc.js`, which never matches our ZIP cache keys → engine never loads.
- **Bug #2 (WebKit-only):** the loader emulates cached-asset XHR completion via `dispatchEvent('load')`. WebKit does not route a synthetic `load` event to the `xhr.onload` *attribute* handler on a never-opened XHR; Cocos `Settings.init()` sets `xhr.onload = fn` directly → callback never fires → `cc.game.init()` Promise hangs.

Both were point-patched (`_deAbout`, direct on\* invocation). But the architecture remains environment-dependent: it loads modules through real SystemJS + patches the global browser environment (XHR/fetch/Image/createElement/`new URL`/SystemJS resolve). Any future environment shift can break it again. super-html is stable precisely because it depends on **none** of that.

## Goal

Adopt the super-html mechanism in our own clean, readable code: modules eval'd from an in-memory ZIP cache, specifier resolution by suffix-match (no `new URL`), engine asset I/O via direct-callback shims. Eliminate all dependence on `baseURI` / `origin` / `currentScript` / native event routing, so **bugs #1 and #2 are structurally impossible** rather than patched. Naming mirrors super-html with `super_*` → `plbx_*`.

## How super-html works (reference)

Reverse-engineered from `Playables/_Prod/<project>/build/super-html/applovin/<game>_applovin.html`:

- Assets embedded as one base64 ZIP (`window.__zip`) + inlined JSZip. Unpacked into a flat `window.__res` dict keyed by ZIP path (text as string, binaries as latin1/data-uri strings; a bulk `__res` JSON entry merges small JSON assets).
- **Modules** are `System.register([...], factory)`. super-html ships a forked SystemJS (`@src/system.bundle.js`) — it keeps register/link, but its module-fetch hook is routed to the cache. Module text is run via `super_eval(key) → eval(__res[key]); delete __res[key]`. Identity is established by **eval ordering** (the inline eval's `getRegister()` is consumed in turn), not by `currentScript`/fetch URL.
- **Resolution:** `resolveKey(id)` = suffix-match against `__res` keys; `_SUPER_URL(spec, base)` returns a duck-typed `{href}` for junk (`about:`) bases via last-path-segment substitution. So scheme/origin never matter — only the trailing filename.
- **Asset I/O:** no global `XMLHttpRequest` patch. `cc.assetManager.downloader` handlers for image/font/audio/video read from `getRes`; JSON/text/arraybuffer go through `_XMLLocalRequest`, whose `send()` reads `getRes` and calls **`this.onload()` directly inside a `setTimeout`** — never `dispatchEvent`. This is exactly what avoids bug #2.
- **wasm/emscripten:** `document.currentScript` is never read (eval-from-cache), and wasm bytes come from the overridden `fetch` returning `arrayBuffer()` from cache — no base URL needed.
- **Memory:** `super_eval`/`getRes` `delete` entries after first read.

## Design

### Core decision: keep SystemJS register/link, make it origin-independent

The Cocos build emits `System.register([...], factory)`. Rewriting topological linking is risky and unnecessary — super-html itself kept SystemJS (forked). We keep SystemJS's register/link core and override its I/O hooks so they resolve and load **against a controlled fake base (`https://plbx.local/`), never `document.baseURI`/`location`** — that is what makes it origin-independent in a null-origin srcdoc sandbox. We also keep the request-interception layer (it is *required* for the bootstrap phase, see below), but harden it.

> **As-built note.** An earlier draft proposed *pure* suffix-match resolution with no `new URL` and replacing all request interception with `assetManager.downloader` handlers. TDD against the real WebKit/Chromium null-origin validator disproved both: (1) bare suffix-match returns cache *keys* that are not valid URL bases, which breaks SystemJS's relative-import URL algebra for nested modules; and (2) `cc.game.init()` loads `src/settings.json` and the engine loads asset **bundles** (`assets/*/index.js`) via direct XHR / `<script>` tags **before** `assetManager` exists, so downloader handlers alone never run. The shipped design below reflects what actually boots the game.

| Concern | Legacy (fragile) | Self-contained (shipped) |
|---|---|---|
| Specifier resolve | `_origResolve` against ambient base + `_deAbout` | `_origResolve` against controlled `_fakeBase` + `_deAbout` (normalizes `about:`/`file:` targets); never reads `document.baseURI` |
| Module load / identity | sync-eval from cache + `getRegister()` (eval order) | same — `instantiate` evals from cache, falls through to `_origInstantiate` for virtual `chunks:///` / named-registry modules |
| settings.json / scene / bin / texture | global XHR + `fetch` patch, completion via `dispatchEvent` only | global XHR + `fetch` patch, completion fires listeners via `dispatchEvent` **and invokes `on*` handlers directly** (WebKit bug #2 cure) |
| `<script>` bundles (`assets/*/index.js`) | `createElement('script')` patch → eval from cache | same (`plbx_patch_script`) |
| images | global `Image` patch → data-uri | same |
| fonts | `downloader` font handler (FontFace) | same (`plbx_install_downloader`, fonts only) |
| `new URL` junk base | — | `_PLBX_URL` shim (degenerate `about:`/`file:`/empty base → fake base / `{href}`) |
| off-cache requests | fell through to network | **blocked** (no-network policy, see below) |

### No-network policy (hard requirement)

A self-contained playable must **never** reach the network for its own assets — everything is in the inline ZIP. Every interception point (XHR, `fetch`, `Image`, `<script>`, SystemJS `fetch`) serves from the cache; on a cache **miss** it does NOT fall through to a real request for relative/asset URLs — it resolves to a local 404 / transparent pixel / no-op. Only genuinely external URLs (`http(s)://`, protocol-relative, `mraid.js`) provided by the host/SDK are allowed through. This closes a production leak where a missing asset would issue a real GET to the serving domain (`_isExternalUrl` gate). The regression test asserts **zero** `http(s)` requests during a full boot.

### Naming map (`super_*` → `plbx_*`)

`plbx_boot`, `plbx_boot_engine`, `plbx_patch_system`, `plbx_patch_requests`, `plbx_patch_script`, `plbx_install_downloader`, `plbx_getRes`, `_PLBX_URL`, `_deAbout`, `window.__plbx_res` / `__plbx_bin` / `__plbx_js` / `__plbx_zip`.

### Emitted loader components

1. **unpack** (IIFE, emitted last) — base64 `__plbx_zip` → JSZip → populate `__plbx_res` (text) / `__plbx_bin` (binary base64) / `__plbx_js` (.js subset); on completion `delete __plbx_zip` and call `plbx_boot()`.
2. **`plbx_boot`** — `_installPlbxUrlShim` → `plbx_patch_requests` (XHR+fetch+Image) → `plbx_patch_script` → `plbx_patch_system` (SystemJS) → `plbx_install_downloader` (fonts) → signal `gameReady` (poll) / define `gameStart`/`gameClose` → `plbx_boot_engine()`.
3. **module hooks** (`plbx_patch_system`) — `resolve` (controlled base + `_deAbout`), `instantiate` (sync-eval from cache + `getRegister`, fallthrough to `_origInstantiate`), `fetch` (cache or local 404 for non-external).
4. **request hooks** (`plbx_patch_requests`) — global XHR (direct-`on*` completion = bug #2 cure) + `fetch` + `Image`, all cache-served with the no-network gate.
5. **`plbx_boot_engine`** — runs the deferred inline boot (`window.__plbx_boot` = `System.import(...)` set by `generateFullHtml`), gated by `window.__plbx_pre_boot` (MRAID defer-boot gate).

### File layout

Split `src/packager/runtime-loader.ts` (currently ~1025 lines) into a `loader/` directory, each module emitting its slice of the loader JS string:

- `src/packager/loader/unpack.ts` — `plbx_load`, JSZip runtime, `__plbx_res` population.
- `src/packager/loader/modules.ts` — `resolve`/`instantiate` overrides, `plbx_eval`, `plbx_reg_search`, `_PLBX_URL`.
- `src/packager/loader/assets.ts` — downloader handlers, `plbx_getRes`, `_PlbxLocalRequest`, mime/data-uri helpers.
- `src/packager/loader/lifecycle.ts` — `plbx_boot`, `plbx_boot_engine`, mraid defer-boot gate.
- `src/packager/runtime-loader.ts` — orchestrator: `generateRuntimeLoader(options)` composes the four slices (plus legacy path during transition).

The existing `cocos-js-rewriter` (emscripten/spine base-URL rewriting) and the network adapters are untouched.

### Migration: feature flag with per-network rollback

A transitional flag lets us cut over while keeping an escape hatch per ad network:

- Add to `ProjectSettings` (`src/core/settings.ts`):
  - `loaderMode: 'self-contained' | 'systemjs'` — default `'self-contained'` (the new loader).
  - `legacyLoaderNetworks: string[]` — default `[]`; networks pinned back to the old SystemJS loader.
- Thread through `PackageConfig` → `generateRuntimeLoader(options)`. Per network: effective mode = `legacyLoaderNetworks.includes(networkId) ? 'systemjs' : loaderMode`.
- Keep the current loader code intact behind the `'systemjs'` branch for the transition. Remove it in a later cleanup once the self-contained loader is proven across networks in production.

### Testing

- `tests/integration/ios-validator-sandbox.test.ts` already guards the outcome: boots in a null-origin `srcdoc` sandbox on WebKit + Chromium; verified GREEN with fixes and RED when `src` `_deAbout` is neutralized. It must stay green against the new loader.
- Add a unit test for `plbx_reg_search` suffix-match resolution (exact key, suffix match, ambiguous, miss).
- All existing network-adapter tests and `farmington-e2e` must stay green.
- Both loader modes covered: run the ios-validator test for `loaderMode: 'self-contained'` and (regression) for a `legacyLoaderNetworks`-pinned network.

### Verification before release

Per project memory, verify on the **real AppLovin iOS validator** (video+playable combo) before any version bump — not only in headless tests.

## Risks / open items

1. **SystemJS injection point:** confirm SystemJS performs `<script>` creation/fetch only inside `instantiate`, so overriding `resolve` + `instantiate` fully bypasses script injection (no `createScript` leak). Verify against the build's `system.bundle.js`.
2. **wasm / spine (emscripten):** loaders derive `.wasm`/`.mem` paths from `currentScript`/`import.meta.url`. super-html sidesteps via eval-from-cache + fetch-from-cache. We keep `cocos-js-rewriter`; confirm it composes with the new asset path (fetch-from-cache for wasm bytes).
3. **Audio:** data-uri/blob handling via the downloader handler (mirror super-html's `dataURItoBlob` → `createObjectURL` for video; data-uri for audio).
4. **Blast radius:** the loader is shared by all 25+ networks. The feature flag + the test net + real-validator verification mitigate this.

## Out of scope

- Removing the legacy SystemJS loader (deferred to a post-rollout cleanup).
- Changes to compression, deploy, build-report, or the panel UI beyond surfacing the two new settings.
