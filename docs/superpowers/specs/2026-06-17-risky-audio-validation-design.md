# Risky-Audio Validation — Design Spec

## Problem

A packaged playable whose build contains `.ogg` (Ogg Vorbis) audio can fail to
open on iOS: Safari/iOS Web Audio `decodeAudioData()` does not decode Ogg
Vorbis. Recent Safari (17.4+) added Ogg to the `<audio>` element, but ad-network
WebViews run across a wide range of iOS versions and older / in-app WKWebViews
still reject Ogg through `decodeAudioData` — the exact path Cocos uses to load
short clips in the self-contained loader (no audio downloader handler; audio →
WebAudio). If the game awaits audio decode during bootstrap, the playable can
hang on a grey/black screen.

Same failure class: `.opus`, `.webm` audio (also unsupported via
`decodeAudioData` on older iOS). Safe: `.mp3`, `.m4a`/AAC, `.wav`.

Real occurrence: the candivore-carousel build shipped 2 `.ogg` files among 11
mp3.

Source: Safari/iOS `decodeAudioData` does not support Ogg Vorbis —
https://github.com/jfrancos/oggmented

## Goal

Surface risky audio formats in validation so they are caught before release.
Advisory only (**warn**, non-blocking): current Safari decodes Ogg and not every
game blocks boot on audio, so this is a risk flag, not a hard incompatibility.

## Solution

Detect at **package time** by scanning the source `buildDir` for risky audio
file extensions (the real extensions on disk; encoding-agnostic — in a packaged
self-contained HTML the asset names are buried inside the base64/base122 ZIP
container and are not plaintext-greppable except the always-present MIME map).
Surface on two validation surfaces:

1. **Build Report** — a warning in `PackageResult.warnings`.
2. **Preview Validate window** — the packager injects a plaintext head-comment
   marker (`<!-- plbx-risky-audio: a.ogg, b.ogg -->`, the same mechanism
   `store-url-extractor` uses to surface store URLs for Unity's raw-HTML
   validator); the preview server greps it (zip-aware) and emits a `risky_audio`
   check with severity **warn**, rendered as a yellow row.

## Architecture

```
package time                              preview / validate time
────────────                              ───────────────────────
buildDir ──► detectRiskyAudio() ──┐
                                  ├─► PackageResult.warnings (Build Report)
                                  └─► <!-- plbx-risky-audio: … --> in <head>
                                              │
packaged HTML ──────────────────────────────►│ server.ts greps marker (zip-aware)
                                              └─► /api/networks: { id:'risky_audio',
                                                    severity:'warn' } ──► preview.js
                                                    yellow row
```

## Components

### 1. `src/packager/audio-format-check.ts` (NEW, pure / unit-testable)

```ts
/** Audio extensions that Safari/iOS WebAudio decodeAudioData cannot decode on
 *  older / in-app WKWebViews — risk a non-opening playable. */
export const RISKY_AUDIO_EXTENSIONS = ['.ogg', '.opus', '.webm'];

/** Walk buildDir; return relative paths of assets with a risky audio extension. */
export function detectRiskyAudio(buildDir: string): string[];

/** The plaintext head-comment marker emitted into the build when risky audio is
 *  found, and parsed back out by the preview validator. */
export function riskyAudioMarker(paths: string[]): string;       // '<!-- plbx-risky-audio: a.ogg, b.ogg -->'
export function parseRiskyAudioMarker(html: string): string[];   // [] when absent
```

`detectRiskyAudio` reuses the same recursive walk + `node_modules` skip as
`store-url-extractor.ts`. `.webm` is matched only as an audio extension by file
name (a `.webm` file is flagged; we do not parse container tracks — a warn-level
false positive on a video-only `.webm` is acceptable and rare in Cocos audio
output).

### 2. `src/packager/packager.ts` (MODIFY)

After resolving the build, call `detectRiskyAudio(buildDir)`. When non-empty:
- push a warning onto the network's `PackageResult.warnings`
  (e.g. `2 risky audio file(s) may not play on iOS WebView (decodeAudioData): a.ogg, b.ogg — re-encode to mp3/m4a`);
- inject `riskyAudioMarker(paths)` into the built HTML `<head>` (same injection
  point/helper used for the store-URL head comments). Skipped for the
  launcher-payload format (the marker belongs on the game build, not the
  launcher).

### 3. `src/preview/server.ts` (MODIFY)

Add `buildRiskyAudio(outputDir, networkId)` mirroring `buildStoreUrlRegional`:
read the built HTML (zip-aware), `parseRiskyAudioMarker(html)`. In
`/api/networks`, when the marker lists files, push a check
`{ id:'risky_audio', label:'No iOS-risky audio (ogg/opus/webm)', hint: … }` and
return the file list so the client can show the offending names. Severity is
warn (the client renders it yellow, never failing the verdict).

### 4. `static/preview/preview.js` (MODIFY)

Render the `risky_audio` check: `warn` with the file list when the marker is
present, `pass` ("No ogg/opus/webm audio") when the build carries the check def
but no files. Mirrors the existing `store_url_regional` rendering.

## Data Flow

- **Package**: `buildDir` → `detectRiskyAudio` → warnings (Build Report) + head
  marker in the packaged HTML.
- **Preview**: packaged HTML → `parseRiskyAudioMarker` → `risky_audio` warn row.

## Error Handling

- `detectRiskyAudio` on a missing/unreadable dir → `[]` (no false warning).
- `parseRiskyAudioMarker` on HTML without the marker → `[]` (check renders pass
  / is omitted, never a spurious warn).
- Marker injection failure (no `<head>`) is non-fatal: the Build Report warning
  still fires; only the preview row is skipped.

## Testing

`tests/packager/audio-format-check.test.ts` (new):
- `detectRiskyAudio` over a lightweight fixture dir holding `x.ogg`, `y.opus`,
  `z.webm`, `ok.mp3`, `ok.m4a` → returns the three risky paths, never the safe
  ones; nested dirs walked; `node_modules` skipped; missing dir → `[]`.
- `riskyAudioMarker` / `parseRiskyAudioMarker` round-trip; `parse` on
  marker-less HTML → `[]`.

Preview surfacing (marker → warn row) is covered by the round-trip unit test
plus manual validation in the Validate window; the server glue mirrors the
already-tested regional path.

## Out of Scope (YAGNI)

- Auto re-encoding ogg → mp3/m4a (detect + warn only).
- Decoding the asset container in the preview server (the package-time marker is
  cheaper and encoding-agnostic).
- Parsing `.webm`/`.ogg` container tracks to distinguish audio vs video (warn
  level tolerates the rare false positive).

## Affected Files

- `src/packager/audio-format-check.ts` — NEW
- `src/packager/packager.ts` — detect + warn + inject marker
- `src/preview/server.ts` — parse marker → `risky_audio` check
- `static/preview/preview.js` — render the warn row
- `tests/packager/audio-format-check.test.ts` — NEW
- `tests/fixtures/risky-audio/` — NEW (synthetic dir: ogg/opus/webm + mp3/m4a)
