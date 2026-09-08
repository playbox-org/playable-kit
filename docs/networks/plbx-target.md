# `plbx` — the repack-source target

**Status:** shipped with the phase-2 telemetry work (2026-08-22)

`plbx` is not an ad network. It is the one network-agnostic archive the Cocos
extension hands to the private `plbx-collector` repack service, which unpacks
it, runs `packageForNetworks` on the original build for every real network,
injects telemetry and re-checks each artifact against that network's ceiling.
It is never uploaded to a network — exclude it from any "all networks" list
that means ad networks (the extension's grid, a `--networks all`).

The archive (`format: 'zip'`, inner HTML `source.html`, no prefix) has exactly
three root members, emitted by `PlbxAdapter` (`src/packager/network-adapters/plbx.ts`):

| Member | What it is |
|---|---|
| `source.html` | the ordinary kit output for this target — self-contained loader, default Cocos rewrite, plain `genericBridge()`, telemetry slot. Runnable and reviewable. |
| `build.zip` | the build directory exactly as built: every file, no exclusions, no rewrite, paths relative to `buildDir`, forward slashes. Lossless — the repack service extracts it. |
| `plbx.json` | `{ kitVersion, appName, orientation, storeUrls: { googlePlay, appStore }, createdAt }` — filled from the same resolved store URLs / `appName` that `luna.json` gets. |

`maxSize` is the registry-wide 10 MB ceiling; a larger archive only flips the
advisory `withinLimit` flag, the file is still written.
