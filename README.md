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
