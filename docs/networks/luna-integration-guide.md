# Adapting a Cocos playable for Luna / Unity Playworks

Companion to [luna-playworks.md](./luna-playworks.md) (the packaging spec).
That document says what the packager emits; this one says what the **game
project** still has to do, and how to verify the result.

Worked example: `Playables/_Prod/train-miner2-c4` (Cocos 3.8, already on the
`plbx_html` channel). Line numbers refer to that project as of 2026-08-19.

## 1. What the packager already does — do NOT reimplement

| Concern | Handled by | Game change |
|---|---|---|
| Deferred boot (`startGame()`) | `lunaBridge` defines it synchronously; Luna calls it | none |
| CTA → `Luna.Unity.Playable.InstallFullGame()` | `plbx_html.download`, `window.install` and `window.open` all routed | none |
| `luna:pause` / `luna:resume` | `cc.game.pause()` / `resume()` | none |
| `luna:mute` / `luna:unmute` | AudioContext resume neutralised + suspended, media muted | none |
| Standard events (Ad Loading/Ready/Starting/Impression/Engagement/Click) | injected by Luna itself | none |
| `luna.json` / `playground.json` | packager, from the build's store URLs + asset title | none |

A game that calls `plbx_html.download()` (directly or through the generated
`plbx_html_playable.ts` adapter) needs **zero** changes for the CTA.

## 2. What the game MUST change

### 2.1 Game end (silent hole — check this first)

Luna wants `Luna.Unity.LifeCycle.GameEnded()` when gameplay is over; the
packager exposes it as `plbx_html.game_end()`. A project that reaches game-end
through some other global will simply never fire it, with no error.

In the worked example, `AdPlatformService.gameEnded()` does:

```ts
if (platformType === AdPlatformService.platformTypes.MINTEGRAL || typeof window.gameEnd === 'function') {
    window.gameEnd && window.gameEnd();
}
```

`window.gameEnd` is defined by nobody in a Luna build, and `platformType` is
`'luna'` (it comes from `window.super_html_channel`), so **both branches are
false and GameEnded never fires**. Fix — route through the channel the packager
actually provides:

```ts
public static gameEnded(): void {
    if (AdPlatformService.hasGameEnded) return;
    AdPlatformService.hasGameEnded = true;

    const { platformType } = AdPlatformService.getAdInfo();

    // plbx/super_html channel: the packager maps game_end onto whatever the
    // network needs (Luna → Luna.Unity.LifeCycle.GameEnded, Mintegral/Vungle →
    // their own). Prefer it over any network-specific global.
    const plbx = (window as any).plbx_html || (window as any).super_html;
    if (plbx && typeof plbx.game_end === 'function') { plbx.game_end(); return; }

    if (platformType === AdPlatformService.platformTypes.MINTEGRAL || typeof window.gameEnd === 'function') {
        window.gameEnd && window.gameEnd();
    }
}
```

This is strictly better for every other network too — `plbx_html.game_end` is
the packager's single game-end entry point.

### 2.2 Custom analytics events

The packager ships the **channel only**:

```ts
window.plbx_html.log_event(name: string, value?: number): void
```

It routes to `window.pi.logCustomEvent(name, value)`, defaults `value` to `1`,
queues calls fired before Luna's SDK exists (up to 256, drained in order), and
never throws. Which events to fire is the project's decision.

Rules that bite:

- **256 events per session, 32 per unique event name.** Both are hard Luna caps.
- Names must be non-empty and whitespace-free. `'level up'` is rejected;
  `'level_up'` is fine.
- Do not log during initialisation — fire after `startGame()` has run.
- Every unique value creates its own event on Luna's side, so never put a raw
  score or a timestamp in the name.

### 2.3 The playtime funnel (what the client asked for)

`playtime_10s`, `playtime_20s`, … from the first click, not counting time while
the container has the ad paused. Drop this file into the project and start it
where the game registers its first interaction (in the worked example:
`GameEntryPoint.startLevel()`, next to `AdEvents.Started`).

```ts
// assets/Scripts/Systems/Ads/LunaPlaytime.ts
declare const window: any;

/**
 * playtime_10s / playtime_20s / … — one event per 10 s of ACTIVE play, starting
 * at the first interaction. Paused time is not counted: the container fires
 * luna:pause when the ad is backgrounded, and counting through it would inflate
 * the funnel against sessions the user never saw.
 *
 * Capped: Luna allows 256 events per session, and a funnel past a few minutes
 * tells you nothing new. 180 s = 18 events, well inside the budget.
 */
export class LunaPlaytime {
    private static readonly STEP_MS = 10_000;
    private static readonly MAX_SECONDS = 180;

    private static timer: any = null;
    private static paused = false;
    private static seconds = 0;

    /** Call once, at the first user interaction. Repeat calls are ignored. */
    public static start(): void {
        if (LunaPlaytime.timer !== null) return;

        window.addEventListener('luna:pause', () => { LunaPlaytime.paused = true; });
        window.addEventListener('luna:resume', () => { LunaPlaytime.paused = false; });

        LunaPlaytime.timer = setInterval(() => {
            if (LunaPlaytime.paused) return;
            LunaPlaytime.seconds += 10;
            if (LunaPlaytime.seconds > LunaPlaytime.MAX_SECONDS) {
                clearInterval(LunaPlaytime.timer);
                return;
            }
            LunaPlaytime.log('playtime_' + LunaPlaytime.seconds + 's');
        }, LunaPlaytime.STEP_MS);
    }

    private static log(name: string): void {
        const plbx = window.plbx_html || window.super_html;
        if (plbx && typeof plbx.log_event === 'function') plbx.log_event(name, 1);
    }
}
```

Wire it:

```ts
// GameEntryPoint.startLevel()
private startLevel(): void {
    if (!this.isLevelStarted) {
        AdPlatformService.logApplovinEvent(AdEvents.Started);
        LunaPlaytime.start();            // ← first click starts the funnel
    }
    this.isLevelStarted = true;
    this.startScreen.hide();
}
```

Nothing else is needed: Luna's standard events cover impression, engagement and
click on their own, and the existing AppLovin/Axon funnel keeps working
untouched (`ALPlayableAnalytics` simply does not exist in a Luna build, so
`scheduleApplovinEvent` no-ops).

## 3. Build and package

1. Build `web-mobile` in Cocos as usual (release/minified — Luna does **not**
   compress or minify after upload; what you ship is what the networks get).
2. In the Playbox panel → **Package** → **More networks** → check
   `Luna (Unity Playworks)` (format `zip`). It is off by default.
3. Package. Expect one `index.zip` holding exactly three entries:
   `source.html`, `luna.json`, `playground.json`.

Sanity-check the archive before uploading:

```bash
unzip -l <out>/luna/index.zip     # exactly 3 entries, HTML named source.html
unzip -p <out>/luna/index.zip luna.json
```

`luna.json` must carry a real `applicationName` and both store links. Empty
links mean the packager found none in the build source — set them in the game
(`set_google_play_url` / `set_app_store_url`) rather than editing the manifest.

## 4. Verify locally (before uploading anything)

Open the Playbox preview and select the Luna target. The **Luna Events** panel
takes the left column (the same slot Axon uses for AppLovin) and the **Luna
triggers** dock floats just right of it.

### 4.1 The triggers dock — what it is for

In production the Luna container sends these signals. Locally nobody does, so
without the dock a good half of the code that ships never executes even once
before it goes live. Each button injects a **real** signal into the **real**
playable — a window event or an API call, not a stub next to it — so what you
are testing is the build, not the harness.

Mechanically: the button posts `{ type: 'plbx:luna', action }` into the preview
iframe and the injected mock turns it into the corresponding container signal.

| Button | What it does | What it proves |
|---|---|---|
| **Build** | dispatches `luna:build` | subscribing to it does not throw. A no-op for us — boot hangs off `startGame()`, not this |
| **Start game** | calls `window.startGame()` | the boot gate. The mock already calls it on load; the button matters when the asset unpack ran long and the host gave up waiting — it is then the only way to boot, because `window.Luna` exists and the creative's self-start fallback is deliberately off |
| **Pause** / **Resume** | `luna:pause` / `luna:resume` → `cc.game.pause()` / `resume()` | the game actually freezes and comes back. The playtime funnel hangs off the same events, so this also proves paused time is not counted |
| **Mute** / **Unmute** | `luna:mute` / `luna:unmute` | **the most valuable button.** Mute must survive the next in-game sound: Cocos 3.8 calls `runContext()` on every playback and resumes a suspended AudioContext |
| **End game** | `plbx_html.game_end()` → `Luna.Unity.LifeCycle.GameEnded()` | the game reaches Luna at all. This is exactly what §2.1 fixes — before it, nothing happened here |
| **CTA** | `plbx_html.download()` → `InstallFullGame()` | the click lands in Luna's API rather than `window.open`. Luna's standard **Ad Click** is born there and nowhere else |

### 4.2 The pass

1. Wait for the load — `adLoading`, `adReady`, `adStarting`, `adImpression`
   appear by themselves, plus `startGame` under LIFECYCLE.
2. Tap the game → `adEngagement`.
3. **Mute** → audio stops. Now **keep playing** — trigger any in-game sound. If
   it comes back, that is a bug, not a quirk. **Unmute** → audio returns.
4. **Pause** → the picture freezes. Wait 10–15 s, **Resume**. No new
   `playtime_*` may appear for the paused stretch.
5. **CTA** → the `CTA (Luna.Unity.Playable.InstallFullGame)` row goes green with
   `luna_install`.
6. **End game** → `game_end` in the console strip.
7. **Start game** — only if the preview is stuck on the splash.

### 4.3 What must be true at the end

| Check | Expected |
|---|---|
| `startGame() gate honoured` | pass — "called by the host". A failure here means the boot gate did not survive; nothing else matters until it is fixed |
| Standard group | `adLoading`, `adReady`, `adStarting`, `adImpression`, then `adEngagement` after your first tap |
| CTA | tap the in-game CTA → `cta` row passes with `luna_install`. If it fails, the game reached the store some way the packager could not intercept |
| Custom group | `playtime_10s` after ten seconds of play, `playtime_20s` after twenty; the footer counts them, standard events are excluded from the 256 budget |
| Dock → `pause` / `resume` | the game freezes and resumes |
| Dock → `mute` | audio stops **and stays stopped** through the next in-game sound |
| Dock → `game-end` | `game_end` is reported. If nothing happens, §2.1 is not done |
| Luna verdicts | all rows green: caps, names, integer values, no events before startGame, CTA via InstallFullGame |

## 5. Verify on Playworks (after uploading)

1. Upload the zip: **Playable Apps** → drag the archive in.
2. Open the creative's **Preview Link** — confirms Luna's own wrapper boots the
   playable (i.e. their host calls our `startGame()`).
3. Turn on **Show Events: On** under the game window — custom events appear as
   they fire, duplicates grouped with a counter. This is where `playtime_10s`,
   `playtime_20s`, … must show up.
4. For end-to-end analytics: export for a network that allows external calls
   (Unity Ads), open `urls.txt` from the downloaded zip, play through the URL in
   a browser, and watch the insights icon go grey → green.

Two caveats: **Insights is a PRO feature** (see luna-playworks.md §9) — on a
free LITE account steps 1–3 work and step 4 does not; and sessions played
through `urls.txt` are recorded as real data, so use a throwaway creative for
testing rather than the one going into a campaign.
