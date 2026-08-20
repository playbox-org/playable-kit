# Luna / Unity Playworks — packaging target + analytics conformance

**Status:** spec (2026-08-19)
**Owner:** kit (packaging + validation rules), extension (preview UI)
**External docs:**
- JS playables overview — https://docs.lunalabs.io/docs/playable/javascript-playables/overview/
- Manual setup (archive contract) — https://docs.lunalabs.io/docs/playable/javascript-playables/setup/
- JS SDK guide — https://docs.lunalabs.io/docs/playable/javascript-playables/js-sdk/
- Standard events — https://docs.lunalabs.io/docs/playable/playable-setup/analytics/standard-events
- Custom events — https://docs.lunalabs.io/docs/playable/playable-setup/analytics/custom-events
- Reference archives — https://github.com/LunaCommunity/Playable-Examples

## 1. What Luna is, in our terms

Luna (Unity Playworks) is **not a delivery network** — it is an authoring/export
platform. We hand it one prepared archive; Luna re-exports that archive per ad
network (AppLovin, Unity Ads, TikTok, Mintegral, Vungle, …) and attaches its own
analytics. Consequences that drive every decision below:

- Our output must carry **no network wrapper of its own** — no `mraid.js`, no
  Facebook/Snap/TikTok SDK. Luna injects those at export time.
- **Luna does not compress or minify after upload** ("Please minify and obfuscate
  your playables prior to uploading"). Whatever we ship is what the networks get,
  so the packed size must already satisfy the strictest downstream network.
- The CTA and lifecycle contract is Luna's, not a network's.

We model it as one more entry in the kit's `NETWORKS` registry (id `luna`)
because that is the only mechanism the packager, preview server and panel all
already understand. The registry entry is a *target*, not a claim that Luna is
an ad network.

## 2. Archive contract

A Luna upload is a ZIP holding exactly three root-level files:

| File | Content |
|---|---|
| `source.html` | The playable. Name is mandatory — Luna looks for `source.html`. |
| `luna.json` | App-store links + per-network package settings. |
| `playground.json` | Title, icon, editable Playground fields. |

Verbatim `luna.json` skeleton (from Luna's own reference archive; keys we do not
populate stay present with their empty defaults — Luna's exporter reads them):

```json
{
  "unity": {
    "packages": {
      "default": {
        "applicationName": "",
        "iosLink": "",
        "androidLink": "",
        "orientation": "unspecified",
        "supportedLanguages": ["en"]
      },
      "ironsource": {
        "appID": "", "assetID": "", "applicationGenre": "",
        "versionName": "", "apiType": 0, "playableMode": 0, "packageType": 0
      },
      "facebook": { "assetID": "", "packageType": 0 },
      "tiktok": { "orientation": 0 }
    }
  }
}
```

Field mapping we own:

- `applicationName` ← `templateVariables.assetTitle || projectName || ''`
- `iosLink` ← resolved Apple store URL (see §5), `''` when unknown
- `androidLink` ← resolved Google Play URL, `''` when unknown
- `orientation` ← `PackageConfig.orientation`, mapped `auto → "unspecified"`,
  `portrait → "portrait"`, `landscape → "landscape"`
- `tiktok.orientation` ← `auto → 0`, `portrait → 1`, `landscape → 2` (same map
  the TikTok adapter already uses)

`playground.json` minimum we emit:

```json
{ "title": "<applicationName or 'Playable'>", "icon": null, "fields": {} }
```

`fields` stays empty by design — Playground fields are a per-project authoring
feature, not something a packager can invent. `icon` is a data-URI PNG in Luna's
examples; `null` is accepted and is what we emit.

## 3. Runtime contract (what the packager injects)

### 3.1 Deferred boot

All startup must run inside a global `startGame()`; Luna calls it. The kit
already has the generic gate `window.__plbx_pre_boot(go)` (consumed by
`runtime-loader.ts`, today also used by the MRAID defer-boot gate), but
`startGame` must NOT be defined inside it:

```js
var _plbx_luna_started = false, _plbx_luna_go = null;
window.startGame = function () {          // defined synchronously, at injection time
  if (_plbx_luna_started) return;         // Luna may call it more than once
  _plbx_luna_started = true;
  if (_plbx_luna_go) _plbx_luna_go();     // loader already up — boot now
};                                        // else __plbx_pre_boot boots on arrival
window.__plbx_pre_boot = function (go) {
  _plbx_luna_go = go;
  if (_plbx_luna_started) { go(); return; }  // host called startGame early
  if (!window.Luna) window.startGame();      // no host (local dev) — self-start
};
```

**Why the split, measured:** the runtime loader calls `__plbx_pre_boot` only
after it has unpacked the base64/JSZip asset payload. On a packaged 3.5 MB
artifact in headless Chromium, `startGame` did not exist at the `load` event
(t=186 ms) and first appeared at t=274 ms — and that gap scales with build size.
Luna calls `startGame()` at load, so a gate defined inside `__plbx_pre_boot`
gives the host `startGame is not a function`; since `window.Luna` is present the
self-start fallback is disabled, and the creative sits on the splash for the
whole impression.

The PLBX splash is static markup injected into `<body>` and hidden on the first
rendered Cocos frame, so the window between page load and Luna's `startGame()`
shows the splash, not a blank page. Splash stays enabled for `luna`.

### 3.2 CTA

Luna's standard **Ad Click** event only fires when the CTA goes through Luna's
API. Every dispatcher path the games use must land there — including the bare
`window.open(link)` that older dispatchers still use:

```js
window.plbx_html.download = _plbx_luna_install;
window.install = _plbx_luna_install;
window.open = function (u) {                 // under a Luna host, every open is a CTA
  if (window.Luna) { _plbx_luna_install(); return null; }
  return _origOpen.apply(window, arguments); // no host (local dev) — behave normally
};
```

`InstallFullGame()` takes no URL: Luna resolves the store link from `luna.json`.

### 3.3 Game end

```js
window.plbx_html.game_end = function () { Luna.Unity.LifeCycle.GameEnded(); };
```

Required by Luna for Mintegral/Vungle exports; harmless elsewhere.

### 3.4 Container lifecycle

Luna fires these on `window`; the creative must react:

| Event | Our wiring |
|---|---|
| `luna:build` | no-op (fires right after `load`; boot is gated on `startGame`) |
| `luna:pause` | `cc.game.pause()` |
| `luna:resume` | `cc.game.resume()` |
| `luna:mute` | neutralise `resume` on every tracked AudioContext, then suspend them; `cc.audioEngine.pauseAll()` (2.x); `muted = true` on all `<audio>/<video>` |
| `luna:unmute` | restore the original `resume`, resume the contexts, `resumeAll()`, unmute media |

**Mute is not a suspend.** Cocos 3.8's bundled `cc.js` defines
`runContext()` — `if ("suspended" === state) resume()` — and calls it from
`AudioPlayerWeb.doPlay()` and `AudioPlayerWebOneShot.play()`, i.e. on every
playback attempt, plus from its own `touchend`/`mouseup` handlers. A bare
`suspend()` therefore survives only until the next sound: Luna mutes, the game
plays one more clip, and the ad is audible while the container believes it is
silent. So while muted, `resume` itself is shadowed with a resolved-promise
no-op on each tracked context (the original is stashed and restored on unmute),
and contexts created *during* the mute are born neutralised — Cocos builds its
context lazily on the first sound, which can land after the mute.

Contexts are tracked by patching `window.AudioContext`/`webkitAudioContext` in
the bridge, which runs before the engine boots. `cc.audioEngine` is a Cocos 2.x
API — the 3.8 web-mobile fixture contains zero occurrences of it — so it is a
fallback for old builds, never the primary path.

### 3.5 Analytics channel

The packager provides the **channel**, never concrete events. Concrete custom
events (`playtime_10s`, level funnels, …) are the game project's business.

```js
window.plbx_html.log_event = function (name, value) { /* see below */ };
```

Behaviour:

- Routes to `window.pi.logCustomEvent(name, value)` when `window.pi` exists.
- `value` defaults to `1` — Luna requires an integer parameter for string-named
  events; a missing value is a silent drop on their side. A caller that passes a
  non-integer still gets `1` substituted, which is why the validator flags it.
- Before `window.pi` exists (Luna's SDK is injected by their exporter; it is
  absent in local dev and during very early boot) calls are **queued**, capped at
  256 — Luna's per-session ceiling, the only bound that means anything for a
  single shared queue — and drained once `pi` appears. The queue is drained
  *before* a fresh event is sent, so Luna receives them in call order.
- Drops past the cap are counted on `window.plbx_html.luna_dropped_events` and
  warned once to the console. Silent loss is the failure mode this exists to
  prevent, so it must never fail silently itself.
- The flush poll is bounded (50 × 100 ms, the same bound `mraidDeferBootGate`
  uses) and then stops; `log_event` still drains the backlog itself if `pi`
  turns up later. An unbounded poll would leave a 10 Hz timer running for the
  life of every ad that has no Luna host.
- Never throws: a broken analytics call must not take the playable down.

Standard events (Ad Loading / Ready / Starting / Impression / Engagement /
Click) are injected by Luna automatically — we emit no code for them.

## 4. Registry entry

```ts
luna: {
  id: 'luna',
  name: 'Luna (Unity Playworks)',
  format: 'zip',
  maxSize: 5 * 1024 * 1024,
  mraid: false,
  inlineAssets: true,
  singleFileZip: true,
  htmlFileName: 'source.html',
  zipStructure: '',
}
```

- `maxSize` — Luna publishes no upload ceiling. 5 MB is the strictest common
  downstream network cap, and since Luna does not compress after upload, an
  artifact above it is dead on arrival at export time. Advisory ceiling, chosen
  deliberately; revise if Luna documents a real number.
- `mraid: false` — inherits `BaseAdapter.getForbiddenStrings() === ['mraid.js']`,
  so a build that leaks the literal aborts packaging. Correct for Luna.
- `singleFileZip: true` — one fully-inlined `source.html` inside the archive.

### 4.1 New kit extension points

Two, both minimal:

1. `NetworkConfig.htmlFileName?: string` — literal name for the inner HTML.
   Precedence: `htmlFileName` wins over `htmlMatchesZipName`, and unlike the
   latter it does **not** rename the outer `.zip`. Consumed at both hard-coded
   sites (`packager.ts` wrap branch and plain-zip branch).
2. `NetworkAdapter.getZipExtraFiles(config): Array<{ zipPath, content }>` —
   default `[]` on `BaseAdapter`. The existing `getZipConfig` stays as-is (it
   owns the hard-coded `config.json`); Luna needs two differently-named
   manifests, which that hook cannot express.

## 5. Store URLs

`PackageConfig.storeUrlIos/storeUrlAndroid` are marked deprecated and the Cocos
extension never sets them — the real URLs are recovered by the packager from the
build source (`extractStoreUrls`) into a local `headStoreUrls` that no adapter
can see. `luna.json` needs them, so the packager resolves them and hands the
Luna target a **separate config object**:

```ts
const lunaConfig: PackageConfig = { ...options.config, ...resolved, appName }
// inside the per-network loop:
const packageConfig = networkId === 'luna' ? lunaConfig : options.config
```

Split rule: Google Play = first URL matching `play.google.com`, Apple = first
matching `(apps|itunes).apple.com`.

**The clone is not cosmetic.** `BaseAdapter.transform` emits
`window.plbx_html.google_play_url = "…"` from whatever config it is handed, for
*every* network. Filling those fields on the shared `options.config` — the first
implementation — silently changed 20+ live targets: MRAID CTAs went from
`mraid.open()` to `mraid.open(<scraped Google Play URL>)`. Non-Luna output must
stay byte-identical to before this work, and a test pins that.

`appName` follows the same path: `templateVariables.assetTitle || projectName ||
''`. The empty string is Luna's documented "unknown" — the build-directory name
must never leak into `applicationName`. Only `playground.json`'s human-facing
`title` falls back to `'Playable'`.

## 6. Analytics conformance checks

New kit module `src/validation/luna-events.ts`, modelled on `axon-events.ts`
(same pure-function split: a source extractor + a pure validator used by both
the package-time gate and the preview panel).

Luna's caps: **256 events per session**, **32 per unique event name**.

| id | Level | Rule |
|---|---|---|
| `caps_per_name` | error | No single event name fired more than 32× |
| `caps_session` | error | Total events in the session ≤ 256 |
| `events_before_start` | warn | No `logCustomEvent` before `startGame()` ran — Luna's docs: "avoid logging any event during the initialisation phase" |
| `name_valid` | error | Names non-empty and whitespace-free |
| `value_int` | warn | An integer `value` is passed for every string-named event. Call-shape aware: a value-less `plbx_html.log_event('x')` is fine (the bridge defaults to `1`), a value-less `pi.logCustomEvent('x')` is not; a non-integer is flagged in both, since the bridge substitutes `1` and the author's number is not what Luna records |
| `cta_via_install` | error | Every CTA went through `InstallFullGame()` — otherwise Luna's standard **Ad Click** never fires |
| `no_sdk_redefine` | error | The creative does not assign `window.pi` or `window.Luna` — Luna's exporter provides both |
| `axon_names` | warn | No AppLovin Axon event name (`DISPLAYED`, `CHALLENGE_*`, …) was sent through the Luna channel — those belong to `ALPlayableAnalytics.trackEvent()` and are AppLovin-only. Confusing the two fails silently in both directions, and Axon's own validator only guards the opposite one |
| `dynamic_names` | info | Event names built at runtime (`'playtime_' + n + 's'`) — expected, but unverifiable statically; surfaced so the count is not read as "no events" |

Empty usage produces no checks (a project with no custom events gets no
advisory noise), exactly like the Axon validator.

`LunaEventUsage` carries a required `source: 'static' | 'runtime'` discriminator,
because `count` means two different things: **call sites** for a static scan and
**fires** at runtime. The caps rows are emitted only for `source: 'runtime'` —
a loop firing one call site 100 times would otherwise report `count: 1` and pass
the exact rule Luna enforces, while a minifier repeating one literal in 33 places
would produce a bogus error.

Static extraction (`extractLunaUsage(buildDir)`) scans plaintext build sources
for analytics call sites, dynamic-name call sites, and `pi`/`Luna` redefinition.
It matches **both** spellings — `pi.logCustomEvent(` and the sanctioned
`plbx_html.log_event(` channel from §3.5 — anchored on an identifier boundary
(without it, `analytics.catalog_event('shop_open', 2)` was extracted as a Luna
event). Games written against the plbx/super_html channel never touch
`window.pi` directly, so a scanner that knows only Luna's own API name reports
"no events" for the intended integration.

Runtime usage comes from the preview mock (§7) with real counts — the caps are
inherently runtime facts.

## 7. Preview mock + validation UI

Kit `src/preview/sdk-mocks.ts` gains a `networkId === 'luna'` block:

- `window.Luna = { Unity: { Playable: { InstallFullGame }, LifeCycle: { GameEnded },
  Playground: { get(section, key, def) → def } } }` — `Playground.get` returning
  the default is what Luna's own reference archive does before Playground fields
  are authored.
- `window.pi = { logCustomEvent(name, value) }` → `report('luna_event', {...})`
  carrying per-name count, session total, a `beforeStart` flag and `valueOk`,
  because the extension UI computes the cap verdicts from those numbers.
- `expectedCtaMethod` gains `luna: 'luna_install'`, so a CTA that reaches the
  preview by any path other than Luna's API is reported as untracked rather than
  as a false success.
- **Standard events are simulated** so the panel can validate their
  preconditions, since Luna injects the real ones only at export:
  `adLoading`/`adReady`/`adStarting` on the boot path, `adImpression` on the
  first rendered frame, `adEngagement` on first pointer input (once — a single
  tap synthesises up to three input events), `adClick` on `InstallFullGame()`.
- Standard events do **not** count toward the session budget: Luna injects them
  itself, so charging the game's 256 for them would misreport the headroom.
  The same line applies to the "no events before `startGame()`" rule — it is
  about the custom events the game authors, not Luna's own boot events.
- `window.startGame()` is invoked by the mock, which polls for it rather than
  sampling once (it appears only after the asset unpack; with `window.Luna`
  defined the creative's self-start fallback is off, so a missed probe would
  leave the preview on the splash with no recovery but the manual trigger).
- Manual-trigger protocol `plbx:luna` (mirrors the existing `plbx:molocov2`
  one): actions `build | pause | resume | mute | unmute | start-game | game-end | cta`.

Extension preview UI (`static/preview/`): a **Luna Events** sidebar section,
shown only for `luna`, listing every event with counts in three groups —
standard (simulated), lifecycle, custom — plus the §6 verdict rows computed
client-side. Same shape and CSS vocabulary as the existing Axon panel; the
client-side check computation is a deliberate mirror of the kit validator and
carries a KEEP-IN-SYNC comment, as the Axon one does (browser statics cannot
import the kit). `/api/networks` ships `lunaEvents` + `lunaCaps` from the kit so
the mirrored constants cannot drift.

Two checklist rows come from `getNetworkChecks('luna')` and must be satisfied by
the panel, or they auto-fail after 30 s on a conforming build: `start_game`
(from the `luna_lifecycle` startGame report) and `luna_events` (from the
event-related verdicts only — a CTA-routing violation belongs to the `cta` row
and must not be double-reported here).

## 8. Out of scope

- Concrete custom events (`playtime_N` and friends) — game-project business.
- Deploy-tab support for the Luna target (`entryFile` is hard-coded to
  `index.html`, the network `<select>` is a hard-coded 5-option list).
- Playground `fields` authoring.
- Luna's own post-upload validation (Preview Link, "Show Events: On",
  `urls.txt` → Insights) — that is a manual step in the client's Playworks
  account, documented for QA but not automatable from here.

## 9. Playworks plan tiers (affects QA, not the artifact)

Unity Playworks pricing as seen in-product (v60.22.0, Aug 2026):

| | LITE (free) | PRO ($15K/month) |
|---|---|---|
| Exports | unlimited | unlimited |
| Network downloads | **Unity Ads only** | all supported networks |
| Insights (analytics dashboards) | ✗ | ✓ |
| Creative Testing | ✗ | ✓ |
| Technical support | ✗ | ✓ |

Consequences:

- On a LITE account the analytics events we wire up are **not viewable** —
  Insights is a PRO feature. The client's own account must be PRO (or on the
  LevelPlay-mediation quote) for the playtime funnel they asked for to be worth
  anything. Our free account can produce and export the archive, and test on
  Unity Ads, but cannot confirm events arrived.
- This does not change the artifact or the code: the archive, the SDK calls and
  the caps are identical on both tiers. It changes only WHO can verify what.
- It also raises the value of our own preview validation: on LITE it is the only
  place the event stream can be inspected at all.
