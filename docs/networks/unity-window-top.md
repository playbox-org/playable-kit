# Unity Ads — `window.top` is forbidden

## Rejection

> Your responsive playable is not allowed to use `window.top`.

Unity's upload validator scans the artifact **statically**. It does not run the
creative, so a `window.top` that is never reached is rejected exactly like a
live one.

Enforced by the packager: `unity` declares `window.top` in
`NETWORK_FORBIDDEN_STRINGS` (`src/packager/network-adapters/base.ts`), so a
build containing it aborts for Unity — and only for Unity; the packager wraps
each network in its own try/catch, so the other targets still emit.

## Usual source: Phaser, not the game

Phaser attaches its pointer listeners to `window.top` by default, so it can see
a release outside the canvas. In one real creative this produced 7 occurrences,
all inside the input manager — `onMouseDownWindow`, `onTouchStartWindow`, and
teardown of the form `(this.isTop ? window.top : window).removeEventListener(…)`.
No game code, no analytics, no packaging wrapper was involved.

The option is `input.windowEvents`, default `true`:

```js
// phaser/src/core/Config.js
this.inputWindowEvents = GetValue(config, 'input.windowEvents', true);
```

## Why the config change alone is not enough

`inputWindowEvents` is a **runtime** flag, not a compile-time constant. The
branches are guarded by `if (manager.game.config.inputWindowEvents)`, so neither
Vite nor terser can eliminate them. After `input: { windowEvents: false }` the
behaviour is correct — nothing is bound to `window.top` — but the *string*
survives in the bundle, and a static scanner rejects the build anyway.

Correct behaviour and passing the validator are two separate tasks. The fix is
honest only as a pair:

| | flag off | flag on |
|---|---|---|
| **string stripped** | correct | scanner passes, input behaviour silently changed |
| **string present** | behaviour fine, upload rejected | original bug |

Both single-sided outcomes are wrong, and this check fails on either one that
still carries the string.

## Side effect of disabling the flag

`POINTER_UP_OUTSIDE` stops firing. Harmless where a button's release handler is
also bound to `pointerout` (which fires first — as soon as the finger leaves the
button), but any drag/swipe logic that depends on release outside the canvas
changes behaviour. Verify in a browser after the change: game boots, a button
presses and releases, a tap registers.

## Scope

Phaser-specific. Three neighbouring creatives — two Cocos Creator 3.8.8, one
Three.js — contain zero `window.top`.

## Counting occurrences by hand

`grep -c` counts *lines*, and a production bundle is one line: it returns `1`
where there are 7. Use `grep -o … | wc -l`. The packager's check is a substring
scan (`html.includes`), so it is not affected — this trap is shell-side only.
