# Ad Networks Playable Ads Requirements

> **Status:** Full re-verification pass against official / network-owned sources.
> **Last verified: 2026-07-01**
> **Sources:** Official network docs (re-fetched), Luna Labs, 2DKit, PlayCanvas, archived/Wayback where live pages are gated. Confidence + per-row source links added; unverified networks are flagged explicitly.

**Legend — Confidence:** `high` = core spec backed verbatim by a network-owned source; `med` = network-owned source exists but is partly gated/ambiguous or brand is EOL; `low` = no official playable spec found, values are third-party/generic-MRAID inferences (⚠ unverified).

---

## Summary Table

| Network | CTA Method | MRAID | Size Limit | Format | Lifecycle | Confidence | Source |
|---------|-----------|-------|-----------|--------|-----------|-----------|--------|
| **Facebook/Meta** | `FbPlayableAd.onCTAClick()` | No | 2 MB single-HTML / 2 MB index.html in ZIP / **5 MB ZIP total, ≤100 files** | HTML or ZIP | — | high | [Meta](https://developers.facebook.com/docs/app-ads/formats/playable-ad/) |
| **Moloco** | `FbPlayableAd.onCTAClick()` | No | **< 5 MB, HTML only (ZIP forbidden)** | HTML | — | high | [Moloco](https://help.moloco.com/hc/en-us/articles/24124525963799-Playable-and-Interactive-End-Card-IEC-creative-guide) |
| **Moloco V2 (Launcher API)** | `mraid.open(final_url)` | MRAID 2.0 | payload < 5 MB; launcher < 3 KB ⚠ partner-spec | launcher + payload | viewableChange + macro beacons | med | [Moloco Cloud](https://developer.moloco.cloud/docs/campaign-management-api) |
| **Google Ads (App)** | `ExitApi.exit()` | No (MRAID accepted as alt exit) | **5 MB ZIP, ≤512 files, ≤20 ZIPs/ad group** | ZIP | — (sound off till tap) | high | [Google](https://support.google.com/google-ads/answer/9981650) |
| **AppLovin (Axon)** | `mraid.open()` | MRAID 2.0 | **5 MB single HTML** (base64/base122) | HTML | mraid `ready` before any MRAID/layout call | high | [AppLovin](https://support.applovin.com/en/growth/promoting-your-apps/welcome-to-applovin/creative-specs-and-guidelines) |
| **Unity Ads** | `mraid.open(storeUrl)` | **MRAID 3.0** | **< 5 MB** single inlined HTML | HTML | wait `viewableChange` before start | high | [Unity](https://docs.unity.com/acquire/en-us/manual/playable-ads-specifications) |
| **ironSource (LevelPlay)** | `dapi.openStoreUrl()` / `mraid.open(url)` | UA: MRAID 3.0 · Exchange: MRAID 2.0 · DAPI | UA < 5 MB · Exchange ≤ 4 MB | HTML | wait `viewableChange` before start | high | [Unity Grow](https://docs.unity.com/en-us/grow/acquire/creatives/playable/specifications) |
| **Mintegral** | `window.install()` | No | **5 MB** (ZIP or single HTML) | both | gameReady/gameStart (+gameEnd/Retry/Close ⚠) | high | [Mintegral](https://helpcenter.mintegral.com/en/docs/asset-specs) |
| **Pangle (TikTok)** | `window.openAppStore()` | No (forbidden) | **5 MB ZIP** (after compression) | ZIP | none official | high | [TikTok/Pangle](https://ads.tiktok.com/help/article/how-to-create-tiktok-pangle-playable-ads) |
| **TikTok** | `window.openAppStore()` | No (forbidden) | **5 MB ZIP** (after compression) | ZIP | none official | high | [TikTok](https://ads.tiktok.com/help/article/playable-ads?lang=en) |
| **Vungle (Liftoff Monetize)** | `parent.postMessage("download","*")` | No (Adaptive) | **5 MB ZIP** total | ZIP (flat) | init/pause/resume; download+complete | high | [Vungle](https://support.vungle.com/hc/en-us/articles/360056663752-Dos-and-Don-ts-of-Adaptive-Creative) |
| **AdColony (DT Exchange)** | `mraid.open(url)` | MRAID 2.0 | **No official limit** (code: 5 MB internal cap; ⚠ old 2 MB was fabricated) | HTML / ZIP | ready→stateChange→viewableChange; 30 s rewarded | med | [Digital Turbine](https://docs.digitalturbine.com/dt-exchange/advertisers/ad-formats/mraid-2.0) |
| **Chartboost** | `mraid.open(url)` (no `mraid.close()`) | MRAID 2.0 | **3 MB hard**, single bundled HTML | HTML | getState/ready/stateChange/viewableChange | high | [Chartboost](https://docs.chartboost.com/en/advertising/creatives/mraid-playable/) |
| **Tapjoy (→ Unity Grow)** | `window.TJ_API.click()` | No (own `TJ_API`) | **2 MB**, single Base64 HTML | HTML | TJ_API setPlayableAPI/click/gameplayFinished | med | [Tapjoy PDF](https://tapjoy-docs-production.s3.us-east-2.amazonaws.com/en/support/files/playables-api-v3.0.2.pdf) |
| **Liftoff (Accelerate)** | `mraid.open()` / `Liftoff.open()` | MRAID (version unspecified) | **< 700 KB (1 MB max) no-video; < 5 MB with video** | HTML/ZIP | mraid `ready`; handle no-`viewableChange` | high | [Liftoff](https://docs.liftoff.io/creative_integration_api) |
| **Appreciate (DT DSP)** | `mraid.open(url)` ⚠ generic | MRAID 2.0 ⚠ generic | ⚠ no official limit | HTML ⚠ inferred | generic MRAID | low | ⚠ unverified — [appreciate.mobi](https://appreciate.mobi/) has no spec |
| **Snapchat (App Playables)** | `ScPlayableAd.onCTAClick()` | **No mraid.js** | **5 MB uncompressed** (soft) | ZIP (index.html+config.json at root; assets external) | CTA-only | high | [Snapchat](https://businesshelp.snapchat.com/s/article/app-playables?language=en_US) |
| **Bigo Ads** | `window.BGY_MRAID.open()` (no arg) | No (own SDK v1.13.0) | **< 5 MB ZIP** (after compression) | ZIP (index.html+config.json) | gameReady→GAME_START, GAME_ENDED | high | [Bigo](https://bigoads.com/help/detail?id=144&moduleId=14&currentLan=EN) |
| **myTarget (VK Ads)** | `MTRG.onCTAClick()` / `FbPlayableAd.onCTAClick()` | No (own API) | **2 MB ZIP** (single base64 HTML) | ZIP | — | high | [VK Ads](https://target.vk.ru/help/advertisers/adformatplayableads/en) |
| **Bigabid** | `mraid.open(url)` ⚠ generic | MRAID (exchange) | ⚠ no official limit | ⚠ unconfirmed | generic MRAID viewableChange | low | ⚠ unverified — [bigabid.com](https://www.bigabid.com/) (DSP, no spec) |
| **InMobi** | `FbPlayableAd.onCTAClick()` / `$HTML_ESC_CLICK_URL` + `mraid.open(url)` | **MRAID 3.0** | **5 MB** (HTML or ZIP) | both | wait `viewableChange` before init | high | [InMobi](https://support.inmobi.com/choice/other-resources/creative-specifications-and-guidelines) |
| **Adikteev** | `mraid.open(url)` + click placeholders | **MRAID 1.0** | ⚠ no official limit | **HTML snippet + CDN JS/CSS (not ZIP)** | mraid `ready` | med | [Adikteev](https://help.adikteev.com/hc/en-us/articles/10549028250130-Specifications-for-external-creatives) |
| **Smadex** | ⚠ `mraid.open()` inferred | ⚠ inferred | ⚠ UNKNOWN (no spec) | ⚠ inferred HTML | generic MRAID | low | ⚠ unverified — [Smadex](https://smadex.com/smadex-creative-studio-guide/) (no tech spec) |
| **Rubeex** | ⚠ unknown (Cordova bootstrap) | ⚠ unconfirmed | ⚠ no official limit | ⚠ multi-file pkg (like Pangle/TikTok) | Cordova `deviceready` only | low | ⚠ unverified — [3rd-party tooling](https://github.com/ppgee/cocos-pnp/blob/main/packages/playable-adapter-core/src/channels/rubeex/inject-vars.ts) only |
| **Nefta** | ⚠ unknown | ⚠ unknown | ⚠ no official limit (5 MB = TODO placeholder) | ⚠ unknown | none published | low | ⚠ unverified — [docs.nefta.io](https://docs.nefta.io/docs/advertise) (SDK/publisher only) |
| **Kwai (Kuaishou)** | ⚠ unknown | ⚠ unknown | ⚠ 5 MB (3rd-party only) | ⚠ unknown (Playturbo blank) | none published | low | ⚠ unverified — [Playturbo](https://doc.playturbo.com/export-and-deployment/playable-upload-specifications-for-networks.md) |
| **GDT (Tencent 优量汇)** | `window._gdtUnSdk.playAble.onClick()` | No (own GDTUnSdk) | **3 MB ZIP** | ZIP (index.html+config.json) | onSuccess/onError only | high | [Tencent GDT](https://developers.adnet.qq.com/doc/web/tryable) |
| **NewsBreak** | ⚠ none documented | ⚠ likely No | ⚠ no playable spec (private beta) | ⚠ unknown | none | low | ⚠ unverified — [biz.newsbreak.com](https://biz.newsbreak.com/) (no playable format) |
| **Yandex** | `yandexHTML5BannerApi.getClickURLNum(1)` (href, not a call) | No | **3 MB ZIP; index.html < 500 KB; ≤20 files** | ZIP | none | high | [Yandex](https://yandex.com/support/direct/en/products-mobile-apps-ads/recommendations) |

> **Note on Google DV360 / Enabler:** the old doc listed a "Google DV360 → `Enabler.exit()`" row. It is **not** a target in `src/networks.ts` and was not part of this verification pass — treat it as out-of-scope/unverified until re-researched.

---

## Detailed Requirements

Every size/SDK claim below carries its source URL.

### Facebook/Meta — `high`
- **CTA:** `FbPlayableAd.onCTAClick()` — provided by the Meta container at runtime; do NOT bundle an SDK. The validator statically checks the literal call appears in code (error "Missing CTA Click Function Call"). Meta uses it to navigate to the store.
- **Size:** single HTML ≤ **2 MB**; `index.html` inside a ZIP ≤ **2 MB**; **ZIP total ≤ 5 MB**; **≤ 100 files** in ZIP (>100 rejected). ("uncompressed" is a PlayCanvas characterization, not Meta's wording.) — [Meta](https://developers.facebook.com/docs/app-ads/formats/playable-ad/), [Business Help](https://www.facebook.com/business/help/412951382532338)
- **MRAID:** No — do not include mraid.js.
- **Format:** single self-contained `.html` (assets inline data-URI/base64) OR a ZIP with `index.html` at the archive **root**, resources referenced relative to it (e.g. `assets/splash.png`).
- **Blocked (official):** no JavaScript redirects; **no dynamic asset loading through external network** (officially confirmed). Treat localStorage/sessionStorage as unavailable (sandboxed iframe — widely observed, not in Meta docs).
- **Objective:** "Playable ads are only available with the App Installs objective." (The prior "all iOS/Android placements" claim was dropped — unverified.)
- **Validator:** [Playable Preview](https://developers.facebook.com/tools/playable-preview/). Full error list: Invalid App ID, Missing CTA Click Function Call, Uploaded Bundle Too Many SubAssets, Upload Too Large, Uploaded File Is Too Large, Redirect to External Link, Unsupported HTML/Objective/Placement.

### Moloco — `high`
- **CTA:** `FbPlayableAd.onCTAClick()` called **with no parameters** (Meta playable format).
- **Size:** **Less than 5 MB**, single HTML5 file (`.html`/`.htm`). **ZIP is explicitly forbidden** ("Ad file must not be compressed into .zip format for upload"). — [Moloco IEC guide](https://help.moloco.com/hc/en-us/articles/24124525963799-Playable-and-Interactive-End-Card-IEC-creative-guide) (direct fetch is HTTP 403 Zendesk bot-block; wording corroborated verbatim via web search).
- **MRAID:** No — must NOT include mraid.js.
- **Blocked (upload rejects):** `XMLHttpRequest`, mraid.js, any external references / HTTP requests, JS redirects, `.zip`. All assets must be **data-URI inline** (base64).
- **Validator:** auth-gated preview inside Moloco Ads Manager ([portal.moloco.cloud](https://portal.moloco.cloud/)); CTA click should pop "{action} action is working".

### Moloco V2.0 (Launcher API) — `med` (⚠ partner spec, not publicly documented)
- **CTA:** partner path uses MRAID `mraid.open(final_url)` via host-supplied mraid.js. Self-serve path uses `FbPlayableAd.onCTAClick()`.
- **Size:** payload creative < 5 MB; **launcher.html < 3 KB** hard ceiling — the 3 KB limit is from a partner-only "Playable Ad Integration v2.0" (Feb 2026) spec, NOT any network-owned public page. Enforced in code via `LAUNCHER_MAX_BYTES`.
- **API primitives confirmed on [developer.moloco.cloud](https://developer.moloco.cloud/docs/campaign-management-api):** `RICH_CUSTOM_HTML`, `/cm/v1/creative-assets` returning `asset_url` + `content_upload_url` (2-step POST+PUT), "MRAID2 compliance" flag. The two-file launcher+payload structure, `window.MOLOCO_MACROS`, `%{IMP_BEACON}`, `$PAYLOAD_URL`, macro beacons (mraid_viewable/game_viewable/click/complete/engagement/redirection) are **unverified partner-spec** (only in-repo source is `docs/plans/2026-05-28-moloco-v2-target-design.md`).
- **Recommendation:** label this target "partner spec, not publicly documented."

### Google Ads (App Campaigns) — `high`
- **CTA:** `ExitApi.exit()`, e.g. `<a onclick="ExitApi.exit()">`. If exitapi.js (or an MRAID framework equivalent) is omitted, Google auto-adds an "Install" button.
- **SDK:** `https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js` — must be a **literal `<script>` in `<head>`**, not JS-injected. — [Google](https://support.google.com/google-ads/answer/9981650)
- **Size:** **5 MB ZIP, ≤ 512 files, ≤ 20 ZIPs per ad group** (verbatim). Interstitial 320×480/480×320 assets may reach 5.2 MB per the fix-issues page, but 5 MB is the authoritative App-campaign number. — [Fix issues](https://support.google.com/google-ads/answer/12771973)
- **MRAID:** ExitApi is standard, but Google names an "MRAID framework equivalent" as an accepted alternative exit-script — MRAID is not prohibited (correction vs old "No MRAID").
- **Allowed external:** only Google Fonts, Google-hosted jQuery/GreenSock/CreateJS. **Prohibited:** iframe/frame/frameset, AMP tags, DoubleClick/Studio Enabler.js. File/folder names: letters, digits, `.`, `-`, `_` only.
- **Audio:** "Sound should not be enabled before the user interacts."
- **Validator:** [h5validator](https://h5validator.appspot.com/adwords/asset) is the **general** Google Ads HTML5 asset validator; its own help article says it "doesn't apply to HTML5 ads for App campaigns," and App-campaign docs cite no validator. (The old `/dcm/asset` URL was Campaign-Manager and deprecated Apr 2025.)

### AppLovin (Axon) — `high`
- **CTA:** `mraid.open()`. Must NOT auto-click/auto-redirect without user interaction, and must NOT redirect to a store on the **first tap/click**. (The old "redirect directly to the app store" wording is NOT on the official page — dropped.)
- **Size:** each ad file **≤ 5 MB**, **single HTML file**; all resources embedded as **base64 or base122**; external resources prohibited. — [AppLovin creative specs](https://support.applovin.com/en/growth/promoting-your-apps/welcome-to-applovin/creative-specs-and-guidelines) (support.axon.ai 301-redirects here).
- **MRAID:** v2.0 required. mraid.js referenced via `<script src="mraid.js"></script>` (injection-by-webview is standard MRAID convention, not stated on the page).
- **Lifecycle:** "Wait for the `ready` event (or confirm `mraid.getState()` is not 'loading') before calling any MRAID APIs or making layout/sizing decisions."
- **Orientation:** both landscape AND portrait required. **Audio:** muted until first user interaction; muted/stopped when ad closes or hidden. **WebGL:** provide a UI fallback if init fails / context is lost.
- **Unverified (not on the official page):** "don't add a custom close button" and "30 s max for rewarded MRAID." Axon Events (`window.ALPlayableAnalytics.trackEvent`) is a Luna/SDK feature, generally unavailable in raw-HTML playables.
- **Validator:** [Playable Preview](https://p.applov.in/playablePreview?create=1). No AppLovin-hosted SDK script to bundle.

### Unity Ads — `high`
- **CTA:** `mraid.open(storeUrl)` — never auto-redirect; must be user-initiated (not the very first touch).
- **Size:** **< 5 MB**, single `index.html` with all assets inlined & minified, no links to other files/folders. No ZIP path (single-HTML only). — [Unity specs](https://docs.unity.com/acquire/en-us/manual/playable-ads-specifications)
- **MRAID:** **3.0** (verbatim on the current spec). MRAID is **injected by the Unity Ads webview** — there is NO Unity-hosted SDK URL and NO instruction to add `<script src="mraid.js">`. (Correction: old doc said MRAID 2.0 + inject tag; the com.unity.ads@3.5 page was dropped as outdated.)
- **Lifecycle:** if `mraid.getState()==='loading'` add a `ready` listener; wait for `viewableChange` before starting; add a `viewableChange` listener to pause/resume; use `mraid.isViewable()`. — [Best practices](https://docs.unity.com/acquire/en-us/manual/playable-ads-best-practices)
- **Rules:** both orientations; no XHR (analytics without personal data permitted); must not block the close button/container UI; iOS 9.0+ / Android 4.4+.
- **Validator:** native Ad Testing app — [iOS](https://apps.apple.com/us/app/ad-testing/id1463016906) / Android `com.unity3d.auicreativetestapp`.

### ironSource (Unity LevelPlay) — `high`
Two official channels (do not conflate — this was a bug in the old doc):
- **UA playable (Unity Grow / LevelPlay UA):** **< 5 MB**, single inlined `index.html`, **MRAID 3.0**. CTA links directly to store via `mraid.open`; wait for `viewableChange` before starting; portrait+landscape; no XHR; Android 4.4+/iOS 9.0+. — [UA specs](https://docs.unity.com/en-us/grow/acquire/creatives/playable/specifications)
- **ironSource Exchange (programmatic):** **≤ 4 MB**, **MRAID 2.0**, must autoplay, must show a loading screen, all URLs HTTPS+absolute, use `mraid.getMaxSize()`, MRAID tag = HTML/JS snippets (not a full doc), no single-line HTML comments. — [Exchange MRAID guidelines](https://docs.unity.com/en-us/grow/programmatic/ironsource-exchange/mraid-specifications-guidelines)
- **DAPI mode (default/preferred):** `dapi.openStoreUrl()` (no URL arg — network resolves the store URL). `window.open()` not supported. Detailed DAPI event API (isReady/getAudioVolume/getScreenSize/addEventListener) is legacy/plausible — the old developers.is.com DAPI reference now 301-redirects into docs.unity.com and could not be re-confirmed verbatim.
- **Lifecycle gate:** MRAID `viewableChange` (same as Unity Ads), NOT "dapi ready / mraid ready" as the old doc implied.
- **Validator:** the old `demos.ironsrc.com/test-tool` is **DEPRECATED** (retired ~Mar 2023; DNS no longer resolves). Submit via the ironSource / Unity Grow dashboard.

### Mintegral — `high`
- **CTA:** `window.install()` — call as `window.install && window.install()`. No self-redirect; CTA button stays visible. — [2DKit](https://2dkit.com/playable-ads/create-mintegral-playable-ads-tutorial/)
- **Size:** **5 MB** max for the ZIP (or single HTML). All files except JS/HTML must be base64-inlined. — [Mintegral help center](https://helpcenter.mintegral.com/en/docs/asset-specs) (5M); ZIP wording from the JS-rendered [PlayTurbo /review/doc](https://www.playturbo.com/review/doc) (corroborated via search + [Luna](https://docs.lunalabs.io/docs/playable/ad-networks/mintegral/)).
- **MRAID:** No.
- **ZIP structure:** `name.zip` → `name/` → `name.html`, all three names **identical**; filenames `[A-Za-z0-9_]`; HTML must open via `file://`. **No config.json required** (PlayTurbo assigns config.json to TikTok specifically).
- **Lifecycle:** `gameReady` (we call on load), `gameStart` (we define, SDK calls). `gameEnd`/`gameRetry`/`gameClose` are consistent with the standard Mindworks lifecycle but **could not be re-verified this pass** (JS-rendered source). Never overwrite validator lifecycle functions.
- **Injection:** `window.install` + lifecycle fns are injected by the PlayTurbo preview env at runtime (unpredictable timing → **poll** for availability).
- **Validator:** [PlayTurbo review](https://www.playturbo.com/review/) (formerly mindworks-creative.com).

### Pangle (TikTok Pangle) — `high`
- **CTA:** `window.openAppStore()`. — [How to create Pangle playables](https://ads.tiktok.com/help/article/how-to-create-tiktok-pangle-playable-ads)
- **Size:** **ZIP only**, **smaller than 5 MB (after compression)**. Single-HTML not accepted. — same source + [Pangle asset specs](https://ads.tiktok.com/help/article/specifications-for-pangle-ad-assets)
- **SDK:** `https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js`, placed at the **bottom of `<body>`, before the developer's own JS**. See **SDK CDN correction** below.
- **MRAID:** No — mraid.js forbidden.
- **ZIP structure:** first-level dir must contain `index.html` + `config.json`. `config.json`: `{ "playable_orientation": 0 }` (0 = either, 1 = portrait, 2 = landscape). The old `playable_languages` field is NOT in official Pangle docs.
- **Blocked:** no dynamic external material, no JS redirects, no HTTP requests.
- **Resolutions:** 1280×720 / 720×1280; formats Interstitial + Rewarded. No standalone validator — preview in TikTok Ads Manager (store jump disabled in preview).

### TikTok — `high`
- **CTA:** `window.openAppStore()` (provided by the injected playable-sdk.js). No mraid.open, no JS redirects. Store jump disabled during preview. — [TikTok playable ads](https://ads.tiktok.com/help/article/playable-ads?lang=en)
- **Size:** **5 MB ZIP (after compression)**; Luna recommends ≤ 3 MB as a build target. — same source + [asset specs](https://ads.tiktok.com/help/article/specifications-for-pangle-ad-assets)
- **SDK:** `https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js` — **all-lowercase path confirmed live (HTTP 200, ~263 KB SDK)**; every capitalized variant 404s. Place at bottom of `<body>` before developer JS.
- **MRAID:** No — "should not be in mraid.js format."
- **ZIP structure:** `index.html` + `config.json` at first level; assets folder allowed. `config.json` orientation 0/1/2; optional `playable_languages` array (Luna).
- **Lifecycle:** **NONE officially defined.** The old `gameReady/gameStart/gameClose` sequence is an incorrect Mintegral carryover — remove it. Treat the adapter as CTA-only.
- **Blocked:** no external network material, no JS redirects, no HTTP requests. No official testing tool.

### Vungle (Liftoff Monetize) — Adaptive Creative — `high`
- **CTA:** `parent.postMessage("download","*")` on user interaction. Also required: `parent.postMessage("complete","*")` after a good portion has played (or after 3–5+ interactions). `download` and `complete` must **never** trigger together. Do NOT call the store directly. — [Dos and Don'ts](https://support.vungle.com/hc/en-us/articles/360056663752-Dos-and-Don-ts-of-Adaptive-Creative)
- **Size:** **5 MB total ZIP bundle** (all assets combined). — same source
- **Format:** flat ZIP; main HTML named `ad.html` OR `index.html` at root, all files at the same level (no nested dirs). The **Creative Verifier requires `index.html`** — package as `index.html`.
- **MRAID:** No — must NOT include mraid.js ("Adaptive Creative already uses MRAID"; the native SDK is the MRAID host). A separate DSP/Exchange path reportedly uses MRAID 2.0 (not verified this pass).
- **Lifecycle:** parent `index.html` (native SDK) wraps child `ad.html`; fires `ad-event-init` (then `VungleHelper` is safe: `closeDelay`, `rewardedAd`), `ad-event-pause`/`ad-event-resume`. — [Customize](https://support.vungle.com/hc/en-us/articles/360057120251-Customize-the-Adaptive-Creative-Experience), [Asset Requirements](https://support.vungle.com/hc/en-us/articles/360061060131-Adaptive-Creative-Asset-Requirements)
- **Gotchas:** no nested dirs; no external/remote assets or CORS resources; no direct store calls (implement ASOI); no custom close button; avoid vw/vh; never `document.location.reload`; support `START_MUTED`; both orientations. Endcard/FSC variants include `download` but NOT `complete`.
- **Validator:** [Creative Verifier](https://vungle.com/creative-verifier/). (support.vungle.com is Cloudflare-gated — quotes verified via Wayback.)

### AdColony (Digital Turbine / DT Exchange) — `med`
- **CTA:** `mraid.open(url)` — click tracking fires on the `mraid.open` event. Use `mraid.openStoreUrl()` if available. Not `useCustomClose` (that controls the close button). — [DT MRAID 2.0](https://docs.digitalturbine.com/dt-exchange/advertisers/ad-formats/mraid-2.0)
- **Size:** **No file-size limit OR recommendation is published** in any DT Exchange doc. The old "~2 MB recommended" was fabricated — dropped. Only concrete byte figure anywhere is a 239 KB sample game (2DKit example, not a cap). — [Ad types & spec](https://docs.digitalturbine.com/dt-exchange/publishers/additional-resources/ad-types-and-specification)
- **Format:** HTML (single MRAID 2.0 doc, assets inline); ZIP with `index.html` (adcolony-ad folder) accepted by build tooling.
- **MRAID:** 2.0. mraid.js injected by the container SDK — do NOT bundle your own.
- **Lifecycle:** ready → stateChange → viewableChange; interstitial default close appears after 5 s; **Rewarded Playable = 30 s max**, DT SDK adds a fail-safe Close after 30 s when `useCustomClose()` is detected.
- **Note:** AdColony as a standalone brand is EOL; specs flow through generic DTX/IAB MRAID docs. Validator: third-party [webtester.mraid.org](http://webtester.mraid.org/) (MRAID 2.0 + Interstitial); no first-party validator.

### Chartboost — `high`
- **CTA:** `mraid.open(url)` on CTA click. Never call `mraid.close()` — Chartboost injects its own close button (top-left). — [MRAID playable](https://docs.chartboost.com/en/advertising/creatives/mraid-playable/)
- **Size:** **3 MB hard maximum**, one single bundled standalone HTML file (no ZIP tier). — same source
- **MRAID:** 2.0. Blocked methods (will not function): `useCustomClose`, `expand`, `setExpandProperties`, `getExpandProperties`, `isCustomClose`, `resize`, `setResizeProperties`, `getResizeProperties`.
- **Lifecycle:** check `mraid.getState()` at start (may already be `DEFAULT`); `ready` fires only if initial state was `LOADING`. Events: ready, error, sizeChange, stateChange, viewableChange. MRAID library available during playback.
- **Validator:** in-dashboard MRAID Playable Uploader (green checks for "MRAID Close Call" + "MRAID Open Call"; tablet/phone toggle + rotate). Review ≤ 48 business hours; rejects purged within 30 days. — [Setup](https://docs.chartboost.com/en/advertising/creatives/setting-up-chartboost-mraid-playable/)
- **Corrections:** removed the false "Resize preview step" and the unverified "Account Manager must enable MRAID Playables first" claims. **3 MB is TIGHT for Cocos builds** — aggressive compression mandatory.

### Tapjoy (→ ironSource → Unity Grow) — `med`
- **CTA:** `window.TJ_API.click()` on CTA — terminates the playable (first signal wins). External links / `mraid.open()` NOT allowed. Guard: `window.TJ_API && window.TJ_API.click()`. — [Playables API PDF (live)](https://tapjoy-docs-production.s3.us-east-2.amazonaws.com/en/support/files/playables-api-v3.0.2.pdf)
- **Size:** **2 MB total** (code + assets), single file, all assets Base64-embedded. Both landscape+portrait (responsive preferred); HTTPS URLs. — [archived Testing Tool](http://web.archive.org/web/20230224042054/http://playable.tapjoy.com/)
- **MRAID:** No — uses `window.TJ_API` on the parent window.
- **Lifecycle (verbatim from the live PDF):** `setPlayableAPI(interface)` (recognizes `skipAd`), `click()`, `objectiveComplete()` (was `playableFinished`), `gameplayFinished()`; optional `setPlayableBuild(buildID)`, `error(cause)`. Runtime data: `TJ_API.adInfo {reward, currencyName}`, `TJ_API.directives.showEndCard`. Call `gameplayFinished()` when gameplay ends in **both** showEndCard branches, then check `showEndCard`.
- **Gotchas:** Tapjoy renders margin UI (timer, close, ToS) — keep critical UI off extreme edges. No SDK `<script>` to include.
- **Validator:** Tapjoy's Playable Testing Tool (`playable.tapjoy.com`) is **offline (NXDOMAIN)**; no live replacement found. Confidence lowered to med because two source URLs are dead / one quote was misattributed, though substance is confirmed via the live PDF + archived testing-tool.

### Liftoff (Accelerate / Creative Integration & API) — `high`
- **CTA:** `mraid.open()` (preferred) or `window.open()`; also `window.Liftoff.open()` (internally calls `mraid.open()`). Do NOT use `window.location`. Wait for MRAID `ready` before calling open. — [Creative Integration API](https://docs.liftoff.io/creative_integration_api)
- **Size:** **RECOMMENDATION, not a hard limit** — Liftoff *recommends* < 700 KB (1 MB at most) for creatives WITHOUT video, < 5 MB WITH video ("We recommend that the total size…"). Not enforced/rejected on size; no asset optimization by Liftoff. Our `maxSize: MB5` stays (advisory ceiling). **V2 is NOT a distinct integration** (unlike Moloco V2's launcher/payload): it is the same MRAID integration — CTA `window.Liftoff.open()` (which internally calls `mraid.open()`) or `mraid.open()` directly; output zip-or-HTML; V1 creatives still accepted. Our current `mraid:true` → `mraidBridge()` (`mraid.open`) + `dualFormat` config already conforms — **no separate `liftoffV2` target needed**. — [#v2](https://docs.liftoff.io/creative_integration_api#v2)
- **MRAID:** version **not specified** by the docs — mraid.open, `ready`, and viewableChange are referenced but no version. MRAID is exchange-injected. (The old "MRAID 2.0 / v2 guidelines" claim was unsupported — removed.)
- **Lifecycle:** add a `ready` listener; handle exchanges that don't fire `viewableChange` when already viewable at load ("causing creatives to hang").
- **Blocked/gotchas:** no iframe elements; no `window.location`; no autoplay audio (unlock on first tap); Web Workers need a Blob-URL/CORS fallback; filenames ASCII + case-sensitive. ZIP = single root folder with all assets; multi-file needs index.html. Ad sizes: 320×480/480×320, 768×1024/1024×768, 320×50, 728×90, 300×250; MP4 with moov atom at file start.
- **Validator:** Interactive Ad Validator at `https://app.liftoff.io/creatives/validator`. **This is Liftoff Accelerate/DSP, NOT "Liftoff Monetize" (Vungle).**

### Appreciate (Triapodi / DT DSP) — `low` ⚠ unverified
- **No Appreciate-owned playable spec exists.** Appreciate is a buy-side programmatic DSP (formerly Triapodi Ltd.), acquired by Digital Turbine (closed 2021-03-02, $22.5M cash + $6.0M bonuses). Creatives are served into third-party exchanges/SSPs and must satisfy the **receiving exchange's** generic IAB MRAID rules.
- **All fields below are generic-MRAID assumptions, not Appreciate-verified:** size (target well under 5 MB), format HTML, CTA `mraid.open(url)`, MRAID 2.0, gate on `mraid.viewableChange`. — [appreciate.mobi](https://appreciate.mobi/) renders only the word "Appreciate" (no redirect, no spec); parent [DT MRAID 2.0](https://docs.digitalturbine.com/dt-exchange/advertisers/ad-formats/mraid-2.0) covers general MRAID/supply-side only.
- Do NOT rely on the old "5 MB / HTML / mraid.open" as network-verified.

### Snapchat (App Playables) — `high`
- **CTA:** `ScPlayableAd.onCTAClick()` on CTA tap — Snap injects `window.ScPlayableAd`; NOT MRAID. (Correction: the old `mraid.open(url)` / "MRAID 2.0 / mraid ready" row is WRONG.) Confirmed in code by smoud (`src/core.ts` L478: `ScPlayableAd.onCTAClick()`; `src/protocols.ts` L86-88 detection). — [App Playables](https://businesshelp.snapchat.com/s/article/app-playables?language=en_US), [smoud core.ts](https://raw.githubusercontent.com/smoudjs/playable-sdk/9430aa21f1246e595381962527e465d87751faf5/src/core.ts)
- **Code state (fixed 2026-07-01):** `mraid: false`; `SnapchatAdapter.getPlbxBridge()` → `snapchatBridge()` emits `ScPlayableAd.onCTAClick()`, no mraid.js injected.
- **Size:** **5 MB uncompressed** (soft limit, total unpacked ZIP). PlayCanvas practical budget ~1.2 MB engine + ~30% base64 → ~3 MB raw assets (engine-specific). — same source + [PlayCanvas](https://developer.playcanvas.com/user-manual/editor/publishing/playable-ads/snapchat-playable-ads/)
- **Format:** ZIP with `index.html` + `config.json` BOTH at root (no subfolders). **Assets are hosted externally on Snapchat's CDN** (`external_url_prefix` e.g. `https://rtb-ads.shadow.snapads.com/html5`), NOT base64-embedded — opposite of Meta.
- **MRAID:** No — the asset "shouldn't require mraid.js." (PlayCanvas describes it as "MRAID 2.0-based," but the official page requires no mraid.js and forbids external HTTP.)
- **Blocked:** no mraid.js, no JS redirects, no dynamic external asset loading, no external HTTP requests.
- **Validator:** Snapchat "Creative Preview" Android app over HTTPS (ngrok). No public web validator. Confidence = med (official page is JS-rendered; wording via search-index snapshots + PlayCanvas).

### Bigo Ads — `high`
- **CTA:** `window.BGY_MRAID.open()` — **no URL argument**. The SDK reads the store address from `window.ADS_MRAID_CONFIG` (injected at serve time) and auto-wires the CTA button's onclick; a manual `open()` call cancels the `js_click` countdown. "The call to action must be integrated." — [Bigo playable help id=144](https://bigoads.com/help/detail?id=144&moduleId=14&currentLan=EN)
- **Size:** **ZIP < 5 MB after compression** (ZIP-only, no single-HTML path). — same source
- **SDK:** `https://static-web.likeevideo.com/as/common-static/big-data/dsp-public/bgy-mraid-sdk.js` (live, HTTP 200, 139,405 bytes; name "bigo-ads-dsp-mraid-sdk" v1.13.0). Include in `<body>` before your own JS.
- **MRAID:** No (own SDK). mraid.js explicitly forbidden.
- **ZIP structure:** first-level `index.html` + mandatory `config.json`; after decompress ONLY one HTML + config.json (inline all JS/CSS/img). Orientation: 0 = horizontal or vertical, 1 = vertical only, 2 = horizontal only.
- **Blocked (verbatim):** no mraid.js, no JS redirect, no HTTP requests.
- **Lifecycle:** SDK exposes `gameReady()` (fires GAME_START), tracks GAME_ENDED, `window.getPlayableStatus()`, optional `#bgy_endcard`, media-block logic. Testing via the Android "Playable Ads Test Demo" APK (technical doc on [Tencent Docs](https://docs.qq.com/doc/DRENxS3F0SUhHWnJD), non-official). The `gdl.news-cdn.site/.../2MX9uq.apk` validatorUrl resolves but has **no cited source** — unverified provenance.

### myTarget (VK Ads) — `high`
- **CTA:** `MTRG.onCTAClick()` (or `FbPlayableAd.onCTAClick()` as accepted alternative) — network injects the store target; no store URL embedded by the creator. — [VK Ads playable](https://target.vk.ru/help/advertisers/adformatplayableads/en)
- **Size:** **ZIP ≤ 2 MB**, consisting of ONE self-contained `index.html` (images base64, JS inline). — same source + [course](https://target.vk.ru/pro/en/courses/formats/playable-ads)
- **MRAID:** No — mraid.js explicitly forbidden (own API).
- **Constraints:** no HTTP requests; no JavaScript redirect; **vertical orientation**; adaptive design; required `<meta name="ad.size" content="width=100%,height=100%">`.
- **Note:** rebranded myTarget → VK Ads (docs now target.vk.ru). No SDK script; moderation is manual (no public validator).

### Bigabid — `low` ⚠ unverified
- **Programmatic DSP — no creative-upload spec.** Size ceiling / format / MRAID version are set by the host publisher app's SDK & exchange, not Bigabid. — [bigabid.com](https://www.bigabid.com/) (marketing only), [playable-trends blog](https://www.bigabid.com/why-playable-ads-and-longer-campaigns-are-trending-in-mobile-gaming/) (no tech spec).
- **Generic-MRAID inference only:** CTA `mraid.open(url)`, wait for `ready`, gate on `viewableChange`, don't bundle mraid.js, keep ≤ 5 MB as a safe default. Third-party [BidMachine](https://developers.bidmachine.io/dsp/bid-request/mraid-requirements) backs only the `viewableChange` impression-tracking pattern. Old row (mraid.open / MRAID / 5 MB / ZIP) is an unverified placeholder.

### InMobi — `high`
- **CTA:** click-tracking via `FbPlayableAd.onCTAClick()` **or** the `$HTML_ESC_CLICK_URL` macro; store redirect via `mraid.open(url)`. — [Creative specs](https://support.inmobi.com/choice/other-resources/creative-specifications-and-guidelines)
- **Size:** **5 MB max** — applies to both single-HTML and ZIP (Playable spec table). Do NOT apply the 200 KB/500 KB limit — that belongs to Animated/Static HTML5 Interstitial, not playables. — same source + [interstitial spec](https://support.inmobi.com/advertise/ad-formats-and-creatives/ad-specifications/interstitial)
- **Format:** both — single `index.html` (assets inlined data-URI) OR a zipped folder with `index.html` + structured subfolders.
- **MRAID:** **3.0** (correction: old doc said 2.0; the 2DKit "MRAID 2.0" claim is stale). Add `<script src="mraid.js"></script>` in `<head>` — container-provided, no absolute InMobi SDK URL.
- **Lifecycle:** wait for `mraid.viewableChange` before initializing. Playables follow the same requirements as Interactive End Cards (IECs).
- **Prohibited:** auto-redirect without a tap; external network requests; dynamic asset loading / JS redirects; including mraid.js inside IECs. oRTB: playable bids pass `attr id=13`; no timers; no `useCustomClose()`. Close-button safe area = 50×50 px top corners. No InMobi-owned validator.

### Adikteev — `med`
- **CTA:** `mraid.open(destinationUrl)` on click (mraidPartner auto-upgrade). Adikteev server-side click macros `AK_CLICK_DESTINATION_URL` / `AK_CLICK_PIXEL_URL` are injected into the head. — [smoud parseArgvOptions.js L30-41](https://raw.githubusercontent.com/smoudjs/playable-scripts/8188856411edda342568910ec3cd1786c2ce975a/core/utils/parseArgvOptions.js), [smoud generateAdikteevHtmlWebpackPluginConfig.js](https://raw.githubusercontent.com/smoudjs/playable-scripts/8188856411edda342568910ec3cd1786c2ce975a/core/utils/generateAdikteevHtmlWebpackPluginConfig.js)
- **Size:** **No official/automated file-size limit.** Neither Adikteev's own docs nor smoud's build impose a byte budget. Our `maxSize: MB5` is an internal cap, not a spec. (The only byte cap in Adikteev docs is the unrelated CTV "300 MB" video path.) — [CTV specs](https://help.adikteev.com/hc/en-us/articles/26397081117202-CTV-Creative-specifications)
- **Format:** **ZIP with an external `creative.js`** (NOT inlined) alongside `index.html` — confirmed by smoud (`zipOutputNetworks` includes `adikteev`; excluded from `HtmlInlineScriptPlugin`; `output.filename = 'creative.js'`). Our `format: 'zip'` is therefore CORRECT (an earlier note claiming "not ZIP / HTML-snippet" described Adikteev's *rich-media-tag* delivery, not the playable-build path). mraid.js is NOT injected (only ironsource/unity get MRAIDInjectorPlugin). — [smoud webpack.build.js L27-38/164/208](https://raw.githubusercontent.com/smoudjs/playable-scripts/8188856411edda342568910ec3cd1786c2ce975a/core/webpack.build.js)
- **MRAID:** uses MRAID protocol for the open() call, but the container/SSP provides mraid — do not bundle mraid.js.
- **Note:** managed-service DSP — no self-serve validator. Code state: `format:'zip'` ✅, `maxSize:MB5` = internal cap (no official limit).

### Smadex — `low` ⚠ unverified
- **No public playable/HTML5 spec** (size, ZIP, SDK, validator, lifecycle — none). Smadex is a mobile-first DSP (Entravision-owned). — [Creative Studio guide](https://smadex.com/smadex-creative-studio-guide/) (marketing only; MRAID mentioned only in a **video** context).
- **All values inferred/generic MRAID:** size UNKNOWN (comparable [Kayzen](https://help.kayzen.io/en/articles/5718423-html-and-playable-technical-specifications) prescribes index.html < 10 KB, < 5 MB CDN assets, < 1 MB total best-practice — not a Smadex value), CTA `mraid.open()`, MRAID version unspecified. A Smadex playable must satisfy the destination exchange/SSP's MRAID spec, not any Smadex-specific rule. Old "5 MB / HTML" is a generic default, not Smadex-verified.

### Rubeex — `low` ⚠ unverified (obscure — no network exists publicly)
- **No Rubeex ad-network site/portal/spec exists.** "Rubeex" appears only as a channel enum in third-party Cocos export tooling (ppgee/cocos-pnp, enigmkk/cocos-playable-adapter). — [inject-vars.ts source](https://github.com/ppgee/cocos-pnp/blob/main/packages/playable-adapter-core/src/channels/rubeex/inject-vars.ts)
- **What the tooling actually does:** injects a **Cordova** bootstrap (`cordova.js` + `deviceready` → `navigator.splashscreen.hide()`) and a default ByteDance/TikTok `playable-sdk.js` fallback; uses `exportZipFromPkg` → **multi-file package** (same path as Pangle/TikTok), NOT single self-contained HTML. No mraid.js anywhere.
- **Corrections vs old doc:** format is multi-file pkg (not "single HTML"); the `isZip` flag is a deflate-compression toggle, not an HTML-vs-ZIP switch; bootstrap is Cordova, not MRAID. Do NOT hardcode a Rubeex SDK URL or size limit — keep TODO/unverified.

### Nefta — `low` ⚠ unverified
- **No official Nefta playable spec exists publicly.** Nefta is publisher/SDK-side "AI-Powered Ad Monetization" integrated via AppLovin MAX / Unity LevelPlay / AdMob adapters. — [docs.nefta.io/advertise](https://docs.nefta.io/docs/advertise) (ROAS/campaign-oriented, zero creative-format spec), [welcome-overview](https://docs.nefta.io/docs/welcome-overview).
- The old "5 MB / HTML (ZIP opt.)" is an explicit TODO placeholder — do not trust the numbers. Nefta is NOT a supported target in Luna Labs' ~25-network list. **Recommendation:** treat as "no dedicated adapter needed"; if a playable must run under Nefta, target the mediation partner (MAX / LevelPlay / AdMob) and use that network's spec.

### Kwai (Kuaishou) — `low` ⚠ unverified
- **No network-owned self-serve playable spec** (kwai.com, e.kuaishou.com, ks-game-docs are login-gated or SDK-ad-type only). Kwai runs interactive creatives through managed tooling (磁力灵鹿 / Kwai for Business). — [ks-game-docs](https://ks-game-docs.kuaishou.com/guide/activity/7.advert.html), [Magnetic Engine portal](https://developers.e.kuaishou.com/).
- **Best available (third-party only):** [Playturbo](https://doc.playturbo.com/export-and-deployment/playable-upload-specifications-for-networks.md) lists **5 MB** for Kwai, but its **File Format column is BLANK** — ZIP is NOT confirmed. CTA / MRAID / SDK / lifecycle all UNKNOWN. Keep 5 MB tentative; flag format+CTA+MRAID as unverified; obtain the real spec from a Kwai/Kuaishou account manager.

### GDT (Tencent Guangdiantong / 优量汇) — `high`
- **CTA:** `window._gdtUnSdk.playAble.onClick()` (exact casing `playAble`) — developer reports the click, SDK performs the store jump. First instantiate `window._gdtUnSdk = new window.GDTUnSdk({ type: 'playable', onSuccess, onError })`. Guard: `window._gdtUnSdk && ...`. — [优量汇 playable doc](https://developers.adnet.qq.com/doc/web/tryable)
- **Size:** **ZIP ≤ 3 MB** (`包大小：不大于3M`). Always a ZIP. — same source + [PlayTurbo confirmation](https://doc.playturbo.cn/su-cai-dao-chu-tou-fang-xiang-guan-wen-dang/ke-wan-guang-gao-qu-dao-shang-chuan-gui-fan)
- **SDK:** `https://qzs.gdtimg.com/union/res/union_sdk/page/unjs/unsdk.js` — in `<head>`, https only, no `crossorigin`.
- **MRAID:** No — mraid.js forbidden (`素材中不允许使用mraid.js格式`). Uses Tencent's GDTUnSdk API.
- **ZIP structure:** root must contain `index.html` + `config.json`; relative asset paths only. `config.json`: `{"config":{"play_direction":0}}` (0 = both, 1 = portrait, 2 = landscape).
- **Lifecycle:** only `onSuccess`/`onError` callbacks — no game lifecycle events.
- **Blocked:** no external dynamic asset loading; no JS redirects; no HTTP/HTTPS except Tencent analytics; no `document.write` (upload error `index.html页面包含了document.write方法`); filenames `[A-Za-z0-9._-]` (no Chinese). Validator: upload-time in the 投放端 console; [self-test guide](https://docs.qq.com/doc/DTklETEhTc0J6akJZ?pub=1) (Tencent Doc).

### NewsBreak — `low` ⚠ unverified
- **No public playable spec — playables are private beta only.** NewsBreak's [Product Catalog deck](https://docs.google.com/presentation/d/1jKx__G-p8AL-rMfT-yLio9cTp4v3NET7Xa9ahAIMzhc/edit) enumerates ~13 native/image/video/banner/app-open units, none playable/HTML5/MRAID. Documented ceilings are 5 MB (native image/GIF/video/App Open), 500 KB (interscroller), 100 KB (banners) — **not** a playable spec. — [biz.newsbreak.com](https://biz.newsbreak.com/), [Creative Guidelines PDF](https://static.newsbreak.com/ads-platform/assets/newsbreak/Advertising_Creative_Guidelines.pdf)
- A [2025 rep interview](https://cpvlab.pro/blog/champions-of-performance-marketing/katie-mulliken/) confirms playables are "starting to test," public "very soon." **Mark NewsBreak as "playable in private beta, spec via account contact."** Any "5 MB / HTML / No MRAID" row is unverified for a playable.

### Yandex — `high`
- **CTA:** no `open()` call — set an anchor's `href` to `yandexHTML5BannerApi.getClickURLNum(1)` (multiple areas: `getClickURLNum(2)`, `(3)`…). The `yandexHTML5BannerApi` object is injected by the serving environment. — [Mobile-apps ads recommendations](https://yandex.com/support/direct/en/products-mobile-apps-ads/recommendations)
- **Size:** **3 MB ZIP total**; `index.html` inside the ZIP must be **< 500 KB**; archive **≤ 20 files** (interactive-banner = the closest Yandex product to a playable). — same source
- **Format:** ZIP (single HTML at root + separate JS/JSON/CSS/JPEG/GIF/PNG/SVG files).
- **MRAID:** No.
- **Hard blockers for a Cocos playable:** a self-contained inline-everything HTML will BLOW the 500 KB index cap (assets must be separate files, but only 20 total). **AUDIO AND VIDEO CLIPS ARE PROHIBITED** ("In HTML5, you can't use video or audio clips") — audio must be stripped. All links relative; no external network requests when served; file/dir names `[A-Za-z0-9-._~]`. — [general HTML5 requirements](https://yandex.com/adv/requirements/html5), [CPM requirements](https://yandex.ru/support/direct/en/products-cpm-campaign/requirements)
- **Note:** the codebase's `res.js` bundle name is NOT confirmed by any Yandex source (likely a third-party exporter convention). Validator: manual moderation in Yandex Direct.

---

## CTA Methods Summary

| Method | Networks |
|--------|---------|
| `mraid.open(url)` | AppLovin, Unity, ironSource (MRAID mode), AdColony, Chartboost, Liftoff, InMobi (redirect), Adikteev, Appreciate ⚠, Bigabid ⚠, Smadex ⚠ |
| `dapi.openStoreUrl()` | ironSource (DAPI mode) |
| `FbPlayableAd.onCTAClick()` | Facebook/Meta, Moloco, myTarget (alt), InMobi (click-track alt) |
| `ScPlayableAd.onCTAClick()` | Snapchat |
| `MTRG.onCTAClick()` | myTarget (VK Ads) |
| `ExitApi.exit()` | Google Ads |
| `window.openAppStore()` | TikTok, Pangle |
| `window.install()` | Mintegral |
| `window.TJ_API.click()` | Tapjoy |
| `parent.postMessage("download","*")` | Vungle (Adaptive) |
| `window.BGY_MRAID.open()` (no arg) | Bigo |
| `window._gdtUnSdk.playAble.onClick()` | GDT (Tencent) |
| `yandexHTML5BannerApi.getClickURLNum(1)` (href) | Yandex |
| Cordova bootstrap only (no CTA) | Rubeex ⚠ |
| Unknown / not documented | Kwai ⚠, Nefta ⚠, NewsBreak ⚠ |

---

## SDK / Script Injection

| Network | Injected / referenced script | Notes |
|---------|------------------------------|-------|
| MRAID networks (AppLovin, Unity, ironSource, AdColony, Chartboost, Liftoff, InMobi, Adikteev, …) | `<script src="mraid.js"></script>` (relative) or none | mraid.js is **container/webview-injected** — no hosted URL to bundle. Unity/InMobi explicitly inject it (Unity: no script tag needed). |
| Google Ads | `https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js` | Literal `<script>` in `<head>`, not JS-injected |
| **TikTok** | `https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js` | Lowercase path confirmed live (HTTP 200, v3.49.0). Bottom of `<body>`, before dev JS |
| **Pangle** | `https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js` | ✅ fixed 2026-07-01 (was stale `pstatp.com` v3.4.1) — see correction below |
| GDT (Tencent) | `https://qzs.gdtimg.com/union/res/union_sdk/page/unjs/unsdk.js` | In `<head>`, https, no `crossorigin` |
| Bigo | `https://static-web.likeevideo.com/as/common-static/big-data/dsp-public/bgy-mraid-sdk.js` | In `<body>` before dev JS; live 139 KB, v1.13.0 |
| Facebook/Meta, Moloco, myTarget, Snapchat, Tapjoy, Vungle | none | CTA function provided by the container at runtime — do NOT bundle |

### ⚠ TikTok vs Pangle SDK CDN — corrected

The old doc treated the TikTok/Pangle SDK as one interchangeable URL. Verified reality:

- **One SDK family, two builds.** Both are the same `union-fe-nc` "playable_sdk" webpack bundle with an identical public API (`download`/CTA, `HIDE_PLAYABLE_DOWNLOAD_BUTTON`, `viewableChange`, `_tt_config`).
- **ibytedtos i18n build (current):** `.../union-fe-nc-i18n/playable/sdk/playable-sdk.js` — v3.49.0, 263 KB, HTTP 200. This is what the official [How to create TikTok Pangle Playable Ads](https://ads.tiktok.com/help/article/how-to-create-tiktok-pangle-playable-ads) page serves verbatim, and what the validator/moderation expects.
- **pstatp build (stale):** `sf3-ttcdn-tos.pstatp.com/obj/union-fe-nc/...` — v3.4.1, 315 KB, an old un-maintained mirror. Still HTTP 200 but risks moderation/behavior mismatch.
- **Status (2026-07-01): APPLIED.** Pangle now uses the ibytedtos i18n URL (identical to `tiktok`). Swap was safe — byte-verified identical public API, v3.4.1 → v3.49.0 upgrade.

---

## Special ZIP / Package Structures

| Network | Structure |
|---------|-----------|
| Mintegral | `{name}.zip` → `{name}/` → `{name}.html` (all three names identical); assets inlined; no config.json |
| TikTok / Pangle | `index.html` + `config.json` at first level (orientation 0/1/2); TikTok also optional `playable_languages` |
| Bigo | `index.html` + mandatory `config.json` at first level (orientation 0/1/2); one HTML only |
| GDT (Tencent) | root `index.html` + `config.json` (`play_direction` 0/1/2); relative asset paths |
| Snapchat | `index.html` + `config.json` at root (no subfolders); **assets external on Snap CDN** |
| Google Ads | `index.html` + assets (relative paths); ≤ 512 files |
| Yandex | single HTML at root + separate JS/JSON/CSS/img files; ≤ 20 files; index.html < 500 KB |
| Vungle | `index.html` at root, **flat** (no nested dirs) |
| myTarget | ZIP wrapping a single base64 `index.html` |
| Facebook/Meta (ZIP mode) | `index.html` at archive **root**, resources relative |
| Rubeex ⚠ | multi-file package (Cordova-injected), like Pangle/TikTok |
| Standard ZIP | `index.html` + assets (flat) |

---

## Critical Rules (cross-network)

1. **Use the network's own CTA** — do not hard-redirect via `window.location`; most networks reject auto-redirect and first-tap redirect.
2. **Never overwrite validator lifecycle functions** — `gameReady` is defined by the validator (Mintegral) and called by us; `gameStart` is defined by us and called by the validator.
3. **No external network requests** for most networks — inline assets (base64/data-URI). Exceptions with external assets: Snapchat (CDN), Adikteev (CDN JS/CSS), Yandex (separate files in ZIP).
4. **Respect size ceilings — several are tight:** Chartboost 3 MB, GDT 3 MB, Yandex 3 MB (index < 500 KB), myTarget/Tapjoy 2 MB, Liftoff < 700 KB (no video).
5. **Audio:** muted until first user interaction; muted on background/close. Yandex forbids audio/video clips entirely.
6. **No custom close button** where the network provides one (AppLovin, Unity, ironSource, Chartboost, Bigo, Vungle).
7. **Both orientations** unless the network mandates one (myTarget = vertical; GDT/TikTok/Bigo/Pangle set via config.json).
8. **Test in the network validator** where one exists before submission.

---

## Validators Quick Reference

| Network | Validator | Status |
|---------|-----------|--------|
| Facebook/Meta | https://developers.facebook.com/tools/playable-preview/ | live |
| AppLovin | https://p.applov.in/playablePreview?create=1 | live |
| Unity | native Ad Testing app ([iOS](https://apps.apple.com/us/app/ad-testing/id1463016906) / `com.unity3d.auicreativetestapp`) | live |
| ironSource | ~~demos.ironsrc.com/test-tool~~ | **deprecated (~Mar 2023, DNS dead)** → submit via Unity Grow dashboard |
| Mintegral | https://www.playturbo.com/review/ | live (JS-rendered) |
| Vungle | https://vungle.com/creative-verifier/ | live (Cloudflare-gated) |
| Chartboost | in-dashboard MRAID Playable Uploader | live |
| Liftoff (Accelerate) | https://app.liftoff.io/creatives/validator | live |
| Google Ads | https://h5validator.appspot.com/adwords/asset | live, but "does not apply to App campaigns" |
| Tapjoy | ~~playable.tapjoy.com~~ | **offline (NXDOMAIN)** |
| Snapchat | Creative Preview Android app (HTTPS) | live |
| AdColony | third-party webtester.mraid.org | non-official |
| TikTok/Pangle, Bigo, GDT, myTarget | in-dashboard / upload-time only | no standalone URL |
| Appreciate, Bigabid, Smadex, Rubeex, Nefta, Kwai, NewsBreak | — | ⚠ none / unverified |

---

## Tools

- [PlayTurbo](https://www.playturbo.com/review/) — Mindworks playable review (Mintegral)
- [@smoud/playable-sdk](https://github.com/smoudjs/playable-sdk) — universal SDK for many networks
- [super-html](https://store.cocos.com/app/detail/3657) — Cocos Creator packaging tool
- [Luna Labs docs](https://docs.lunalabs.io/docs/playable/ad-networks/overview/) — per-network export reference
- [2DKit tutorials](https://2dkit.com/playable-ads/) — per-network build walkthroughs

---

## Codebase Discrepancies (`src/networks.ts`)

Reflects the CURRENT code state as of 2026-07-01. The former `MB4` constant was **removed**.

### Fixed this pass (2026-07-01) ✅

| Network | Change applied | Source |
|---------|---------------|--------|
| TikTok / Pangle `maxSize` | `MB4` → `MB5` (MB4 const removed) | TikTok Ads Help (5 MB after compression) |
| Pangle `sdkUrl` | stale `pstatp.com` v3.4.1 → `ibytedtos.com` i18n v3.49.0 (= TikTok) | official Pangle create-playable doc + byte-verified version strings |
| Facebook `htmlMaxSize` | added `MB2`; validator now enforces per-format (HTML ≤ 2 MB / ZIP ≤ 5 MB) via `maxSizeForFormat()` | Meta playable specs |
| Moloco `dualFormat` | `true` → `false` (Moloco forbids ZIP — HTML-only) | Moloco IEC guide |
| GDT `maxSize` + `sdkUrl` | `MB5` → `MB3`; added `qzs.gdtimg.com/.../unsdk.js` | 优量汇 spec (包大小不大于3M) |
| Snapchat `mraid` + CTA | `mraid:true` → `false`; `SnapchatAdapter` → `snapchatBridge()` (`ScPlayableAd.onCTAClick()`, no mraid.js) | smoud core.ts + Snap App Playables |
| AdColony `maxSize` | `MB2` → `MB5` (internal cap; no official limit exists) | user decision + DT Exchange has no published cap |

### Already correct (unchanged) ✅

`Chartboost` MB3 · `myTarget` MB2 · `Tapjoy` 1.9 MB · `Yandex` MB3 · `Mintegral` htmlMatchesZipName · `Adikteev` format:'zip' (+ external creative.js, per smoud) · `AppLovin`/`Unity`/`ironSource`/`inMobi` 5 MB.

### Remaining backlog 🔧

| # | Network | Current | Note | Priority |
|---|---------|---------|------|----------|
| 1 | **Liftoff** `maxSize` (`:77`) | `MB5` | Size is a **recommendation, not enforced** (< 700 KB no-video / < 5 MB with-video). Keep `MB5`. **V2 needs no separate target** — same MRAID integration (`window.Liftoff.open()` wraps `mraid.open()`); current config conforms. | resolved |
| 2 | **myTarget** CTA | (base bridge) | smoud emits `FbPlayableAd.onCTAClick()`; VK official says `MTRG.onCTAClick()` — both accepted. Verify which our adapter emits. | low |
| 3 | **InMobi** `format` (`:223`) | `html` | Also supports ZIP; could set `dualFormat`. | low |
| 4 | **Yandex** `jsBundle:'res.js'` | `res.js` | Not confirmed by any Yandex source — likely 3rd-party convention; verify or drop. | low |
| 5 | **Unity / InMobi** MRAID version | `mraid:boolean` | Docs say MRAID **3.0**; the config has no version field — informational only, no code change possible without a new field. | low |

### ⚠ Unverified networks (leave as TODO / obtain from account contact)

`smadex`, `rubeex`, `nefta`, `kwai`, `newsbreak`, `appreciate`, `bigabid` all carry generic `MB5`/`html`/`zip` placeholders with **no network-owned source** backing them. Do not present their `maxSize`/`format`/`mraid` values as fact:
- `nefta` — no playable spec; route through mediation partner (MAX/LevelPlay/AdMob).
- `kwai` — 5 MB is third-party only; format/CTA/MRAID unknown.
- `rubeex` — 3rd-party tooling only; Cordova multi-file pkg, not single HTML.
- `newsbreak` — playable in private beta; no format.
- `appreciate`, `bigabid`, `smadex` — programmatic DSPs; spec = destination exchange's MRAID rules.
