# @playbox-ai/playable-kit

Playable-ad packaging, validation, checks and preview SDK extracted from the
Cocos extension (`plbx-cocos-extension`) so the platform API, the build
packager service, the CLI and the extension can share one implementation.

## Entry points

- `@playbox-ai/playable-kit` — full SDK: `packageForNetworks`,
  `validateArtifact`, `getNetworkChecks`, `generatePreviewUtil`,
  `buildPreviewRendition`, `KIT_VERSION`.
- `@playbox-ai/playable-kit/networks` — pure network registry data
  (no `fs`/node deps; safe for browser bundles).
- `@playbox-ai/playable-kit/types` — types only, zero runtime.
- `@playbox-ai/playable-kit/sdk` — game-side SDK for non-Cocos builds
  (Vite / Three.js / Pixi). Browser-only, zero deps.

## Free-stack builds (Vite / Three.js / Pixi)

Build once, package for every network. The build must be ONE self-contained
`index.html` (Vite: `vite-plugin-singlefile` + `build.rollupOptions.output.format = 'iife'`).

```ts
import plbx from '@playbox-ai/playable-kit/sdk'

plbx.set_google_play_url('https://play.google.com/store/apps/details?id=…')
plbx.set_app_store_url('https://apps.apple.com/app/id…')
plbx.on('pause', () => game.pause())
plbx.on('resume', () => game.resume())
plbx.on('mute', (muted) => sound.setMuted(muted))
plbx.init(() => new Game())   // boot runs through the network's boot gate
// after the first frame:   plbx.start()
// CTA:                     plbx.download()
// end card:                plbx.game_end()
```

```
vite build && npx playable-kit package --build dist --out dist-networks --networks all --name "My Game"
```

Without a packaged bridge (`vite dev`, a browser tab) the SDK installs a
preview stub: CTA opens the store URL, pause/resume follow page visibility.

## Lifecycle globals — check the direction first

⚠️ A `game*` global's **name does not tell you who calls it**, and the same
identifier means different things on different networks. Half are ours to call,
half are ours to provide.

| Network | Creative calls | Creative defines (network calls it) |
|---|---|---|
| Mintegral | `install`, `gameEnd`, `gameReady`, `gameRetry` | `gameStart`, `gameClose` |
| Luna | `Luna.Unity.Playable.InstallFullGame` | `startGame` — **and it gates boot** |
| TikTok / Pangle | `playableSDK.*` | — (no lifecycle exists) |
| Bigo | `gameReady` — the SDK's own function, fires `GAME_START` | — |

`gameStart` and `startGame` are not the same contract with the words swapped:
Mintegral's is a hook on an already-running engine, Luna's is the boot gate.
Getting it backwards throws nothing — the creative loads and the hook silently
never runs, or the game never boots at all.

**→ [`docs/networks/lifecycle-call-direction.md`](docs/networks/lifecycle-call-direction.md)** —
full table, the failure modes, and the checklist for adding a new one.

Game code subscribes to the container-called hooks through the bridge:

```js
window.plbx_html.on_game_start(function () { /* countdown, BGM */ })
window.plbx_html.on_game_close(function () { /* stop BGM */ })
```

`plbx_html` is the **same API on every network** — a game is packaged for 25+
targets and cannot feature-detect a member it never knew was optional. Adapters
make members *do* more, never make them disappear; `on_game_start` simply fires
immediately where no container start exists. Enforced by
`tests/packager/plbx-html-surface.test.ts`.

## Commands

- `pnpm build` — tsup dual ESM/CJS build into `dist/`.
- `pnpm test` — vitest suite (migrated from the extension).
- `pnpm codegen` — regenerate `src/generated/` (embedded jszip runtime);
  run after bumping the `jszip` dependency and commit the result.

## Bundler safety

Package resources are inlined at build time (embedded jszip source, version
constant via tsup `define`) — the kit never reads its own files from disk at
runtime, so it survives tsup-bundled CLI, Next bundling and Docker images.
Runtime `fs` access is limited to caller-supplied build directories.
