# plbx_html external commands — design

Date: 2026-06-25
Status: approved (design)

## Overview

Add an **external-command registry** to `window.plbx_html` so an outside caller
(an ad container, a test harness, or our preview) can trigger named actions the
game implements — most immediately `show_endcard` (open the packshot/endcard).

Today every `plbx_html` member is a **game → outside** call (`download`,
`game_ready`, `game_end`, `tap`, …). This feature adds the inverse direction:
the game registers a handler, an external caller invokes it.

The registry is generic — the game can expose any named command, not just
`show_endcard`. Our panel preview (`static/preview/`) auto-renders a trigger
button per registered command, alongside the existing Mute / Viewable controls.

## Goals

- Game registers a named command + handler on `plbx_html`.
- An external caller invokes it by direct method call:
  `window.plbx_html.show_endcard()`.
- The packaged build announces registered commands so a host can discover them.
- The panel preview renders a button per command and invokes it on click.
- `show_endcard` is the first command, registered by the game via the same
  generic mechanism (no special-casing in the packager).

## Non-goals (YAGNI — add later if asked)

- Multiple subscribers per name. `expose` overwrites; one handler per name.
- Arguments passed to commands. Handlers are invoked void.
- `show_endcard` does **not** auto-fire the Axon `ENDCARD_SHOWN` event — the
  game's handler decides whether to.
- Buttons in the standalone validator (`src/preview/server.ts`). Scope is
  the panel preview (`static/preview/`), where the Mute button lives.
- The extension does **not** render the endcard. It only relays the signal; the
  game draws its own endcard scene.

## API — build side (`src/packager/network-adapters/base.ts`)

Extend the `plbx_html` object literal in `buildPlbxBridge()`:

```js
external_commands: [],
expose: function(name, fn, label) {
  if (typeof name !== 'string' || typeof fn !== 'function') return;
  this[name] = fn;                                  // direct call: plbx_html.show_endcard()
  this.external_commands.push({ name: name, label: label || name });
  try { parent.postMessage({ type: 'plbx:command', name: name, label: label || name }, '*'); } catch (e) {}
}
```

Notes:
- `window.super_html` is the same object reference (aliased), so `expose` and
  `external_commands` are reachable via `super_html` too — no extra wiring.
- **Divergent adapters:** `mintegral.ts` and `moloco-v2.ts` build `plbx_html` by
  hand and bypass `buildPlbxBridge()`, so they do NOT inherit the registry
  automatically — each carries an explicit byte-identical copy of `expose` +
  `external_commands` (mintegral in its object literal; moloco-v2 in the
  payload.js bridge, not the < 3 KB launcher). A no-drift test asserts every
  network build (except molocoV2, whose bridge is a separate payload) contains
  the registry, so this can't silently regress.
- `expose` is idempotent per name: re-exposing updates the handler but does not
  duplicate the `external_commands` entry or re-announce.
- `this[name] = fn` makes the direct external call ergonomic and SDK-agnostic:
  `window.plbx_html.show_endcard()` works for a network container exactly as for
  our preview.
- `parent.postMessage` is harmless in production: if unframed, `parent === window`
  (posts to self, no listener); in a network container, no `plbx:command`
  listener exists. Only our preview listens.
- No build-side `plbx:invoke` listener is added — the preview invokes directly
  (same-origin, see below). Keeps the production build surface minimal.

### Game usage (documented, not shipped by packager)

```js
window.plbx_html.expose('show_endcard', function () { /* show endcard scene */ }, 'Show endcard');
// any custom command:
window.plbx_html.expose('skip_intro', skipFn, 'Skip intro');
```

## API — preview side (`static/preview/`)

The preview iframe is served from the local server (same origin), so the parent
already reaches `frame.contentWindow.*` directly (see `forceAudioMute` in
`preview.js`). Reuse that for invocation.

1. **Discover** — persistent `message` listener (attached before the iframe
   loads, so no `expose` call is missed) collects `{type:'plbx:command'}`
   messages, deduped by `name`. **Source guard:** only accept commands whose
   `e.source === #preview-frame.contentWindow` — the offscreen boot-harness
   iframe loads the same build and would otherwise leak buttons into the live
   toolbar (and accumulate across its mode sweep).
2. **Render** — commands get their **own toolbar** (`#plbx-cmd-dock`, "Game
   commands"), a separate dock from the molocoV2 macro dock, in the opposite
   corner so the two never overlap. Shown whenever ≥1 command is registered.
   Append one `<button>` per command with its `label`. (The molocoV2 macro dock
   stays molocoV2-only — unchanged.)
3. **Invoke** — on click, call
   `frame.contentWindow.plbx_html[name]()` directly; log `→ command: <name>`.
4. **Reset** — clear rendered command buttons + dedupe set on network switch /
   iframe reload (the `external_commands` list belongs to the previous iframe).

Belt-and-suspenders (optional, include only if a race shows up): on `game_ready`,
also read `frame.contentWindow.plbx_html.external_commands` and merge any
commands the listener missed.

## Data flow

```
game boot → plbx_html.expose('show_endcard', fn, 'Show endcard')
          → this.show_endcard = fn
          → external_commands.push({name,label})
          → parent.postMessage('plbx:command')  → preview renders a button

preview button click → frame.contentWindow.plbx_html.show_endcard()   // direct, same-origin
network / container   → window.plbx_html.show_endcard()               // direct
```

## Edge cases

- `expose` called twice with the same name → method overwritten, a second
  `{name,label}` pushed. Preview dedupes buttons by `name`. (Acceptable; or
  dedupe in `expose` — minor, decide in plan.)
- Game never registers `show_endcard` → no button, direct call is `undefined`
  (caller's responsibility, same as any unregistered command).
- Bad args to `expose` (non-string name / non-function fn) → ignored, no throw.
- Command handler throws → swallowed at the call site in preview (`try/catch`),
  logged; production direct-call surfaces the game's own error normally.

## Testing

- Unit (`tests/`): assert `buildPlbxBridge()` / a network bridge string contains
  `expose:` and `external_commands`. Then `eval` the bridge in a minimal jsdom
  `window` (with a stubbed `parent.postMessage`) and verify:
  - `plbx_html.expose('x', fn, 'X')` sets `plbx_html.x === fn`,
  - pushes `{name:'x',label:'X'}` to `external_commands`,
  - posts `{type:'plbx:command', name:'x', label:'X'}`.
  - `expose('y', fn)` (no label) → label defaults to `'y'`.
  - `expose('bad', 'notfn')` → no-op.

## Files touched

- `src/packager/network-adapters/base.ts` — add `expose` + `external_commands`
  to `buildPlbxBridge` (inherited by all buildPlbxBridge networks).
- `src/packager/network-adapters/mintegral.ts`,
  `src/packager/network-adapters/moloco-v2.ts` — explicit registry copy
  (these bypass `buildPlbxBridge`).
- `static/preview/index.html` — new `#plbx-cmd-dock` "Game commands" toolbar
  (separate from the molocoV2 macro dock).
- `static/preview/preview.css` — toolbar positioning; `#plbx-cmd-row:empty` rule.
- `static/preview/preview.js` — `plbx:command` listener (source-guarded), button
  render/reset, two-dock visibility, direct-invoke handler, dock-toggle helper.
- `tests/packager/plbx-external-commands.test.ts` — `expose` unit tests +
  re-expose idempotency + no-drift across networks.
- Docs: this spec.
