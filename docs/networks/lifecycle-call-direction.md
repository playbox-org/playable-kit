# Lifecycle call direction — read this before touching any `game*` global

> **The rule:** a lifecycle global's name tells you nothing about who calls it.
> The same identifier means a different thing on different networks. Look the
> direction up per network, every time.

Half of these globals are ours to **call**. The other half are ours to
**provide**, and the network calls them. Get it backwards and nothing throws:
the packaged creative loads, the checklist can even go green, and the only
symptom is a hook that never runs — or one that runs at the wrong moment.

## Direction by network

| Network | Creative **calls** (we invoke) | Creative **defines** (they invoke) | Notes |
|---|---|---|---|
| **Mintegral / PlayTurbo** | `install()` §2, `gameEnd()` §3, `gameReady()` §4, `gameRetry()` §6 | `gameStart()` §5, `gameClose()` §7 | The two hooks are for the game: "starting the countdown, starting the background music" / "turn off this background music". Reached via `plbx_html.on_game_start` / `on_game_close`. See [mintegral-playturbo.md](mintegral-playturbo.md). |
| **TikTok / Pangle** | `playableSDK.openAppStore()` — and nothing else | — | **No lifecycle exists.** Verified against the live SDK, not inferred: see below. |
| **Bigo** | `gameReady()` — the **SDK's own** function | — | Calling it *fires* a `GAME_START` event. There is no creative-defined `gameStart` here; the same word is an event name, not a function you provide. |
| **Luna / Unity Playworks** | `Luna.Unity.Playable.InstallFullGame()` | `startGame()` | Its own contract, and `startGame` additionally **gates boot** — the creative must not self-start. Not the same thing as Mintegral's `gameStart` despite the transposed name — see the next section. |
| **MRAID networks** (AppLovin, Unity Ads, ironSource, …) | `mraid.open()` | `viewableChange` listener | Not `game*` at all; the defer-boot gate is `__plbx_pre_boot`. |
| **Vungle** | `parent.postMessage('download'\|'complete')` | — | No globals; `download` and `complete` must never fire together. |

## `gameStart` vs `startGame` — two words, swapped, opposite contracts

The single easiest mistake in this file. Both are defined by the creative and
called by the host, so the direction matches — and everything else does not.

| | `gameStart` — Mintegral | `startGame` — Luna |
|---|---|---|
| Defined by | the creative | the creative |
| Called by | PlayTurbo container, "at the beginning of the playable" (§5) | the Luna host, at page `load` |
| **Gates boot?** | **No.** The engine is already running; this is a hook for game logic | **Yes.** *All* startup runs inside it; the creative must not self-start |
| Purpose | start the countdown, start the BGM | boot the game |
| When it must exist | any time before the container calls it | **synchronously at injection time** — Luna calls it at `load` |
| If it never fires | countdown/BGM never start; the ad still plays | the creative never boots — splash for the whole impression |
| Called more than once | dispatches to subscribers each time | must be idempotent (`_plbx_luna_started` guard) |
| Self-start fallback | not applicable | yes, when `window.Luna` is absent (local dev) |
| Kit entry point | `plbx_html.on_game_start(cb)` | the packager owns it; game code does not touch it |

**The measured trap on the Luna side:** `startGame` must NOT be defined inside
`__plbx_pre_boot`, because the runtime loader only calls that after unpacking
the asset payload. On a packaged 3.5 MB artifact in headless Chromium
`startGame` did not exist at `load` (t=186 ms) and first appeared at t=274 ms —
a gap that grows with build size. Luna calls `startGame()` at `load`, gets
`startGame is not a function`, and because `window.Luna` is present the
self-start fallback is off: the creative sits on the splash for the entire
impression. Details in [luna-playworks.md](luna-playworks.md) §3.1.

**Consequence for review:** "we define a start function and the host calls it"
is not enough information to port anything between these two networks. A
Mintegral-style dispatcher on Luna never boots the game; a Luna-style boot gate
on Mintegral stalls the creative whenever PlayTurbo does not call `gameStart`
(their desktop test tool, for one).

## TikTok / Pangle have no lifecycle — verified, not assumed

Three independent confirmations:

1. **The live SDK.** `playable-sdk.js` (266 KB, HTTP 200 from
   `sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js`)
   exposes **39 methods**. Zero occurrences of `gameReady`, `gameStart`,
   `gameClose`, `gameEnd`, `gameRetry` — and zero of `reportGameReady` /
   `reportGameClose`, which this kit used to call.
2. **TikTok's spec:** "The accessing party does not need to call for the
   download or page jump operations by themselves. These operations are handled
   by the js-sdk." The only documented call is `window.openAppStore()`.
3. The SDK emits its own playable telemetry (`playableShow`,
   `startPlayPlayable`, `finishPlayPlayable`, `playableEnd`) with no hook for
   the creative.

What the SDK does expose, for anyone tempted to map a lifecycle onto it:
`openAppStore`, `openApp`, `openAdLandPageLinks`, `isMuted`, `isPangle`,
`isPrerender`, `getContextInfo`, `getPlayableSettingInfo`, `sendEvent`,
`sendRealPlay`, `sendFirstFrameShow`, `sendPlayableReward`,
`playableSendClickEvent`, `registerConvertArea`, `vibrate`, `shake`, … None of
these is documented as a game-ready or game-end signal. **Do not guess a
mapping** — a plausible-looking name is how the removed calls got here.

### What was wrong

```js
// removed in 0.3.14
window.plbx_html.game_ready = function() {
  if (window.playableSDK && playableSDK.reportGameReady) { playableSDK.reportGameReady(); }
};
```

The guard never passed in production, so `plbx.game_ready()` and
`plbx.game_end()` were **silent no-ops** on TikTok and Pangle. The preview mock
made it worse: its `decorate()` assigns a wrapper even when the real SDK has no
such method, so listing a name in `BEACON` *manufactures* it. Both names were
listed — preview reported the beacons, the checklist went green, and production
did nothing. The checklist also carried `gameReady()` / `gameStart()` rows
telling creators to call an API that does not exist.

Now: CTA only, `BEACON` is CTA-only, and the checklist has no lifecycle rows for
these two networks. `plbx.game_ready()` / `game_end()` still exist (the surface
is uniform) and are honest no-ops.

## Why this keeps going wrong

**A guard that protects nothing.** This shape looks defensive:

```js
if (typeof window.gameStart !== 'function') window.gameStart = function () {}
```

It reads as "don't overwrite the validator's function". But for a
container-**calls** hook there is nothing to overwrite — the container never
defines it, it only invokes it. The guard silently installs a dead stub and
hides the fact that no hook exists. That is exactly what shipped for Mintegral
until 0.3.12.

**Calling a hook we were supposed to provide.** `plbx_html.download()` used to
invoke `window.gameClose()`. `gameClose` is the game's end-of-ad cleanup, and
the container owns its timing — so a CTA tap ran the cleanup mid-ad and, with
the spec's own example hook, stopped the music.

**A preview mock that assigns instead of calls.** The mock *is* the container.
Assigning `window.gameStart` there overwrites the creative's hook; whichever
script ran last won. Either the checklist went green off the mock's own report
while the creative's hook never ran, or the creative's assignment silenced the
report and a correct build showed red. A mock must look the hook up **at call
time**:

```js
function callCreativeHook(name, event) {
  report(event, {})
  var fn = window[name]                 // resolved when it fires, not when installed
  if (typeof fn === 'function') { try { fn() } catch (e) {} }
}
```

## `plbx_html` is ONE API on every network

A game is written once and packaged for 25+ targets. It cannot feature-detect a
member it never knew was optional, so **every member exists on every network** —
an adapter may make one *do* more, never make it disappear.

| Member | Default | Network-specific behaviour |
|---|---|---|
| `download(url)` | — | each adapter routes to its own CTA |
| `game_end()` | no-op | Mintegral → `window.gameEnd`; TikTok → `playableSDK.reportGameClose`; Vungle → `postMessage('complete')`; Moloco V2 → `complete` beacon |
| `game_ready()` | no-op | TikTok → `playableSDK.reportGameReady`; Moloco V2 → `game_viewable` beacon |
| `game_retry()` | no-op | Mintegral → `window.gameRetry` (§6) |
| `is_game_started()` | `true` | Mintegral: false until the container fires `gameStart` |
| `on_game_start(cb)` | fires **immediately** | Mintegral: waits for the container's `gameStart` (§5) |
| `on_game_close(cb)` | registers, never fires | Mintegral: the container's `gameClose` (§7) |
| `is_muted()` / `on_mute_change(cb)` | `false`, one immediate call | Luna: real container mute state |
| `is_audio()`, `is_hide_download()`, `report()`, `tap()`, `expose()` | defaults | Moloco V2 wires `report`/`tap` to its macro beacons |

`on_game_start` firing immediately by default is not a fudge: on every network
except Mintegral there is no separate container start, and on the ones that gate
boot (Luna's `startGame`, the MRAID defer-boot gate) any game code able to
subscribe is already past it. Mintegral is the one place where the start is a
genuinely later event.

**This drifted twice before it was caught**, both times invisibly:

- the Mintegral bridge was hand-rolled instead of built from `buildPlbxBridge`
  and silently lacked `game_ready`, `is_muted`, `report` and `tap` — a game
  calling any of them threw on Mintegral and nowhere else;
- the container-hook subscriptions were added to Mintegral alone, so
  `on_game_start` was a TypeError on the other 29 networks.

`tests/packager/plbx-html-surface.test.ts` now executes each network's emitted
bridge and asserts the full member list, so a new adapter cannot ship a narrower
API. Add the member to `buildPlbxBridge` — and to the piecewise Moloco V2
bridge, which cannot use the builder — not to one adapter.

## Checklist for adding or changing a lifecycle global

1. **Find the direction in the network's own spec**, not by analogy with another
   network. Quote the sentence in the adapter comment.
2. Creative **calls** it → wire it through `plbx_html.<verb>()` so game code has
   one entry point, and forward with a `typeof` check.
3. Creative **defines** it → the packager owns the global and dispatches to
   `plbx_html.on_<event>(cb)` subscribers. Requirements that are easy to miss:
   - a subscriber registering **after** the event already fired must be called
     immediately — Cocos boots asynchronously, so a scene subscribing in
     `onLoad` is routinely later than the container's call;
   - one throwing subscriber must not skip the rest;
   - a pre-existing global assigned by the game must be preserved and called
     first, not clobbered.
4. **Do not generalise across networks.** Add it to the per-network map, not to
   the shared loader.
5. **Test by execution, not by grep.** String assertions prove the code was
   emitted, not that the wiring works. `tests/packager/mintegral-lifecycle.test.ts`
   runs every injected script against a fake window and simulates the
   container's calls; a new direction should get the same treatment.

## Verifying a spec

PlayTurbo's doc (and several others) is a JS-rendered SPA: `curl` and plain
fetchers return only the `<title>`, which is how half the Mintegral lifecycle
sat recorded as "could not be re-verified" for so long. Render the page in a
browser before concluding a rule is undocumented.
