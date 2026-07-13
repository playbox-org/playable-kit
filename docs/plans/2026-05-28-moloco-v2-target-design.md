# MolocoV2 Build Target — Design

**Date:** 2026-05-28
**Status:** design / not yet implemented

## Цель

Добавить новый build target `molocoV2` под Moloco Playable Ad Integration v2.0 partner API
(spec Feb 2026). Текущий `moloco` target использует legacy FAN-spec single-HTML upload (личный
кабинет drag-drop). Новый flow требует:

1. `launcher.html` — < 3 KB, с metadata header, mraid.js, MOLOCO_MACROS placeholders,
   `<script src=$PAYLOAD_URL>`, `%{IMP_BEACON}`. Studio submits в Moloco QA через
   account manager.
2. `payload.js` — IIFE с game + adapter shim для MOLOCO_MACROS. Studio uploads через
   3-step API (`/cm/v1/auth/tokens` → `/cm/v1/creative-assets` → PUT) и получает
   `asset_url` для embed в launcher.

Existing `moloco` target оставляем нетронутым (legacy путь, FacebookAdapter).

## Reference артефакты в проекте

- `src/types.ts` — `NetworkConfig`, `OutputFormat`
- `src/networks.ts:107-115` — текущий `moloco` config (для сравнения)
- `src/packager/network-adapters/base.ts:36-50` — `buildPlbxBridge()` (шаблон plbx_html)
- `src/packager/network-adapters/base.ts:69-80` — `mraidDeferBootGate()` (viewability gate)
- `src/packager/network-adapters/facebook.ts` — текущий Moloco adapter (паттерн для копирования структуры)
- `src/packager/network-adapters/mintegral.ts` — adapter с custom plbx_html bridge + forbiddenStrings
- `src/packager/network-adapters/index.ts` — registry `CUSTOM_ADAPTERS`
- `src/packager/packager.ts:14-189` — `packageForNetworks()` main loop
- `src/packager/runtime-loader.ts:732-852` — `generateFullHtml()` (single-HTML inliner)

Reference из platform repo:
- `<workspace>/playbox-platform/docs/plans/2026-05-28-moloco-pipeline-old-vs-new.html`
- `<legacy FAN reference build>` (legacy FAN reference)
- `<workspace>/Playables/_Prod/<project>/build/plbx-html/applovin/index.html` (mraid-native reference)

## Архитектурные решения

### 1. Новый output format type: `launcher-payload`

`NetworkConfig.format` сейчас `'html' | 'zip'`. Добавить третий: `'launcher-payload'`.
Когда format = `'launcher-payload'` → packager эмитит **два файла**:

```
out/molocoV2/launcher.html   # < 3 KB
out/molocoV2/payload.js      # IIFE с игрой
```

`OutputFormat` type расширяется в `src/types.ts`:
```ts
export type OutputFormat = 'html' | 'zip' | 'launcher-payload';
```

`PackageResult` для этого формата возвращает **два размера** (launcher + payload отдельно).
Расширить `PackageResult`:
```ts
export interface PackageResult {
  networkId: string;
  networkName: string;
  outputPath: string;            // launcher.html для launcher-payload
  outputSize: number;            // launcher size
  maxSize: number;
  withinLimit: boolean;
  format: OutputFormat;
  /** Только для launcher-payload format */
  secondaryPath?: string;        // payload.js path
  secondarySize?: number;        // payload bytes
  secondaryMaxSize?: number;     // limit для payload
  secondaryWithinLimit?: boolean;
}
```

### 2. Расширение `NetworkConfig` для launcher-payload

В `src/types.ts`:
```ts
export interface LauncherPayloadConfig {
  launcherMaxSize: number;   // strict, e.g. 3 * 1024 (3 KB)
  payloadMaxSize: number;    // e.g. 5 MB
  assetProvider: string;     // "Playbox" — для metadata header
  assetVersion: string;      // "2.0"
  /** Optional PLBX branding splash включить ли (учитывать budget < 3 KB) */
  includeSplash: boolean;
}

export interface NetworkConfig {
  // ...existing
  launcherPayload?: LauncherPayloadConfig;
}
```

### 3. `molocoV2` в `NETWORKS`

В `src/networks.ts` (после `moloco` block):
```ts
molocoV2: {
  id: 'molocoV2',
  name: 'Moloco V2.0 (Launcher API)',
  format: 'launcher-payload',
  maxSize: 5 * 1024 * 1024,     // overall — но check'ы по двум sub-limits
  mraid: true,                   // MUST be true — v2.0 spec needs real mraid
  inlineAssets: true,            // payload.js inlines game ZIP
  launcherPayload: {
    launcherMaxSize: 3 * 1024,   // 3 KB strict
    payloadMaxSize: 5 * 1024 * 1024,
    assetProvider: 'Playbox',
    assetVersion: '2.0',
    includeSplash: false,        // default off — экономим budget
  },
},
```

### 4. plbx_html template — какие НОВЫЕ callbacks добавить

**Минимум обязательного** для Moloco v2.0 lifecycle:

| Field | Тип | Зачем |
|---|---|---|
| `plbx_html.report(eventKey)` | `(key: string) => void` | Generic helper для fire `MOLOCO_MACROS[key]` через `new Image()`. Game может явно слать `complete`, `engagement`, etc. По умолчанию stub `function(){}`. |
| `plbx_html.tap()` | `() => void` | Counter инкрементер. После N тапов автоматически fires engagement/redirection. По умолчанию stub. |
| `plbx_html.is_muted()` | `() => boolean` | Читает `MOLOCO_MACROS.start_muted` (если есть) → возвращает boolean. Game использует для AudioContext init. |

**Default bridge меняется в `base.ts`** чтобы пройти валидацию для networks которые не используют (no-op stubs):

```ts
function buildPlbxBridge(downloadBody: string, extras?: string): string {
  return `window.plbx_html = window.plbx_html || {
  google_play_url: "",
  appstore_url: "",
  download: function(url) {
    url = url || this.google_play_url || this.appstore_url || "";
    ${downloadBody}
  },
  game_end: function() {},
  game_ready: function() {},
  is_audio: function() { return true; },
  is_hide_download: function() { return false; },
  is_muted: function() { return false; },
  report: function() {},
  tap: function() {}
};
window.super_html = window.super_html || window.plbx_html;${extras ? '\n' + extras : ''}`;
}
```

**В MolocoV2 adapter** эти stub-ы переопределяются на live логику:
- `report(key)` → fires `MOLOCO_MACROS[key]` через `new Image().src = decodeURIComponent(url)`
- `tap()` → counter increment, on threshold fires `engagement` / `redirection` macros
- `is_muted()` → reads `MOLOCO_MACROS.start_muted`
- `game_ready()` → fires `game_viewable` macro
- `game_end()` → fires `complete` macro
- `download(url)` → fires `click`, `engagement` macros + `mraid.open(MOLOCO_MACROS.final_url)`

### 5. MolocoV2Adapter (`src/packager/network-adapters/moloco-v2.ts`)

Новый класс. Структура:

```ts
export class MolocoV2Adapter extends BaseAdapter {
  protected getPlbxBridge(config: PackageConfig): string {
    return molocoV2Bridge();   // custom bridge with MOLOCO_MACROS handlers
  }

  transform(builder: HtmlBuilder, config: PackageConfig): void {
    super.transform(builder, config);
    // mraid.js уже injected т.к. networkConfig.mraid = true
    // mraidDeferBootGate уже injected — переиспользуем
    // Additional: inject MOLOCO_MACROS handler shim
    builder.injectBodyScript(molocoV2MacrosShim());
  }

  getForbiddenStrings(): string[] {
    return [
      // Любые external tracker patterns, которые Moloco запрещает в спеке 2.5
      'google-analytics.com',
      'googletagmanager.com',
      'doubleclick.net',
      // Mintegral preview-util уже не нужен — другой network, но safe to guard
    ];
  }

  getRequiredStrings(): string[] {
    return [
      // Базовый mraid required (унаследуется от super т.к. mraid:true)
      ...super.getRequiredStrings(),
      // MolocoV2-specific
      'window.MOLOCO_MACROS',
      'plbx_html.report',
      'mraid_viewable',
      'game_viewable',
    ];
  }
}
```

### 6. Launcher builder (`src/packager/launcher-builder.ts` — НОВЫЙ файл)

Отдельный модуль рисующий < 3 KB launcher:

```ts
export interface LauncherBuildOptions {
  assetProvider: string;
  assetTitle: string;
  assetRevision: string;
  assetVersion: string;
  payloadUrl: string;          // placeholder либо real CDN URL
  includeSplash: boolean;      // PLBX branded splash
  splashSvg?: string;          // inline SVG (optional)
}

export function buildLauncher(opts: LauncherBuildOptions): string {
  // Returns minimal HTML, target < 3072 bytes
  // Structure:
  // <!-- ASSET_PROVIDER=... metadata header -->
  // <html><head>
  // <meta charset/viewport>
  // <script src="mraid.js"></script>
  // <script>window.MOLOCO_MACROS={mraid_viewable:"#MRAID_VIEWABLE_URL#",...};</script>
  // [optional splash CSS + SVG]
  // </head><body>
  // [optional splash DOM]
  // <script src="$PAYLOAD_URL"></script>
  // %{IMP_BEACON}
  // </body></html>
}

export function fillLauncherPayloadUrl(launcherHtml: string, payloadUrl: string): string {
  return launcherHtml.replace(/#\$PAYLOAD_URL#/g, payloadUrl);
}
```

Шаблон рендерится с **`#PAYLOAD_URL#` placeholder** изначально — потом отдельный метод
`fillLauncherPayloadUrl()` заменяет на реальный asset_url после upload-а
(upload flow отдельный, не в extension scope).

Минификация: убрать whitespace, использовать short var names в inline JS.
Включить **strict size assertion** — если launcher > 3 KB, билд abort-ится.

### 7. Payload builder — modification of `runtime-loader.ts`

Текущий `generateFullHtml()` возвращает **HTML**. Для launcher-payload нужен новый
вариант возвращающий **JS IIFE**.

Добавить новую функцию в `runtime-loader.ts`:

```ts
export function generatePayloadJs(params: {
  originalHtml: string;       // оригинальный Cocos index.html
  zipBase64: string;
  cssContent?: string;
  buildDir?: string;
  loaderOptions?: RuntimeLoaderOptions;
}): string {
  // 1. Extract body HTML + inline scripts из originalHtml (cheerio либо regex)
  // 2. Build IIFE:
  // (function(){
  //   // Inject styles через создание <style> элементов
  //   // Inject body DOM через DOMParser → appendChild (НЕ innerHTML)
  //   // Inject __res, __zip, __plbx_scripts, JSZip lib, runtime loader
  //   // Re-execute inline boot scripts через создание <script> DOM-узлов
  // })();
}
```

**Важно:** payload.js должен работать **без `<head>` контекста** — все meta/viewport
уже в launcher.html, payload только injects engine + game.

### 8. packager.ts modifications

В `packageForNetworks()` (`packager.ts:14-189`) добавить branch:

```ts
if (network.format === 'launcher-payload') {
  // Generate payload.js
  const payloadJs = generatePayloadJs({ originalHtml, zipBase64, cssContent, buildDir });
  const payloadPath = join(options.outputDir, networkId, 'payload.js');
  writeFileSync(payloadPath, payloadJs);

  // Generate launcher.html
  const launcher = buildLauncher({
    assetProvider: network.launcherPayload!.assetProvider,
    assetTitle: deriveTitle(options.config),
    assetRevision: deriveRevision(),
    assetVersion: network.launcherPayload!.assetVersion,
    payloadUrl: '#PAYLOAD_URL#',  // placeholder для post-upload substitution
    includeSplash: network.launcherPayload!.includeSplash,
  });
  const launcherPath = join(options.outputDir, networkId, 'launcher.html');
  writeFileSync(launcherPath, launcher);

  // Validate sizes
  const launcherSize = launcher.length;
  const payloadSize = payloadJs.length;

  if (launcherSize > network.launcherPayload!.launcherMaxSize) {
    throw new Error(`Launcher size ${launcherSize}B > limit ${network.launcherPayload!.launcherMaxSize}B`);
  }
  // Validator checks
  assertNoForbiddenStrings(payloadJs, adapter.getForbiddenStrings(), network.name);
  assertHasRequiredStrings(launcher + payloadJs, adapter.getRequiredStrings(), network.name);

  results.push({
    networkId, networkName: network.name,
    outputPath: launcherPath, outputSize: launcherSize,
    maxSize: network.launcherPayload!.launcherMaxSize,
    withinLimit: launcherSize <= network.launcherPayload!.launcherMaxSize,
    format: 'launcher-payload',
    secondaryPath: payloadPath,
    secondarySize: payloadSize,
    secondaryMaxSize: network.launcherPayload!.payloadMaxSize,
    secondaryWithinLimit: payloadSize <= network.launcherPayload!.payloadMaxSize,
  });
  continue;
}
```

### 9. Validator — lifecycle/macros checks для MolocoV2

Adapter `getRequiredStrings()` + дополнительный helper в packager.

**Required в launcher.html:**
- `ASSET_PROVIDER=` (metadata header)
- `<script src="mraid.js">`
- `window.MOLOCO_MACROS`
- `mraid_viewable`, `game_viewable`, `click`, `final_url` (как минимум 4 ключа)
- `%{IMP_BEACON}` (Moloco beacon placeholder)
- `#PAYLOAD_URL#` placeholder (если post-upload substitution) или валидный https URL

**Required в payload.js:**
- `plbx_html.report` (либо переопределённая версия)
- `mraid.addEventListener('viewableChange'` (для game_viewable trigger)
- `MOLOCO_MACROS[` (используется)
- `decodeURIComponent` (макрос-URL escaped)

**Forbidden в обоих:**
- Внешние трекеры (`google-analytics`, `doubleclick`, etc.) — спека 2.5 «no external events outside Moloco-reserved macros»
- Legacy synchronous DOM-write APIs если spec их запрещает — проверить перед finalизацией
- Любые dynamic-eval паттерны если spec 2.5 это явно запрещает

**Size checks:**
- launcher.html ≤ 3072 bytes (strict)
- payload.js ≤ launcherPayload.payloadMaxSize (5 MB default, configurable)

**Structural checks** — добавить новый helper:
```ts
function validateLauncherStructure(html: string): string[] {
  const errors: string[] = [];
  if (!html.match(/%\{IMP_BEACON\}[\s\n]*<\/body>/)) {
    errors.push('IMP_BEACON must be last meaningful content before </body>');
  }
  if (!html.match(/<!--\s*ASSET_PROVIDER=/)) {
    errors.push('Metadata header missing ASSET_PROVIDER');
  }
  // ... etc
  return errors;
}
```

### 10. UI panel update

`src/panels/default.ts` (compiled в `dist/panels/default.js`) показывает чекбоксы networks.
Добавление `molocoV2` в `NETWORKS` автоматически появится в UI. Дополнительно
для launcher-payload formatа можно добавить:

- Inline preview launcher size (live counter)
- Inline preview payload size
- Toggle "Include PLBX splash" (хотя default off)

В UI desc network-а отметить: «Outputs `launcher.html` + `payload.js`. Submit launcher to
Moloco QA, upload payload via API.»

### 11. i18n

`i18n/en.js` и `i18n/zh.js`:
```js
'plbx-cocos-extension': {
  // existing
  networks: {
    'moloco-v2': 'Moloco V2.0 (Launcher API)',
  },
  'moloco-v2-desc': 'Outputs launcher.html (<3KB) + payload.js (IIFE). Submit launcher to Moloco QA, upload payload via /cm/v1/creative-assets API.',
}
```

### 12. Tests

`tests/packager/moloco-v2.test.ts` — новый файл. Покрытие:

```ts
describe('MolocoV2 target', () => {
  it('produces launcher.html < 3 KB', async () => {
    const r = await packageForNetworks({ networks: ['molocoV2'], ... });
    expect(r.results[0].outputSize).toBeLessThan(3072);
    expect(r.results[0].withinLimit).toBe(true);
  });

  it('produces payload.js as IIFE', async () => {
    const r = await packageForNetworks({ networks: ['molocoV2'], ... });
    const payload = readFileSync(r.results[0].secondaryPath!, 'utf-8');
    expect(payload).toMatch(/^\(function\(\)\{/);
    expect(payload).toMatch(/\}\)\(\);?$/);
  });

  it('launcher has all required macros', async () => {
    const r = await packageForNetworks({ networks: ['molocoV2'], ... });
    const launcher = readFileSync(r.results[0].outputPath, 'utf-8');
    expect(launcher).toContain('window.MOLOCO_MACROS');
    expect(launcher).toContain('mraid_viewable');
    expect(launcher).toContain('game_viewable');
    expect(launcher).toContain('click');
    expect(launcher).toContain('final_url');
    expect(launcher).toMatch(/%\{IMP_BEACON\}/);
    expect(launcher).toMatch(/<!--\s*ASSET_PROVIDER=Playbox/);
  });

  it('payload has MOLOCO_MACROS handler shim', async () => {
    const r = await packageForNetworks({ networks: ['molocoV2'], ... });
    const payload = readFileSync(r.results[0].secondaryPath!, 'utf-8');
    expect(payload).toContain('mraid.addEventListener');
    expect(payload).toContain('viewableChange');
    expect(payload).toContain('plbx_html.report');
  });

  it('rejects forbidden tracker strings', async () => {
    // mock build dir с inject-нутым `google-analytics.com` в HTML
    await expect(
      packageForNetworks({ networks: ['molocoV2'], buildDir: BAD_BUILD, ... })
    ).rejects.toThrow(/forbidden/);
  });

  it('rejects oversized launcher', async () => {
    // Mock с очень большим asset_title который сильно надувает launcher
    // либо включи splash + extra branding и проверь что бюджет соблюдён
  });

  it('default plbx_html stubs не ломают другие networks', async () => {
    // sanity check что новые поля is_muted/report/tap в дефолтном bridge
    // не разрушают AppLovin/Mintegral/Facebook builds
    const r = await packageForNetworks({ networks: ['applovin', 'mintegral'], ... });
    expect(r.results.every(x => x.withinLimit)).toBe(true);
  });
});
```

### 13. Documentation

Обновить:
- `README.md` — добавить molocoV2 в список supported networks
- `docs/research/ad-networks-reference.md` — добавить row для Moloco V2.0 с lifecycle events table

## Build order (рекомендуемый порядок имплементации)

1. **types** — расширить `OutputFormat`, `NetworkConfig`, `PackageResult`, новый `LauncherPayloadConfig`
2. **plbx_html template** — добавить `report`, `tap`, `is_muted` stubs в `buildPlbxBridge`; убедиться не ломает existing networks (test pass)
3. **launcher-builder.ts** — новый модуль с `buildLauncher()`
4. **runtime-loader.ts** — добавить `generatePayloadJs()` (рядом с `generateFullHtml`)
5. **moloco-v2.ts** adapter — extends BaseAdapter, custom bridge с MOLOCO_MACROS handlers
6. **index.ts** registry — зарегистрировать `molocoV2: MolocoV2Adapter`
7. **networks.ts** — добавить `molocoV2` entry с `launcherPayload` config
8. **packager.ts** — branch `if (format === 'launcher-payload')` с launcher + payload generation + validator checks
9. **tests** — `moloco-v2.test.ts` + regression test для existing networks
10. **i18n + UI** — labels, descriptions, optional splash toggle
11. **docs** — README + ad-networks-reference

## Out of scope (для другой задачи)

- Upload pipeline в Playbox platform UI (API ключи, asset_url substitution).
- Self-hosted CDN для payload.js (отложено per memory `moloco-cdn-strategy`).
- Multi-tenant credentials storage для разных Studio accounts.
- Submission automation к Moloco QA (через Slack/email — manual currently).

## Risks / open questions

1. **Real mraid.js на устройстве** — Moloco ad-container поставляет live `mraid.js`. Наш
   код предполагает `mraid.getState()` / `mraid.isViewable()` / `mraid.open()` /
   `mraid.addEventListener('viewableChange')` — это MRAID 2.0 standard, должно работать.
   Проверить через actual QA в Moloco testbed.

2. **`#PAYLOAD_URL#` placeholder** — kept в launcher.html для substitution **после**
   upload payload.js. Чем заменять — задача upload pipeline (вне extension). Extension
   может оставить placeholder либо принять CLI flag `--payload-url=...`.

3. **3 KB launcher budget при splash включён** — current PLBX splash в
   `chicken-road-builder/dist/en/moloco/launcher.html` весит ~11 KB. Нужна агрессивная
   минификация: inline minified SVG логотип (< 800 B), tiny CSS (< 400 B), no animations.
   Decision: default `includeSplash: false`, опция для power-users.

4. **`MOLOCO_MACROS` URL escaping** — все значения макросов URL-encoded. `decodeURIComponent`
   на каждом use. Особый случай: cachebuster — не URL, а string (handle отдельно).

5. **Source maps** — payload.js собирается из Cocos build что и так минифицирован.
   Source map (если генерировать) добавит ~500 KB — нужен ли вообще для playable?
   Decision: skip source maps в payload.

6. **Re-upload payload без re-submission launcher** — задача upload pipeline. Extension
   просто generate новый payload.js при rebuild; launcher.html в идеале остаётся stable
   (тот же `#PAYLOAD_URL#` placeholder → тот же asset_url). Verified через test.

---

См. также:
- [Pipeline old-vs-new HTML](../../../playbox-platform/docs/plans/2026-05-28-moloco-pipeline-old-vs-new.html)
- Moloco Playable Ad Integration v2.0 (Feb 2026), Section 2.1-2.7
