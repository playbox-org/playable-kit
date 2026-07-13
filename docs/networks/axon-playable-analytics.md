# AppLovin "Axon" Playable Analytics — Event Spec

Source: <https://support.axon.ai/en/growth/promoting-your-apps/creatives/playable-analytics-integration>
(verified 2026-06-04)

AppLovin's playable-analytics SDK lets a playable report lifecycle/engagement
events. The SDK injects the global `window.ALPlayableAnalytics`; the creative
fires events through it.

## API

```javascript
if (typeof window.ALPlayableAnalytics != 'undefined') {
  window.ALPlayableAnalytics.trackEvent('DISPLAYED');
}
```

- Single method: `trackEvent('EVENT_NAME')`. No payload/parameters — **custom
  events are not tracked**, only the predefined names below.
- **Do not define `ALPlayableAnalytics` yourself** — the SDK provides it. Always
  guard calls with the `typeof … != 'undefined'` existence check.
- Event names are ALL-CAPS, underscore-separated.

## Events

| Event | Meaning | Status |
|-------|---------|--------|
| `LOADING` | In-playable loading starts | Pair² |
| `LOADED` | In-playable loading completes | Pair² |
| `DISPLAYED` | Creative is shown and ready for interaction | **Required** |
| `CHALLENGE_STARTED` | User meaningfully interacts / begins a challenge | Optional |
| `CHALLENGE_FAILED` | User reaches a failure state | Conditional¹ |
| `CHALLENGE_RETRY` | User retries a failed challenge | Conditional¹ |
| `CHALLENGE_PASS_25` | 25% completion | Optional |
| `CHALLENGE_PASS_50` | 50% completion | Optional |
| `CHALLENGE_PASS_75` | 75% completion | Optional |
| `CHALLENGE_SOLVED` | Challenge completed successfully | Conditional¹ |
| `CTA_CLICKED` | User clicks the call-to-action | Optional |
| `ENDCARD_SHOWN` | End card / summary screen shown | Optional |

¹ If `CHALLENGE_STARTED` is used, **at least one** of `CHALLENGE_SOLVED` /
`CHALLENGE_FAILED` / `CHALLENGE_RETRY` must also be fired.

² `LOADING` and `LOADED` are a symmetric pair: fire **both** or **neither**. A
lone `LOADING` (loading never completed) or lone `LOADED` (completed without a
start) is flagged.

## Recommended lifecycle order

1. `LOADING` → `LOADED` (optional pair)
2. `DISPLAYED` (mandatory)
3. `CHALLENGE_STARTED` → progress (`CHALLENGE_PASS_*`) → `CHALLENGE_SOLVED` /
   `CHALLENGE_FAILED` (+ `CHALLENGE_RETRY` on retries)
4. `ENDCARD_SHOWN`, `CTA_CLICKED`

## Conformance rules enforced by the validator

Canonical spec + checks live in `src/packager/axon-events.ts`
(`AXON_EVENTS`, `extractAxonUsage`, `validateAxonEvents`). All checks are
**advisory (warn-only)** — these events are authored by the game developer, so
the packager never injects them and never aborts a build over them.

| Check | Level | Rule |
|-------|-------|------|
| `events_present` | warn | At least one `trackEvent()` exists (`DISPLAYED` is required) |
| `displayed` | warn | `DISPLAYED` is among the events |
| `no_unknown` | **error** | No custom/typo event names (only spec names accepted) |
| `loaded_requires_loading` | warn | `LOADING` and `LOADED` both present, or neither (symmetric pair) |
| `challenge_completion` | warn | A completion event present when `CHALLENGE_STARTED` is used |
| `no_redefinition` | warn | Source does not assign `window.ALPlayableAnalytics` (static scan only) |

### Runtime sequence checks (preview only)

`validateAxonSequence(sequence)` takes the live, ordered fire log (with repeats)
and adds the checks a static scan can't make, plus an aggregate roll-up:

| Check | Level | Rule |
|-------|-------|------|
| `all_conformant` | error/warn | Aggregate headline — ok iff every other check passes |
| `order` | warn | First-fire of each event respects the lifecycle order (pairwise, retry-safe). Includes `CHALLENGE_SOLVED` before `ENDCARD_SHOWN`, and `CTA_CLICKED` only after `DISPLAYED` (any time — *not* tied to `ENDCARD_SHOWN`) |
| `dedup` | warn | Fire-once events (`LOADING`/`LOADED`/`DISPLAYED`/`ENDCARD_SHOWN`/`CHALLENGE_STARTED`/`CTA_CLICKED`) fire once per the spec's "Deduped: Yes". Excluded: the other `CHALLENGE_*` events, which legitimately repeat across retries |
| `challenge_spacing` | warn | Any two `CHALLENGE_*` events ≥ 50 ms apart — AppLovin forbids simultaneous dispatch; each must mark a distinct gameplay moment (needs runtime timestamps) |

It also carries all the set-based checks above (computed from the deduped set).

## CHALLENGE_* event rules (client requirements)

- **`CHALLENGE_STARTED` fires once**, on the user's first click only.
- **`CHALLENGE_*` events must not be dispatched simultaneously** — at least
  **50 ms** between any two (they must reflect distinct gameplay moments).
  `CTA_CLICKED` may interleave between `CHALLENGE_*` calls.
- **`CHALLENGE_SOLVED` must be sent before `ENDCARD_SHOWN`** (when an end card exists).
- **1-click (`1cl`) playables must NOT implement `CHALLENGE_*` events.** For
  `xcl` (x-click) versions, fire `CHALLENGE_*` per the playable's own logic.
  (The validator can't auto-detect click-count — this is a manual rule.)

The validator UI links to the live spec (`AXON_SPEC_URL`) from both the preview
Axon panel and the Package-tab advisory box.

### Where it runs

- **Package-time gate** (`packager.ts`): static scan of the build source
  (`extractAxonUsage`) — the `trackEvent()` literals live in the game's
  plaintext JS, *not* the base64-zipped payload in the final HTML. Failing
  checks become non-fatal `PackageResult.warnings`, shown in the Package panel
  warnings list.
- **Package panel** (`src/panels/default.ts` + `static/template`): a visible
  advisory warnings box; also scanned on panel load / build-dir change via the
  `scan-axon-events` IPC when AppLovin is selected.
- **Preview validator** (`static/preview/preview.js`): live runtime check — the
  `ALPlayableAnalytics` mock reports each fired event; verdicts mirror
  `validateAxonEvents` (minus the static-only redefinition check).
