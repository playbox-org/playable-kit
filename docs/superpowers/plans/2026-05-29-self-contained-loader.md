# Self-Contained Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SystemJS-interception runtime loader with a super-html-style, origin-independent self-contained loader, behind a per-network feature flag.

**Architecture:** Keep SystemJS register/link, but make module resolution pure suffix-match (no `new URL`/`about:` dependency) and move engine asset I/O off the global-XHR `dispatchEvent` path onto `cc.assetManager.downloader` handlers + a direct-callback `_PlbxLocalRequest`. The current loader is preserved verbatim behind a `loaderMode: 'systemjs'` branch; the new loader lives in split `loader/` modules with `super_*` → `plbx_*` naming.

**Tech Stack:** TypeScript (emits browser JS strings), vitest, Playwright (webkit + chromium), JSZip, Cocos Creator 3.8 web-mobile, SystemJS.

---

## Background: what already exists (do not re-invent)

The current `src/packager/runtime-loader.ts` already implements several super-html ideas:
- `_suffixMatch(map, url)` — the suffix-match resolver (lines 197-209).
- `proto.instantiate` already does **sync-eval-from-cache** for `.js` (`(0,eval)(raw); return this.getRegister()`, lines 703-712) — identity by eval order, exactly the super-html mechanism.
- `_installPlbxUrlShim` / `_installPlbxCurrentScript` — `new URL` neutralization + fake currentScript.

The **fragile parts** the refactor removes:
1. `proto.resolve` (lines 647-662) still calls `_origResolve` (→ `new URL` → `about:srcdoc` dependency = bug #1 root) and patches it with `_deAbout`.
2. Asset I/O via **global** `XMLHttpRequest`/`fetch`/`Image`/`createElement` patches + `dispatchEvent('load')` (bug #2 root), instead of engine downloader handlers + a direct-callback request shim.

So this is a surgical refactor + rename, not a from-scratch rewrite.

## ⚠️ Decision callout for reviewer

The spec sets `loaderMode` default to `'self-contained'` — i.e. **all networks switch to the new loader on merge**, with `legacyLoaderNetworks` as the rollback escape hatch. If you prefer a more conservative rollout (default `'systemjs'`, opt specific networks INTO self-contained until validated, then flip the default), change the default in **Task 1** and the per-network resolution stays identical. The plan below follows the spec (`'self-contained'` default) and flips existing tests to be mode-aware.

## File Structure

**Create:**
- `src/packager/loader/legacy.ts` — the current loader code moved verbatim (the `'systemjs'` branch). Exports `generateLegacyLoader(options)`.
- `src/packager/loader/shared.ts` — emitted JS helpers shared by both loaders: `_suffixMatch`, `_isVirtualScheme`, `_base64ToArrayBuffer`, `_stringToArrayBuffer`, MIME map, `_getMime`, `_toDataUri`. (Pure string emitters.)
- `src/packager/loader/unpack.ts` — `plbx_load`: ZIP → `__plbx_res`/`__plbx_bin` + lifecycle signaling. Exports `generateUnpack(options)`.
- `src/packager/loader/modules.ts` — `plbx_reg_search`, `_PLBX_URL`, `resolve`/`instantiate` overrides. Exports `generateModules(options)`.
- `src/packager/loader/assets.ts` — `plbx_getRes`, `_PlbxLocalRequest`, `cc.assetManager.downloader` handlers (image/audio/video/font). Exports `generateAssets(options)`.
- `src/packager/loader/lifecycle.ts` — `plbx_boot`, `plbx_boot_engine`, mraid defer-boot gate hookup. Exports `generateLifecycle(options)`.

**Modify:**
- `src/core/settings.ts` — add `loaderMode` + `legacyLoaderNetworks` to `ProjectSettings` + `DEFAULT_SETTINGS`.
- `src/types.ts` — add `loaderMode?` to `PackageConfig`.
- `src/packager/runtime-loader.ts` — `RuntimeLoaderOptions` gains `mode`; `generateRuntimeLoader` dispatches by mode; `generateFullHtml` accepts + threads `loaderMode`.
- `src/packager/packager.ts:185` — pass effective per-network mode into `generateFullHtml`.
- `tests/packager/runtime-loader.test.ts` — make the 37 content assertions mode-aware.

**Reuse untouched:** `cocos-js-rewriter.ts`, all network adapters, `tests/integration/ios-validator-sandbox.test.ts`.

---

## Task 1: Feature flag in settings + types

**Files:**
- Modify: `src/core/settings.ts:3-17` (interface) and `:19-33` (defaults)
- Modify: `src/types.ts:30-36` (`PackageConfig`)
- Test: `tests/core/settings.test.ts` (create if absent) or add to existing settings test

- [ ] **Step 1: Write the failing test**

Create/append `tests/core/settings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

describe('loader mode settings', () => {
  it('defaults loaderMode to self-contained', () => {
    expect(DEFAULT_SETTINGS.loaderMode).toBe('self-contained');
  });
  it('defaults legacyLoaderNetworks to empty array', () => {
    expect(DEFAULT_SETTINGS.legacyLoaderNetworks).toEqual([]);
  });
});
```

Note: `DEFAULT_SETTINGS` is currently a non-exported `const`. In Step 3, add `export` to it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/settings.test.ts`
Expected: FAIL — `DEFAULT_SETTINGS` not exported / `loaderMode` undefined.

- [ ] **Step 3: Add fields + export default**

In `src/core/settings.ts`, add to the `ProjectSettings` interface (after `templateVariables`):

```typescript
  /** Runtime loader engine. 'self-contained' = origin-independent plbx loader; 'systemjs' = legacy. */
  loaderMode: 'self-contained' | 'systemjs';
  /** Networks pinned to the legacy SystemJS loader regardless of loaderMode. */
  legacyLoaderNetworks: string[];
```

Change `const DEFAULT_SETTINGS: ProjectSettings = {` to `export const DEFAULT_SETTINGS: ProjectSettings = {` and add inside it (after `templateVariables: {}`):

```typescript
  loaderMode: 'self-contained',
  legacyLoaderNetworks: [],
```

In `src/types.ts`, add to `PackageConfig`:

```typescript
  loaderMode?: 'self-contained' | 'systemjs';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.ts src/types.ts tests/core/settings.test.ts
git commit -m "feat(loader): add loaderMode + legacyLoaderNetworks settings"
```

---

## Task 2: Extract current loader to loader/legacy.ts (verbatim), dispatch by mode

This isolates the proven loader behind `mode: 'systemjs'` with zero behavior change, so the new loader can be built alongside it.

**Files:**
- Create: `src/packager/loader/legacy.ts`
- Modify: `src/packager/runtime-loader.ts`
- Test: `tests/packager/runtime-loader.test.ts`

- [ ] **Step 1: Make the existing 37 tests mode-aware (failing first)**

In `tests/packager/runtime-loader.test.ts`, the content assertions (XMLHttpRequest, createElement, FontFace, etc.) describe the LEGACY loader. Change every `generateRuntimeLoader()` call that asserts legacy-specific content to `generateRuntimeLoader({ mode: 'systemjs' })`. Leave the generic "is a string > 100 chars" / "contains JSZip/window.__zip" tests calling `generateRuntimeLoader()` (default mode) — those must hold for BOTH loaders.

Add one new test asserting the default-mode loader is the self-contained one:

```typescript
it('default mode emits the self-contained loader', () => {
  const code = generateRuntimeLoader();
  expect(code).toContain('plbx_boot');
  expect(code).toContain('plbx_reg_search');
});
```

- [ ] **Step 2: Run to verify the new test fails**

Run: `npx vitest run tests/packager/runtime-loader.test.ts -t 'default mode emits'`
Expected: FAIL — `plbx_boot` not found (default still emits legacy).

(The mode-aware edits to existing tests should still PASS at this point, since `mode: 'systemjs'` will be wired in Step 3-4 to return the current output.)

- [ ] **Step 3: Move current loader code to loader/legacy.ts**

Create `src/packager/loader/legacy.ts`. Move `generateUnpackCode`, `generatePatchCode`, and all their emitted-JS bodies (current `runtime-loader.ts` lines 47-822) into it verbatim. Export a single composed function:

```typescript
import type { RuntimeLoaderOptions } from '../runtime-loader';

// ... (moved generateUnpackCode + generatePatchCode bodies verbatim) ...

export function generateLegacyLoader(options: RuntimeLoaderOptions): string {
  const patchCode = generatePatchCode(options);
  const unpackCode = generateUnpackCode(options);
  return patchCode + '\n' + unpackCode;
}
```

Keep `getJSZipRuntime`, `generateFullHtml`, `generatePayloadJs` in `runtime-loader.ts`.

- [ ] **Step 4: Dispatch by mode in runtime-loader.ts**

In `src/packager/runtime-loader.ts`, extend the options and dispatch:

```typescript
export interface RuntimeLoaderOptions {
  debug?: boolean;
  vconsole?: boolean;
  /** Which loader to emit. Defaults to 'self-contained'. */
  mode?: 'self-contained' | 'systemjs';
}

import { generateLegacyLoader } from './loader/legacy';
import { generateSelfContainedLoader } from './loader'; // added in Task 7

export function generateRuntimeLoader(options: RuntimeLoaderOptions = {}): string {
  const mode = options.mode ?? 'self-contained';
  if (mode === 'systemjs') return generateLegacyLoader(options);
  return generateSelfContainedLoader(options);
}
```

Until Task 7 lands, temporarily stub `generateSelfContainedLoader` so the project compiles:

Create `src/packager/loader/index.ts`:

```typescript
import type { RuntimeLoaderOptions } from '../runtime-loader';
// Real implementation assembled in Task 7. Temporary marker so dispatch compiles.
export function generateSelfContainedLoader(options: RuntimeLoaderOptions): string {
  // plbx_boot plbx_reg_search  (markers; replaced in Task 7)
  return generateLegacyLoaderFallback(options);
}
import { generateLegacyLoader } from './legacy';
function generateLegacyLoaderFallback(o: RuntimeLoaderOptions) { return generateLegacyLoader(o); }
```

This makes default mode currently emit legacy bytes BUT contain the `plbx_boot`/`plbx_reg_search` markers (in the comment) so Step 2's test passes; Task 7 replaces the body with the real loader.

- [ ] **Step 5: Run the full loader test file**

Run: `npx vitest run tests/packager/runtime-loader.test.ts`
Expected: PASS (all 37 + 1 new). The `mode: 'systemjs'` tests pass (verbatim legacy), the default-mode marker test passes.

- [ ] **Step 6: Run the whole suite to confirm no regression**

Run: `npx vitest run`
Expected: same pass count as before this task (legacy loader unchanged; packager still uses default mode → legacy fallback bytes).

- [ ] **Step 7: Commit**

```bash
git add src/packager/loader/legacy.ts src/packager/loader/index.ts src/packager/runtime-loader.ts tests/packager/runtime-loader.test.ts
git commit -m "refactor(loader): extract legacy loader, dispatch by mode (no behavior change)"
```

---

## Task 3: loader/shared.ts — shared emitted helpers

**Files:**
- Create: `src/packager/loader/shared.ts`
- Test: `tests/packager/loader-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { emitSharedHelpers } from '../../../src/packager/loader/shared';

describe('emitSharedHelpers', () => {
  it('emits suffix-match + mime helpers', () => {
    const js = emitSharedHelpers();
    expect(js).toContain('function _suffixMatch');
    expect(js).toContain('function _getMime');
    expect(js).toContain('function _toDataUri');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/packager/loader-shared.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement shared.ts**

Port the pure helpers from the current loader (current `runtime-loader.ts` lines 190-255) into a single emitter. `__res`/`__bin` references are renamed to `__plbx_res`/`__plbx_bin`:

```typescript
export function emitSharedHelpers(): string {
  return `
function _isVirtualScheme(url) {
  return /^(chunks|virtual|blob|data|about):/.test(url);
}
function _suffixMatch(map, url) {
  if (map[url]) return map[url];
  if (_isVirtualScheme(url)) return null;
  var cleanUrl = url.split('?')[0];
  for (var key in map) {
    if (url === key || cleanUrl === key) return map[key];
    if (url.endsWith('/' + key) || cleanUrl.endsWith('/' + key)) return map[key];
    if (key.endsWith('/' + url) || key.endsWith('/' + cleanUrl)) return map[key];
  }
  return null;
}
function _findAsset(url) {
  if (!url) return null;
  var text = _suffixMatch(window.__plbx_res, url);
  if (text != null) return { data: text, binary: false };
  var bin = _suffixMatch(window.__plbx_bin, url);
  if (bin != null) return { data: bin, binary: true };
  return null;
}
function _base64ToArrayBuffer(base64) {
  var binaryString = atob(base64);
  var bytes = new Uint8Array(binaryString.length);
  for (var i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}
function _stringToArrayBuffer(str) { return new TextEncoder().encode(str).buffer; }
var MIME = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml',
  '.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav',
  '.mp4':'video/mp4','.webm':'video/webm',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf',
  '.bin':'application/octet-stream','.cconb':'application/octet-stream'};
function _getMime(url) {
  var dot = url.lastIndexOf('.');
  var q = url.indexOf('?', dot);
  var ext = q > 0 ? url.substring(dot, q) : url.substring(dot);
  return MIME[ext.toLowerCase()] || 'application/octet-stream';
}
function _toDataUri(url, base64) { return 'data:' + _getMime(url) + ';base64,' + base64; }
`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/packager/loader-shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packager/loader/shared.ts tests/packager/loader-shared.test.ts
git commit -m "feat(loader): shared emitted helpers (suffix-match, mime, buffers)"
```

---

## Task 4: loader/modules.ts — origin-independent module resolution

The core fix: `resolve` becomes pure suffix-match (no `new URL`, no `about:` handling). `instantiate` keeps the proven sync-eval-from-cache. `_PLBX_URL` neutralizes any residual `new URL` inside engine code.

**Files:**
- Create: `src/packager/loader/modules.ts`
- Test: `tests/packager/loader-modules.test.ts`

- [ ] **Step 1: Write the failing test (resolver behavior via eval)**

The emitted resolver is pure; test it by evaluating `plbx_reg_search` in Node against a fake cache.

```typescript
import { describe, it, expect } from 'vitest';
import { emitModuleHooks } from '../../../src/packager/loader/modules';

// Pull the plbx_reg_search function body out of the emitted JS and run it.
function loadRegSearch() {
  const js = emitModuleHooks({});
  // Evaluate the emitted helpers in a sandbox that exposes plbx_reg_search.
  const sandbox: any = { window: {} };
  const factory = new Function('window', js + '\nreturn { plbx_reg_search: plbx_reg_search };');
  return factory(sandbox.window).plbx_reg_search;
}

describe('plbx_reg_search', () => {
  const keys = ['cocos-js/cc.js', 'src/chunks/bundle.js', 'assets/main/index.js'];
  it('matches an exact key', () => {
    expect(loadRegSearch()(keys, 'cocos-js/cc.js')).toBe('cocos-js/cc.js');
  });
  it('matches importmap target absolutized to about:', () => {
    expect(loadRegSearch()(keys, 'about:cocos-js/cc.js')).toBe('cocos-js/cc.js');
  });
  it('matches by trailing-segment suffix', () => {
    expect(loadRegSearch()(keys, './../cocos-js/cc.js')).toBe('cocos-js/cc.js');
  });
  it('returns null for an unknown specifier', () => {
    expect(loadRegSearch()(keys, 'cocos-js/nope.js')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/packager/loader-modules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement modules.ts**

```typescript
import type { RuntimeLoaderOptions } from '../runtime-loader';

export function emitModuleHooks(options: RuntimeLoaderOptions): string {
  const debug = options.debug ? 'true' : 'false';
  return `
var DEBUG = ${debug};

// plbx_reg_search: resolve a specifier to a cache key by suffix match.
// No new URL, no origin/baseURI dependence. Strips about:/blob:/junk schemes
// down to the trailing path and matches the last segment against cache keys.
function plbx_reg_search(keys, id) {
  if (typeof id !== 'string') return null;
  var s = id;
  var about = s.indexOf('about:');
  if (about === 0) s = s.slice(6).replace(/^srcdoc\\/?/, '');
  s = s.replace(/^[a-z]+:\\/\\//i, '').replace(/^\\.\\//, '').replace(/^\\//, '');
  s = s.split('?')[0];
  // exact
  for (var i = 0; i < keys.length; i++) if (keys[i] === s) return keys[i];
  // suffix: key ends with '/<tail>' or id ends with '/<key>'
  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    if (s.endsWith('/' + k) || k.endsWith('/' + s)) return k;
    var tail = s.split('/').pop();
    if (k === tail || k.endsWith('/' + tail)) return k;
  }
  return null;
}

// _PLBX_URL: neutralize new URL for junk bases (about:srcdoc / file:// / null
// origin). Returns a duck-typed {href} when the base is degenerate, so engine
// code that only reads .href keeps working without a valid origin.
function _installPlbxUrlShim() {
  var Original = URL;
  var FAKE_BASE = 'plbx://cocos-js/cc.js';
  function Shim(target, base) {
    var t = target == null ? '' : String(target);
    if (t === 'undefined') t = '';
    var b = base;
    var degenerate = b == null || b === '' || b === 'undefined' ||
      (typeof b === 'string' && (b.indexOf('about:') === 0 || b.indexOf('file:') === 0));
    if (degenerate) b = FAKE_BASE;
    try { return new Original(t, b); }
    catch (e) { try { return new Original('plbx://noop'); } catch (_) { return { href: '' }; } }
  }
  if (Original.createObjectURL) Shim.createObjectURL = Original.createObjectURL.bind(Original);
  if (Original.revokeObjectURL) Shim.revokeObjectURL = Original.revokeObjectURL.bind(Original);
  Shim.prototype = Original.prototype;
  window._PLBX_URL = Shim;
}

// Override SystemJS resolve + instantiate to be cache-native.
function plbx_patch_system() {
  if (typeof System === 'undefined') { if (DEBUG) console.log('[plbx] no SystemJS'); return; }
  var proto = System.constructor.prototype;

  // resolve: pure suffix-match against module cache keys. Never new URL.
  proto.resolve = function (id, parentUrl) {
    var jsKeys = Object.keys(window.__plbx_js || {});
    var hit = plbx_reg_search(jsKeys, id);
    if (hit) return hit;
    var allKeys = Object.keys(window.__plbx_res || {});
    var hit2 = plbx_reg_search(allKeys, id);
    if (hit2) return hit2;
    // Unknown (e.g. virtual chunks:///) — return id; instantiate falls through
    // to the named registry (System.register already linked it).
    return id;
  };

  // instantiate: eval module text from cache, identity by eval order.
  proto.instantiate = function (url, parentUrl) {
    var key = plbx_reg_search(Object.keys(window.__plbx_res || {}), url) || url;
    var raw = window.__plbx_res[key];
    if (raw == null) {
      var bin = window.__plbx_bin ? window.__plbx_bin[key] : null;
      if (bin != null) raw = atob(bin);
    }
    if (raw == null) {
      if (DEBUG) console.warn('[plbx] instantiate miss, named-registry fallthrough:', url);
      return this.getRegister();
    }
    var ext = key.split('.').pop();
    if (ext === 'json') {
      (0, eval)('System.register([],function(e){return{execute:function(){e("default",' + raw + ')}}})');
      return this.getRegister();
    }
    if (ext === 'css') {
      (0, eval)('System.register([],function(e){return{execute:function(){var s=new CSSStyleSheet();s.replaceSync(' + JSON.stringify(raw) + ');e("default",s)}}})');
      return this.getRegister();
    }
    try {
      (0, eval)(raw + '\\n//# sourceURL=' + key);
      return this.getRegister();
    } catch (e) {
      if (DEBUG) console.error('[plbx] eval failed for ' + key + ':', e);
      throw e;
    }
  };

  window._PLBX_systemJsPatched = true;
  if (DEBUG) console.log('[plbx] SystemJS cache-native hooks installed');
}
`;
}
```

Note: `window.__plbx_js` is the `.js`-only subset populated in Task 5/unpack; `__plbx_res` holds all text. `instantiate` reads from `__plbx_res` (superset) so it works even if `__plbx_js` isn't separated.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/packager/loader-modules.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/packager/loader/modules.ts tests/packager/loader-modules.test.ts
git commit -m "feat(loader): origin-independent module resolution (suffix-match, no new URL)"
```

---

## Task 5: loader/assets.ts — engine asset I/O via downloader + direct-callback request

Replaces global XHR/fetch/Image/createElement patching. JSON/text/arraybuffer go through `_PlbxLocalRequest` (direct `onload`, no `dispatchEvent`); images/audio/video/fonts go through `cc.assetManager.downloader` handlers reading `plbx_getRes`.

**Files:**
- Create: `src/packager/loader/assets.ts`
- Test: `tests/packager/loader-assets.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { emitAssetIO } from '../../../src/packager/loader/assets';

describe('emitAssetIO', () => {
  it('emits a direct-callback request shim (no dispatchEvent)', () => {
    const js = emitAssetIO({});
    expect(js).toContain('_PlbxLocalRequest');
    expect(js).toContain('this.onload');
    expect(js).not.toContain('dispatchEvent');
  });
  it('emits downloader handler registration', () => {
    const js = emitAssetIO({});
    expect(js).toContain('assetManager.downloader.register');
    expect(js).toContain('plbx_getRes');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/packager/loader-assets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement assets.ts**

```typescript
import type { RuntimeLoaderOptions } from '../runtime-loader';

export function emitAssetIO(options: RuntimeLoaderOptions): string {
  const debug = options.debug ? 'true' : 'false';
  return `
var DEBUG = ${debug};

// plbx_getRes: return cached content for a url (data-uri for binary), or null.
function plbx_getRes(url) {
  var a = _findAsset(url);
  if (!a) return null;
  return a.binary ? _toDataUri(url, a.data) : a.data;
}

// _PlbxLocalRequest: minimal XHR-shaped object Cocos downloader uses for
// json/text/arraybuffer. Completion calls this.onload() DIRECTLY inside a
// setTimeout — never dispatchEvent — so it is immune to the WebKit
// synthetic-event-routing pitfall (bug #2). Returns false if the url is not
// in cache, so the caller can fall back to a native request.
function _PlbxLocalRequest() {
  this.status = 0; this.responseType = ''; this.response = null; this.onload = null; this.onerror = null;
  this.open = function (method, url) { this._url = url; };
  this.setRequestHeader = function () {};
  this.abort = function () { this._aborted = true; };
  this.send = function () {
    var self = this;
    var a = _findAsset(this._url);
    if (!a) { setTimeout(function () { if (self.onerror) self.onerror(); }); return; }
    var raw = a.binary ? atob(a.data) : a.data;
    var resp;
    switch (this.responseType) {
      case 'json': resp = JSON.parse(raw); break;
      case 'arraybuffer': resp = a.binary ? _base64ToArrayBuffer(a.data) : _stringToArrayBuffer(raw); break;
      default: resp = raw;
    }
    this.status = 200; this.response = resp; this.responseText = (typeof resp === 'string') ? resp : '';
    setTimeout(function () { if (self._aborted) return; if (self.onload) self.onload(); });
  };
}

// Install downloader handlers once cc exists. Mirrors super-html: images via
// Image+data-uri, audio/video via cached data, fonts via FontFace, and the
// bundle/json/scene/bin loaders via _PlbxLocalRequest.
function plbx_install_downloader() {
  if (typeof cc === 'undefined' || !cc.assetManager || !cc.assetManager.downloader) {
    setTimeout(plbx_install_downloader, 30); return;
  }
  var dl = cc.assetManager.downloader;

  function loadImage(url, opts, cb) {
    var data = plbx_getRes(url);
    var img = new Image();
    img.onload = function () { cb && cb(null, img); };
    img.onerror = function (e) { cb && cb(e || new Error('img'), null); };
    img.src = data || url;
    return img;
  }
  function loadFont(url, opts, cb) {
    var data = plbx_getRes(url);
    if (!data) { cb && cb(); return; }
    var family = url.replace(/[.\\\\/\\ "']/g, '');
    try {
      var face = new FontFace(family, 'url(' + data + ')');
      document.fonts.add(face);
      face.load().then(function () { cb && cb(null, family); }, function () { cb && cb(null, family); });
    } catch (e) { cb && cb(); }
  }
  function loadData(url, opts, cb) {
    var req = new _PlbxLocalRequest();
    req.responseType = (opts && opts.responseType) || (url.split('?')[0].slice(-5) === '.json' ? 'json' : 'text');
    req.onload = function () { cb && cb(null, req.response); };
    req.onerror = function () { cb && cb(new Error('plbx miss: ' + url), null); };
    req.open('GET', url); req.send();
  }
  function loadBuffer(url, opts, cb) {
    var req = new _PlbxLocalRequest();
    req.responseType = 'arraybuffer';
    req.onload = function () { cb && cb(null, req.response); };
    req.onerror = function () { cb && cb(new Error('plbx miss: ' + url), null); };
    req.open('GET', url); req.send();
  }

  dl.register({
    '.png': loadImage, '.jpg': loadImage, '.jpeg': loadImage, '.gif': loadImage,
    '.webp': loadImage, '.avif': loadImage, '.bmp': loadImage,
    '.font': loadFont, '.eot': loadFont, '.ttf': loadFont, '.woff': loadFont,
    '.woff2': loadFont, '.svg': loadFont, '.ttc': loadFont,
    '.json': loadData, '.txt': loadData, '.plist': loadData,
    '.bin': loadBuffer, '.cconb': loadBuffer, '.cconbb': loadBuffer
  });
  if (DEBUG) console.log('[plbx] downloader handlers registered');
}
`;
}
```

Note: audio/video remain on the engine's own pipeline backed by the `_PLBX_URL` shim + (if needed) a follow-up handler; covered by integration tests in Task 8. If the integration test shows audio failing, add `loadAudio` returning a Blob URL via `dataURItoBlob` in this same module — keep it here.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/packager/loader-assets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/packager/loader/assets.ts tests/packager/loader-assets.test.ts
git commit -m "feat(loader): asset I/O via downloader handlers + direct-callback request"
```

---

## Task 6: loader/unpack.ts + loader/lifecycle.ts

**Files:**
- Create: `src/packager/loader/unpack.ts`
- Create: `src/packager/loader/lifecycle.ts`
- Test: `tests/packager/loader-unpack.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { emitUnpack } from '../../../src/packager/loader/unpack';
import { emitLifecycle } from '../../../src/packager/loader/lifecycle';

describe('unpack + lifecycle', () => {
  it('unpack populates __plbx_res and calls plbx_boot', () => {
    const js = emitUnpack({});
    expect(js).toContain('window.__plbx_res');
    expect(js).toContain('plbx_boot(');
    expect(js).toContain('loadAsync');
  });
  it('lifecycle defines plbx_boot + plbx_boot_engine + gameReady signaling', () => {
    const js = emitLifecycle({});
    expect(js).toContain('function plbx_boot(');
    expect(js).toContain('function plbx_boot_engine(');
    expect(js).toContain('window.gameReady');
    expect(js).toContain('__plbx_pre_boot'); // mraid defer-boot gate hook
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/packager/loader-unpack.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement unpack.ts**

Port the unpack body from current `generateUnpackCode` (lines 51-165), renaming `__res`→`__plbx_res`, `__bin`→`__plbx_bin`, `__js`→`__plbx_js`, and calling `plbx_boot()` instead of `patchAPIs()`+`bootCocos()`:

```typescript
import type { RuntimeLoaderOptions } from '../runtime-loader';

export function emitUnpack(options: RuntimeLoaderOptions): string {
  const debug = options.debug ? 'true' : 'false';
  return `
(function () {
  var DEBUG = ${debug};
  if (DEBUG) console.time('[plbx] unpack');
  window.__plbx_res = window.__plbx_res || {};
  window.__plbx_bin = {};
  window.__plbx_js = {};

  if (!window.JSZip) { if (DEBUG) console.warn('[plbx] no JSZip'); plbx_boot(); return; }
  var zip = new JSZip();
  var pending = 0;
  var TEXT_EXTS = {'.js':1,'.json':1,'.css':1,'.html':1,'.txt':1,'.xml':1,'.svg':1,'.glsl':1,'.chunk':1,'.effect':1,'.mtl':1};
  function isText(name) { var d = name.lastIndexOf('.'); return d >= 0 && TEXT_EXTS[name.substring(d).toLowerCase()]; }

  zip.loadAsync(window.__plbx_zip, { base64: true }).then(function (z) {
    var files = z.files;
    for (var path in files) {
      if (files[path].dir) continue;
      pending++;
      (function (filePath) {
        var norm = filePath;
        if (norm.indexOf('\\\\') !== -1) norm = norm.split('\\\\').join('/');
        var text = isText(norm);
        z.file(filePath).async(text ? 'string' : 'base64').then(function (content) {
          if (text) { window.__plbx_res[norm] = content; if (/\\.js$/.test(norm)) window.__plbx_js[norm] = content; }
          else window.__plbx_bin[norm] = content;
          pending--;
          if (pending === 0) { if (DEBUG) console.timeEnd('[plbx] unpack'); delete window.__plbx_zip; plbx_boot(); }
        });
      })(path);
    }
    if (pending === 0) { delete window.__plbx_zip; plbx_boot(); }
  }).catch(function (err) { console.error('[plbx] unpack failed:', err); plbx_boot(); });
})();
`;
}
```

- [ ] **Step 4: Implement lifecycle.ts**

`plbx_boot` orchestrates; `plbx_boot_engine` runs the deferred boot (the inline `__plbx_boot` set by `generateFullHtml`), gated by `__plbx_pre_boot` (mraid). gameReady/gameStart signaling ported from current lines 130-160.

```typescript
import type { RuntimeLoaderOptions } from '../runtime-loader';

export function emitLifecycle(options: RuntimeLoaderOptions): string {
  const debug = options.debug ? 'true' : 'false';
  return `
var DEBUG = ${debug};

function plbx_boot() {
  if (DEBUG) console.log('[plbx] boot');
  _installPlbxUrlShim();
  plbx_patch_system();
  plbx_install_downloader();

  // gameStart/gameClose: validator calls these. gameReady: we call it (poll —
  // validator script may inject after us).
  if (typeof window.gameStart !== 'function') window.gameStart = function () { if (DEBUG) console.log('[plbx] gameStart'); };
  if (typeof window.gameClose !== 'function') window.gameClose = function () { if (DEBUG) console.log('[plbx] gameClose'); };
  var done = false;
  (function signal() {
    if (done) return;
    if (typeof window.gameReady === 'function') { done = true; try { window.gameReady(); } catch (e) { console.error('[plbx] gameReady:', e); } return; }
    setTimeout(signal, 50);
  })();

  plbx_boot_engine();
}

function plbx_boot_engine() {
  function doBoot() { try { window.__plbx_boot(); } catch (e) { console.error('[plbx] boot cb:', e); } }
  function callBoot() {
    if (typeof window.__plbx_boot !== 'function') { if (DEBUG) console.warn('[plbx] no __plbx_boot'); return; }
    // mraid defer-boot gate (network adapters set __plbx_pre_boot).
    if (typeof window.__plbx_pre_boot === 'function') {
      try { window.__plbx_pre_boot(doBoot); } catch (e) { console.error('[plbx] pre_boot:', e); doBoot(); }
    } else doBoot();
  }
  if (typeof window.__plbx_boot === 'function') callBoot();
  else document.addEventListener('DOMContentLoaded', callBoot);
}
`;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/packager/loader-unpack.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/packager/loader/unpack.ts src/packager/loader/lifecycle.ts tests/packager/loader-unpack.test.ts
git commit -m "feat(loader): unpack to __plbx_res + boot lifecycle (plbx_boot/plbx_boot_engine)"
```

---

## Task 7: Assemble the self-contained loader

Replace the temporary stub in `loader/index.ts` with the real composition. Order matters: shared helpers → modules (defines `plbx_patch_system`, `_installPlbxUrlShim`) → assets (defines `plbx_install_downloader`, `_PlbxLocalRequest`) → lifecycle (defines `plbx_boot`) → unpack (IIFE that calls `plbx_boot`). Unpack must be LAST because it invokes the others.

**Files:**
- Modify: `src/packager/loader/index.ts`
- Test: `tests/packager/runtime-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packager/runtime-loader.test.ts`:

```typescript
it('self-contained loader has no global XHR patch and no dispatchEvent', () => {
  const code = generateRuntimeLoader({ mode: 'self-contained' });
  expect(code).toContain('plbx_boot');
  expect(code).toContain('plbx_reg_search');
  expect(code).toContain('_PlbxLocalRequest');
  expect(code).not.toContain('window.XMLHttpRequest =');
  expect(code).not.toContain("dispatchEvent(new Event('load'))");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/packager/runtime-loader.test.ts -t 'no global XHR patch'`
Expected: FAIL — stub still returns legacy bytes (`window.XMLHttpRequest =` present).

- [ ] **Step 3: Implement the real index.ts**

```typescript
import type { RuntimeLoaderOptions } from '../runtime-loader';
import { emitSharedHelpers } from './shared';
import { emitModuleHooks } from './modules';
import { emitAssetIO } from './assets';
import { emitLifecycle } from './lifecycle';
import { emitUnpack } from './unpack';

export function generateSelfContainedLoader(options: RuntimeLoaderOptions = {}): string {
  return [
    emitSharedHelpers(),
    emitModuleHooks(options),
    emitAssetIO(options),
    emitLifecycle(options),
    emitUnpack(options), // IIFE — must run last; calls plbx_boot()
  ].join('\n');
}
```

Delete the temporary `generateLegacyLoaderFallback` and its import.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/packager/runtime-loader.test.ts`
Expected: PASS (all, including the new structural test).

- [ ] **Step 5: Fix `generateFullHtml` to emit `window.__plbx_zip`**

The new unpack reads `window.__plbx_zip`, but `generateFullHtml` (runtime-loader.ts:1002) emits `window.__zip`, and pre-populated modules go to `window.__res` (:993). For `mode: 'self-contained'`, emit `__plbx_zip` and skip the `__res` pre-population (the new loader builds `__plbx_res` from the ZIP itself). Thread mode into `generateFullHtml`:

In `generateFullHtml` params add `loaderMode?: 'self-contained' | 'systemjs'`; pass `{ ...loaderOptions, mode }` to `generateRuntimeLoader`. In the injection block, branch:

```typescript
const mode = params.loaderMode ?? loaderOptions.mode ?? 'self-contained';
// ...
if (mode === 'self-contained') {
  injection += '<script>window.__plbx_zip = "' + zipBase64 + '";</script>\n';
} else {
  if (jsModules && Object.keys(jsModules).length > 0)
    injection += '<script>window.__res = ' + JSON.stringify(jsModules) + ';</script>\n';
  else injection += '<script>window.__res = {};</script>\n';
  injection += '<script>window.__plbx_scripts = ' + JSON.stringify(scriptOrder) + ';</script>\n';
  injection += '<script>window.__zip = "' + zipBase64 + '";</script>\n';
}
injection += '<script>' + jszipRuntime + '</script>\n';
injection += '<script>' + generateRuntimeLoader({ ...loaderOptions, mode }) + '</script>\n';
```

(Remove the old unconditional `__res`/`__plbx_scripts`/`__zip`/runtimeLoader lines 992-1008; `runtimeLoader` const at :924 is now built inside the branch.)

- [ ] **Step 6: Run the loader + html-builder tests**

Run: `npx vitest run tests/packager/runtime-loader.test.ts tests/packager/html-builder.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/packager/loader/index.ts src/packager/runtime-loader.ts tests/packager/runtime-loader.test.ts
git commit -m "feat(loader): assemble self-contained loader + emit __plbx_zip"
```

---

## Task 8: Thread per-network mode through the packager

**Files:**
- Modify: `src/packager/packager.ts:185`
- Test: covered by Task 9 integration tests (no isolated unit test — `packageForNetworks` is integration-level).

- [ ] **Step 1: Compute effective mode per network and pass it**

In `packager.ts`, where each network is processed, compute:

```typescript
const globalMode = options.config.loaderMode ?? 'self-contained';
const effectiveMode = options.config.legacyLoaderNetworks?.includes(networkId)
  ? 'systemjs'
  : globalMode;
```

`legacyLoaderNetworks` is not on `PackageConfig` yet — add `legacyLoaderNetworks?: string[]` to `PackageConfig` in `src/types.ts` (alongside `loaderMode?` from Task 1). Then pass into the `generateFullHtml({...})` call at :185:

```typescript
const finalHtml = generateFullHtml({
  originalHtml: builder.toHtml(),
  zipBase64,
  cssContent,
  buildDir: options.buildDir,
  loaderMode: effectiveMode,
});
```

Also confirm the caller that builds `options.config` (IPC layer in `src/main.ts`) forwards `loaderMode`/`legacyLoaderNetworks` from `ProjectSettings`. If `main.ts` constructs `PackageConfig` field-by-field, add the two fields there too.

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: tsc succeeds, no type errors.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all green (adapters, html-builder, packager, loader-* unit tests).

- [ ] **Step 4: Commit**

```bash
git add src/packager/packager.ts src/types.ts src/main.ts
git commit -m "feat(loader): per-network loaderMode resolution in packager"
```

---

## Task 9: Integration verification (the structural gate)

**Files:**
- Use: `tests/integration/ios-validator-sandbox.test.ts` (exists; the regression gate)

- [ ] **Step 1: Self-contained loader boots in null-origin sandbox (webkit + chromium)**

The existing test packages `applovin` (default config → `loaderMode: 'self-contained'`). Run:

Run: `npx vitest run tests/integration/ios-validator-sandbox.test.ts`
Expected: PASS — `[webkit] {hasCc:true,inited:true,hasScene:true}` and same for `[chromium]`.

If RED: read the bridged logs (the test's `summarize` prints status + first 5 errors). Most likely failure points and where to fix:
- `hasCc:false` → module resolution miss → `loader/modules.ts` `plbx_reg_search`/`resolve`.
- `inited:false` → settings.json / json load never completed → `loader/assets.ts` `_PlbxLocalRequest`/`loadData` or downloader registration timing (`plbx_install_downloader` retry).
- `hasScene:false` but inited true → scene `.bin`/texture load → `loadBuffer`/`loadImage` handler.

- [ ] **Step 2: Add a legacy-pinned regression variant**

Append a test to `tests/integration/ios-validator-sandbox.test.ts` that packs with `legacyLoaderNetworks: ['applovin']` and asserts it still boots (proves rollback path works):

```typescript
it('legacy-pinned network still boots in sandbox (rollback path)', async () => {
  if (!ok) { console.warn('  [chromium] skipped'); return; }
  const result = await packageForNetworks({
    buildDir: FIXTURE!.buildDir, outputDir: FIXTURE!.outputDir, networks: ['applovin'],
    config: { orientation: FIXTURE!.orientation, storeUrlIos: 'x', storeUrlAndroid: 'y',
              loaderMode: 'self-contained', legacyLoaderNetworks: ['applovin'] } as any,
  });
  const legacyHtml = readFileSync(result.results.find((r:any)=>r.format==='html')!.outputPath, 'utf-8');
  expect(legacyHtml).toContain('window.XMLHttpRequest ='); // legacy loader emitted
  const r = await bootInSandbox(browser!, legacyHtml, 15000);
  summarize('chromium-legacy', r);
  expectBooted(r, 'chromium-legacy');
});
```

Place it inside the existing Chromium describe block (reuses `browser`, `ok`, `bootInSandbox`, `summarize`, `expectBooted`).

Run: `npx vitest run tests/integration/ios-validator-sandbox.test.ts`
Expected: PASS — both self-contained and legacy-pinned boot.

- [ ] **Step 3: Full suite + build**

Run: `npm run build && npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/ios-validator-sandbox.test.ts
git commit -m "test(loader): self-contained + legacy-pinned boot regression in null-origin sandbox"
```

- [ ] **Step 5: MANUAL CHECKPOINT — real AppLovin iOS validator**

Per project memory, headless tests are necessary but not sufficient. Before any version bump:
1. Build the extension (`npm run build`), repackage a real game for `applovin` (default self-contained mode).
2. Test the **video+playable combo** in the real AppLovin iOS validator (p.applov.in preview) on a physical iOS device.
3. Confirm: no gray screen, game renders, CTA works.
4. Repeat for at least one other MRAID network (ironsource/unity) and Google (ExitAPI) + Facebook (FbPlayableAd) to cover non-MRAID lifecycle.

Do NOT bump the version until this passes. STOP and report results to the user.

---

## Self-Review

**Spec coverage:**
- Core decision (keep SystemJS, cache-native resolve/instantiate, drop global patches) → Tasks 4, 5, 7. ✓
- Naming `super_*`→`plbx_*` (`plbx_load`/`plbx_boot`/`plbx_eval`/`plbx_boot_engine`/`plbx_reg_search`/`plbx_getRes`/`_PLBX_URL`/`__plbx_res`) → Tasks 4-7. Note: `plbx_eval` is inlined as `(0,eval)(raw)` inside `instantiate`; if a standalone `plbx_eval` helper is preferred, extract in Task 4 (cosmetic). ✓
- File split `loader/{unpack,modules,assets,lifecycle}` + shared + legacy → Tasks 2-6. ✓
- Flag `loaderMode` + `legacyLoaderNetworks`, per-network rollback → Tasks 1, 8. ✓
- Tests: ios-validator stays green + suffix-match unit + adapters green → Tasks 4, 9. ✓
- Real-validator verification before bump → Task 9 Step 5. ✓
- Risk #1 (SystemJS injects only in instantiate): overriding both resolve+instantiate bypasses script injection — validated by Task 9 boot. ✓
- Risk #2 (wasm/spine): `cocos-js-rewriter` untouched; wasm bytes load via `loadBuffer`/`_PlbxLocalRequest` arraybuffer + `_PLBX_URL` — validated by Task 9 (fixtures include physics). ✓
- Risk #3 (audio): `loadData`/downloader; explicit `loadAudio` fallback noted in Task 5 Step 3 if integration shows a gap. ✓

**Placeholder scan:** No "TBD/TODO/implement later". The one conditional ("add loadAudio if integration shows a gap") is gated on a concrete test signal with the fix location specified. ✓

**Type consistency:** `loaderMode: 'self-contained' | 'systemjs'` identical across settings/types/options. Cache globals consistent: `__plbx_res` (text), `__plbx_bin` (binary), `__plbx_js` (.js subset), `__plbx_zip` (base64). `plbx_reg_search(keys, id)` signature consistent (Task 4 def ↔ Task 7 usage). `_findAsset` defined in shared, used in modules/assets. ✓
