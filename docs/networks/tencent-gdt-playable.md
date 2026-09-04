# Tencent Ads / 优量汇 (GDT, Youlianghui) — Playable ("试玩广告") Creative Spec

**Status:** spec + implemented in the kit (2026-09-04). Registry id: `gdt`,
label «Tencent Ads (优量汇 / GDT)» — one network, historical id kept.
**Owner:** kit (packaging + validation rules), extension (panel/preview UI — see
the extension's `docs/networks/tencent-gdt.md`).

Sources (read 2026-09-04, English UI of the official doc):

- <https://developers.adnet.qq.com/doc/web/tryable> — "[Youlianghui] Trial Ad
  Integration Documentation" (primary; sections I–VII below map to it)
- <https://docs.qq.com/doc/DTklETEhTc0J6akJZ?pub=1> — "Playable Ad Creative
  Self-Testing Guide" (Tencent Docs, linked from §4.4 / §VII)
- <https://docs.qq.com/doc/DVHdGdldZVmhzV1lp?pub=1&dver=2.1.0> — FAQ (§VII)
- `docs/research/ad-networks-reference.md` § GDT — earlier one-paragraph digest

Naming: the ad-serving product is **优量汇 (Youlianghui)** — Tencent's mobile ad
network (the former 广点通 / GDT, hence our `gdt` id and the `GDTUnSdk` global).
"Trial ad" / "playback ad" / "试玩广告" in the doc all mean *playable*.

## 1. Delivery model

A playable on 优量汇 is **not a standalone unit** — it is attached to a
**rewarded video**. The video plays, then the playable page pops up
automatically, and its download button sends the user to the store
(the doc's intro names the Apple App Store only; the console itself is
platform-agnostic — not stated = not assumed for Android).

Consequences:

- **No lifecycle contract.** The SDK has no `gameReady` / `gameEnd` /
  `gameClose`; the container never calls into the creative and the creative
  never signals readiness or completion. Only the CTA click is reported.
- **Both orientations, always.** The doc says in bold: creatives must be
  compatible with portrait *and* landscape and with different device models.
  `play_direction` in `config.json` (§3) declares which the creative *supports*;
  it does not lock the container.
- Every creative is reviewed by 优量汇 (审核) before it can be attached to an ad,
  and playables are **whitelisted per advertiser** first (§2).

## 2. Overall process (doc §II)

1. **Build the creative + integrate the SDK** (§3, §4 below).
2. **Whitelist application.** The advertiser gives 优量汇 account ID, account
   info, product ID etc.; submits **screenshots of the self-test** for a
   technical review; ops opens the playable whitelist for the account.
3. **Upload the ZIP** — delivery platform → Toolbox (工具箱) → Media Center
   (素材中心) → tab **试玩素材** → **上传试玩素材**. The upload-time validator
   rejects on the errors in §6. Each row then shows name, link, display
   direction (竖屏 / 横屏) and review status.
4. **Attach to an ad.** New ad → placement **优量汇** → scenario 自定义 →
   tick **激励视频** (rewarded video) → in the creative form pick the uploaded
   playable in the optional field **试玩素材（选填）**, then submit and run.

## 3. Package spec (doc §III)

| Item | Requirement |
|------|-------------|
| Format | **ZIP.** Root must contain `index.html` **and** `config.json`; other dirs/files alongside are fine. |
| Max size | **3 MB** ("Package size: No more than 3M"). |
| `index.html` | First-level root. Static resources via **relative paths**; absolute URLs are forbidden **except the SDK**. |
| `config.json` | First-level root. Schema in §3.1. Missing → upload reject. |
| File names | `A–Z a–z 0–9 . - _` only. **No Chinese characters** in any file or directory name (upload reject: `file or directory name include non utf-8 encoding chinese characters`). |
| MRAID | **`mraid.js` is forbidden** ("The mraid.js format is not allowed in the materials"). |
| External loading | No dynamic material loaded from external networks. |
| Redirects | No JavaScript redirects. |
| Network | No HTTP/HTTPS requests **except Tencent Statistics**. |
| `crossorigin` | Do **not** set `crossorigin` on `<script>` tags. |
| `document.write` | Forbidden — upload reject `index.html has unsafe function` ("contains the document.write method"). |
| Orientation | Must work in both; declare support via `play_direction`. |

### 3.1 `config.json`

```json
{
  "name": "playable name",
  "version": "0.0.1",
  "config": {
    "play_direction": 0
  }
}
```

| Field | Meaning |
|---|---|
| `name` | Creative name (shown in the media-center list). |
| `version` | Creative version string. |
| `config.play_direction` | Supported play direction. **`0` = both (default), `1` = portrait (竖版), `2` = landscape (横版).** |

Our `orientation` setting maps: `auto → 0`, `portrait → 1`, `landscape → 2`
(same shape as Pangle's `playable_orientation`, different key).

## 4. SDK contract (doc §IV) — `unsdk.js` / `GDTUnSdk`

Include in `<head>`, **https only** (the doc's comment: 请勿写死 http — never
hard-code http), no `crossorigin`:

```html
<script type="text/javascript" src="https://qzs.gdtimg.com/union/res/union_sdk/page/unjs/unsdk.js"></script>
```

Instantiate once, then report the click yourself on CTA:

```js
window._gdtUnSdk = new window.GDTUnSdk({
  type: 'playable',              // String, REQUIRED — anything else → error 1002
  onSuccess: function (res) {},  // optional; click reported OK (recommended for debugging)
  onError: function (res) {},    // optional; instantiation failed → SDK error code
});

// On CTA tap — developer calls it; the SDK performs the store jump.
window._gdtUnSdk && window._gdtUnSdk.playAble.onClick();
```

Traps:

- Casing is **`playAble.onClick()`** — capital A. `playable.onClick` is
  `undefined`.
- The guard `window._gdtUnSdk && …` is part of the reference code: the SDK is
  the only external script and the page must not throw if it failed to load.
- The SDK does the redirect. The creative must **not** `window.open()` /
  `location.href` the store itself — that is the "JavaScript redirect" the
  safety rules forbid, and it is untracked.
- Direction of calls: creative → SDK only. Nothing in the container calls the
  creative (compare `docs/networks/lifecycle-call-direction.md`).

SDK error codes (doc §VII):

| Code | Meaning | Fix |
|---|---|---|
| `1002` | Wrong instantiation `type` | Set `type: 'playable'`. |

## 5. Self-test (doc §4.4)

After SDK integration the creative is self-tested per the "Playable Ad Creative
Self-Testing Guide" (Tencent Docs link above). The self-test screenshots are
part of the whitelist application (§2.2) — keep them. There is no public
standalone validator URL; the only automated gate is the upload-time check
(§6).

## 6. Upload-time validator errors (doc §VII)

| Error text | Cause |
|---|---|
| `zip file contains unsafe file, xxx` | Path `xxx` violates the directory spec (the offending path is printed). |
| `zip file does not contain index.html in root path` | No root `index.html` (nested in a folder counts as missing). |
| `zip file does not contain index.html in root path` *(sic — second row)* | The doc's second row is a copy-paste; its explanation says **root `config.json` is missing**. |
| `upload zip file failed` | Platform error; retry / contact support. |
| `index.html has unsafe function` | `index.html` contains `document.write`. |
| `file or directory name include non utf-8 encoding chinese characters` | A file/dir name has Chinese characters. |

## 7. Kit implementation (`GdtAdapter`, 2026-09-04)

Registry (`src/networks.ts`): id `gdt`, name `Tencent Ads (优量汇 / GDT)`,
`format: 'zip'`, `maxSize: MB3`, `mraid: false`, `sdkUrl: …/unsdk.js`,
`singleFileZip: true`. Forbidden strings: `mraid.js` (non-MRAID default) +
`document.write` + `crossorigin`, with hints in `FORBIDDEN_STRING_HINTS`.

Adapter (`src/packager/network-adapters/gdt.ts`):

| Spec item | Kit |
|---|---|
| ZIP, root `index.html` + `config.json` | single-file ZIP; `getZipConfig` → `{ name: appName \|\| 'playable', version: '0.0.1', config: { play_direction } }` |
| `play_direction` | `auto → 0`, `portrait → 1`, `landscape → 2` |
| SDK in `<head>`, https, no `crossorigin` | `BaseAdapter` injects `<script src="…unsdk.js">` from `sdkUrl` |
| Instantiate `GDTUnSdk({ type: 'playable' })` | `gdtBridge()`: eager at load **and** lazy on first CTA (`_plbxGdt()`), guarded — SDK may load late or be absent on `file://` / preview |
| CTA `_gdtUnSdk.playAble.onClick()` | `plbx_html.download`, `window.install()` and direct `window.open(u)` all route there; `window.open` stays only as the no-SDK dev fallback |
| No lifecycle | nothing wired; `game_end` / `on_game_start` are the inert base defaults |
| `document.write` / `crossorigin` / `mraid.js` | packaging aborts on any hit in the final HTML (same naive scan the uploader runs) |
| Preview (`src/preview/sdk-mocks.ts`) | `expectedCtaMethod('gdt') = 'gdt_onclick'`; accessor trap on `window.GDTUnSdk` wraps the real constructor and decorates `playAble.onClick` with the beacon; mock constructor after ~3 s offline. A bare `window.open` now reads as an **incorrect** CTA. |

Verified on the roadside Cocos fixture: ZIP = `index.html` + `config.json`,
zero forbidden-string hits, SDK tag emitted without `crossorigin`. (That
uncompressed fixture is 3.4 MB → `withinLimit: false`; compress first.)

Tests: `tests/packager/network-adapters.test.ts` (Tencent block),
`tests/packager/packager.test.ts` (real ZIP contents),
`tests/preview/sdk-mocks.test.ts`.

## 8. Prior art: `smoudjs/playable-sdk` — reference, not a source

`smoudjs/playable-sdk` v1.1.4 + `playable-scripts` v1.2.14 (both 2026-09-02)
added `tencent` in one batch commit with YouAppi and Aarki. Compared against
the official 优量汇 doc:

| Item | smoudjs | 优量汇 spec | Verdict |
|---|---|---|---|
| Protocol | `tencent` is in `mraidPartners` → `MRAIDInjectorPlugin` adds `<script src="mraid.js">` | **`mraid.js` forbidden** ("not allowed in the materials") | ❌ would be rejected |
| CTA | `window.TencentGDT.clickOpen()`, else falls through to `mraid.open(url)` | `window._gdtUnSdk.playAble.onClick()` after `new GDTUnSdk({ type: 'playable' })` | ❌ `TencentGDT.clickOpen` appears **nowhere** outside smoudjs (GitHub code search: 1 repo; no Tencent doc); the fallback is a JS redirect |
| SDK script | none (`unsdk.js` not injected) | `unsdk.js` in `<head>` | ❌ |
| Output | ZIP (`zipOutputNetworks`) | ZIP | ✅ |
| `config.json` | none (only `tiktok-config.json` / `snapchat-config.json` resources exist) | mandatory, `play_direction` | ❌ upload reject |
| Size | no network-specific cap | 3 MB | — |
| Source cited | none in commit, README or code | — | unverifiable |

`TencentGDT` *is* a real global — of Tencent's **H5 publisher** SDK
(`window.TencentGDT = window.TencentGDT || []`, the media-side ad-loading
script), not of the playable SDK. The two are different products; treating the
name match as the playable CTA is the same trap as `gameStart` across
networks (`lifecycle-call-direction.md`). Keep smoudjs as a cross-check for
network *lists* and packaging *shapes*; take contracts from the network's own
doc.

## 9. Open items (not stated = not assumed)

- Whether the upload validator's "no HTTP/HTTPS except Tencent Statistics"
  check is static (scan for `http` strings) or runtime. Our inlined loader
  makes no requests, but the Cocos runtime source contains URL strings and the
  bridge keeps a literal `window.open` fallback; no reject for either has been
  observed yet.
- Android store: the intro only mentions the Apple Store. The SDK owns the
  redirect, so the creative never needs a store URL — irrelevant to packaging,
  relevant to campaign setup.
- Size accounting: whether 3 MB is the ZIP size or the unpacked size. Our
  `maxSize` check applies to the emitted artifact (ZIP); a single inlined HTML
  compresses poorly (base64), so treat the two as the same number.
- `name` in `config.json` is free text; we emit `appName` (ASCII expected —
  the file-name rule is about paths, not this field, but stay safe).
- The self-test guide and FAQ are Tencent Docs pages (login may be required);
  their content was not captured here.
