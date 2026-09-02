# Mintegral / PlayTurbo — lifecycle directions

Source: [PlayTurbo review doc](https://www.playturbo.com/review/doc)
("Mindworks-Guideline-Playable Testing"). The page is JS-rendered — `curl` and
plain fetchers return only the `<title>`, which is why earlier passes recorded
parts of this as unverified. Render it in a browser to re-check.

## The five globals, and who calls whom

The names do not carry the direction. Half are ours to call, half are ours to
provide.

| Global | Direction | Spec | In the kit |
|---|---|---|---|
| `install()` | creative **calls** | §2 — all redirects must go through it; the playable must not redirect itself | `plbx_html.download()` |
| `gameEnd()` | creative **calls** | §3 — at the end of the playable (win or fail) | `plbx_html.game_end()` |
| `gameReady()` | creative **calls** | §4 — once all resources finished loading | loader polls for it, then calls |
| `gameRetry()` | creative **calls** | §6 — when play-again is initiated; omit if the playable has no replay | `plbx_html.game_retry()` |
| `gameStart()` | container **calls** | §5 — "we will automatically call this function at the beginning of the playable" | `plbx_html.on_game_start(cb)` |
| `gameClose()` | container **calls** | §7 — "we will automatically call this function at the end of the playable" | `plbx_html.on_game_close(cb)` |

§5 and §7 spell out what the hooks are for: "starting the countdown, starting
the background music" and "turn off this background music".

## Game-side usage

```js
// start the countdown / BGM when the container starts the ad
window.plbx_html.on_game_start(function () { … })

// stop the BGM when the container ends it
window.plbx_html.on_game_close(function () { … })

// only if the playable offers a replay
window.plbx_html.game_retry()
```

A subscriber that registers after the container already fired is called
immediately — Cocos boots asynchronously, so a scene subscribing in `onLoad` is
routinely later than `gameStart`. A game that assigns `window.gameStart`
directly (the shape the spec's example shows) keeps working: the dispatcher
captures the existing function and calls it first.

## What was wrong before

`gameStart` and `gameClose` were guarded no-op stubs
(`if (typeof window.gameStart !== 'function') window.gameStart = function () {}`),
so the container's call reached nothing and no game could hook it. The guard
looks like "don't overwrite the validator's function", but for a
container-**calls** hook there is nothing to protect: the container never
defines these.

Worse, `plbx_html.download()` and `plbx_html.game_end()` both **called**
`window.gameClose()`. With the spec's own example hook, tapping the CTA ran the
game's end-of-ad cleanup in the middle of the ad — the music stopped.

The preview mock had the mirror-image bug: it **assigned**
`window.gameStart`/`gameClose` to its own reporters. Being the container, it has
to call them. Whichever script ran last won, so either the checklist went green
off the mock's own report while the creative's hooks never ran, or the
creative's assignment silenced the report and a correct build showed red.

## Do not copy this to other networks

Same names, different contracts — TikTok has no lifecycle at all, Bigo's
`gameReady` is the SDK's own function firing a `GAME_START` event, and Luna's
`startGame` is a boot gate, not Mintegral's `gameStart` with the words swapped.

**→ [lifecycle-call-direction.md](lifecycle-call-direction.md)** is the
cross-network table and the rules for adding a new one. Read it before touching
any `game*` global.

## Other rules worth knowing (same page)

- §12/§14 — everything except JS and HTML must be base64-inlined, no dynamic
  requests, strip unused engine plugins.
- §13 — ZIP ≤ 5 MB; zip name, asset folder and HTML name identical; `[A-Za-z0-9_]`
  only; the HTML must open from `file://`.
- §8/§9 — do not add your own close button or loading screen; PlayTurbo adds both.
- §10 — must work in portrait and landscape, free rotation.
- §15 — do not override the global `console`; it breaks redirect and gameClose.
- §16 — no auto-redirects without a user action (not caught by their tool).
- §2/§3 — the creative must work with a **mouse** in a desktop browser; their
  detection tool runs in one, so a touch-only drag can stall the review.
