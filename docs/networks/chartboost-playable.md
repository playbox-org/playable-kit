# Chartboost — Playable Ad (MRAID Playable) Creative Spec

Sources (verified 2026-06-12):
- <https://docs.chartboost.com/en/advertising/creatives/mraid-playable/> — primary spec
- <https://docs.chartboost.com/en/advertising/creatives/setting-up-chartboost-mraid-playable/>
- <https://docs.chartboost.com/en/advertising/creatives/creative-assets/>

Chartboost (acquired by Zynga 2021, now under Take-Two; brand still "Chartboost")
accepts interactive playables only in **MRAID Playable** format: a single
bundled standalone HTML file. Every creative is manually reviewed (~48 business
hours); MRAID Playables must first be enabled for your account by your Chartboost
Account Manager.

## Size limit — the important bit

**3 MB is the HARD maximum, not a recommendation.** Chartboost's spec page states
"Maximum size 3MB" verbatim for the single bundled standalone HTML file. There is
**no 5 MB tier and no separate "recommended 3 MB" level** — 3 MB is the ceiling
itself, so treat it as a hard reject threshold and keep the packaged HTML
comfortably under it.

> Correction to prior internal note: the old "~5 MB (recommended 3 MB)" figure was
> wrong. The documented cap is **3 MB hard**, applied to the single inlined HTML.

## Spec table

| Item | Requirement |
|------|-------------|
| Format | **Single bundled standalone HTML file.** No ZIP, no multi-file bundle. MRAID required. |
| MRAID version | **2.0** (restricted subset). |
| Max file size | **3 MB hard maximum.** No documented separate recommendation. |
| Supported MRAID events | `ready`, `error`, `sizeChange`, `stateChange`, `viewableChange`. |
| Expected calls | Check `mraid.getState()` at start; handle `ready` (fires if initial state was `LOADING`). |
| **Not supported** | `useCustomClose`, `expand`, `setExpandProperties`, `getExpandProperties`, `isCustomClose`, `resize`, `setResizeProperties`, `getResizeProperties`. |
| CTA / click-through | Store redirect **must** fire `mraid.open(url)` on CTA click. |
| Close button | **Added by Chartboost's system — do NOT call `mraid.close()`.** |
| Dimensions / orientation | No fixed pixel size. Must be responsive: work in **portrait and landscape** and across resolutions (reviewers rotate phone/tablet views). |
| Endcard / fallback | None documented for MRAID playables. |
| Validator / upload | No public standalone validator URL. Upload flow runs an in-platform test of Open/Close (and a generic "Resize" tester step). Manual review ~48 business hours; rejected creatives purged within 30 days. |

## Caveats / open items

- Chartboost docs pages carry **no visible last-updated dates** — the 3 MB figure
  could not be date-stamped, but it is the live spec at retrieval (2026-06-12) on
  the official `docs.chartboost.com`.
- **`resize` ambiguity:** the spec page lists `resize` as *not supported*, while
  the upload checklist mentions testing a "Resize" call. The spec-page
  not-supported list is the more specific/authoritative statement; the upload
  "Resize" appears to be generic MRAID-tester wording. Confirm with the Account
  Manager if it matters.
- **External-resource / asset-inlining policy is not explicitly published.** "Single
  bundled standalone HTML file" strongly implies everything must be inlined into the
  one file (the packager already does this), but Chartboost states no explicit
  network/external-URL policy.
- Exact pixel dimensions and any static-companion asset requirement: **not found**
  in official docs (not stated = not assumed).

## Packager implications

- Our packager already emits a single self-contained HTML with assets inlined →
  format-compatible.
- The **3 MB cap is tight** for Cocos web-mobile builds. Aggressive compression
  (sharp/ffmpeg) is mandatory for Chartboost; many full Cocos builds will exceed
  3 MB and need asset reduction. Consider surfacing a 3 MB budget warning in the
  build report for the Chartboost target.
- CTA routing via `mraid.open(url)` matches the existing MRAID adapter path.
- Never overwrite/auto-invoke `mraid.close()` for Chartboost — the network injects
  its own close button.
