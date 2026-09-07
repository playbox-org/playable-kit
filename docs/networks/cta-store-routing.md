# CTA store routing: the device picks the store, not the packager

## The bug

`plbx_html.download()` resolved its destination as:

```js
url = url || this.google_play_url || this.appstore_url || "";
```

Google Play always won. An iPhone that tapped the CTA was handed a
`play.google.com` link — a dead end on iOS. Reported from production on a
free-stack (Three.js/Pixi) creative packaged for the MRAID networks, where the
resolved URL is passed straight to `mraid.open(url)`.

## Why game code cannot fix it

The obvious workaround — publish only the URL for the current platform — is
not available. `src/checks/network-checks.ts` (`google_play_url`,
`app_store_url`) requires **both** store URLs to appear in the artifact as
plaintext, because network validators grep the raw HTML for them. A creative
that emits one URL conditionally fails review.

So the pick has to happen at click time, inside the bridge.

## The rule

`STORE_FOR_DEVICE` in `src/packager/network-adapters/base.ts` is the single
source of truth, applied by both `download()` and the MRAID `window.install()`
override so the two cannot drift. `storeForDevice()` in `src/sdk/index.ts`
mirrors it for the preview stub, so a creative behaves the same in `vite dev`
as it does packaged.

```js
var ios = /iPad|iPhone|iPod/.test(n.userAgent || "") ||
  (n.platform === "MacIntel" && n.maxTouchPoints > 1);
ios ? (b.appstore_url || b.google_play_url)
    : (b.google_play_url || b.appstore_url)
```

Three things worth keeping:

- **iPadOS is not detectable by UA.** Since iPadOS 13 Safari ships the desktop
  Mac user agent on purpose. `MacIntel` + a touch screen is the only tell left;
  a real Mac reports `maxTouchPoints === 0` and stays on Google Play.
- **It falls back, never dead-ends.** An app with only one store URL sends
  every device there rather than opening nothing.
- **An explicit `download(url)` still wins.** Games that resolve their own
  destination are untouched.

## What this does not cover

Networks whose CTA is owned by the container — `FbPlayableAd.onCTAClick()`,
`ScPlayableAd.onCTAClick()`, `playableSDK.openAppStore()`, `ExitApi.exit()`,
Mintegral's `window.install()`, Luna's `InstallFullGame()`, molocoV2's
`final_url` macro — never see our URL at all. There the store link is the
network's own campaign setting, and a wrong store on iOS is a campaign
misconfiguration, not a packaging bug.

Covered by `tests/packager/store-url-platform.test.ts` (every network that
routes the CTA itself, derived at runtime rather than hardcoded) and the
preview-stub cases in `tests/sdk/plbx-sdk.test.ts`.
