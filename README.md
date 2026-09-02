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
