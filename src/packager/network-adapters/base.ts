import { HtmlBuilder } from '../html-builder'
import { NetworkConfig, PackageConfig } from '../../types'
import { forbiddenStringsFor } from '../../networks'

/**
 * An extra copy of the finished artifact that differs from the primary one by
 * a `<head>` rewrite only — same payload, same inner filename, different
 * archive name. Google Ads wants three ZIPs for one creative: an
 * `ad.orientation`-both archive plus a fixed `ad.size` archive per orientation
 * (what super-html ships). Everything is built once; each variant just swaps
 * the meta tag, so the archives stay byte-identical apart from it.
 */
export interface ArtifactVariant {
  /** Appended to the archive basename before the extension. '' = the primary. */
  suffix: string
  /** Appended to the network name in the result row (panel/report label). */
  label?: string
  /** Rewrite the finished single-file HTML for this variant. */
  transformHtml(html: string): string
}

export interface NetworkAdapter {
  readonly networkId: string
  /** Apply network-specific transformations to the HTML */
  transform(builder: HtmlBuilder, config: PackageConfig): void
  /** Custom JS bundle filename for ZIP networks (e.g. 'creative.js') */
  getJsBundleName(): string | null
  /** Extra config.json content to include in ZIP */
  getZipConfig(config: PackageConfig): Record<string, any> | null
  /**
   * Substrings that must NOT appear anywhere in the final HTML (including
   * JS comments and string literals). The packager scans the generated HTML
   * against this list and refuses to emit the build on match. Used to guard
   * against validator-level rejections that would otherwise be discovered
   * only after upload.
   */
  getForbiddenStrings(): string[]
  /**
   * Substrings that MUST appear in the final HTML. Packager scans and aborts
   * if any are missing. Guards against silent regressions in transitive code
   * (base adapter, runtime-loader) that could strip critical runtime wiring.
   * Example: MRAID defer-boot gate — if missing, video+playable combo goes
   * black screen in prod without any build-time signal.
   */
  getRequiredStrings(): string[]
  /**
   * Extra archives to emit for the same payload, differing only by a `<head>`
   * rewrite (see ArtifactVariant). Default: the primary artifact alone.
   * Only honoured on the single-file-ZIP path.
   */
  getArtifactVariants(config: PackageConfig): ArtifactVariant[]
  /**
   * Extra files to place in the ZIP next to the HTML. Default none.
   * `getZipConfig` owns the hard-coded `config.json`; this hook covers
   * everything else — Luna's upload archive, for instance, must carry a
   * `luna.json` + `playground.json` pair that the single-file hook cannot
   * express.
   */
  getZipExtraFiles(
    config: PackageConfig,
  ): Array<{ zipPath: string; content: string }>
}

/**
 * Build the `window.plbx_html` bridge.
 * This is the API that game code calls for download/redirect.
 * Each network routes these calls to the appropriate SDK.
 * Also aliased as `window.super_html` for backward compatibility.
 *
 * EVERY member below exists on EVERY network. A game is written once and
 * packaged for 25+ targets, so a method that only some adapters define is a
 * TypeError on the rest — the game cannot feature-detect what it does not know
 * is optional. Adapters may make a member *do* more (Mintegral's on_game_start
 * waits for the container; Luna's on_mute_change reports real state), never
 * make it disappear. `tests/packager/plbx-html-surface.test.ts` enforces this.
 *
 * The subscribe-style members (`on_*`) call a late subscriber immediately when
 * the event has already happened, so game code never has to care whether it
 * registered before or after. Cocos boots asynchronously, so it usually did not.
 */
function buildPlbxBridge(downloadBody: string, extras?: string): string {
  return `window.plbx_html = window.plbx_html || {
  google_play_url: "",
  appstore_url: "",
  download: function(url) {
    url = url || this.google_play_url || this.appstore_url || "";
    ${downloadBody}
  },
  game_end: function() {},
  game_ready: function() {},
  // §6 on Mintegral (window.gameRetry); nothing to report to elsewhere.
  game_retry: function() {},
  is_audio: function() { return true; },
  is_hide_download: function() { return false; },
  is_muted: function() { return false; },
  // Default: the ad starts when the creative runs. Only Mintegral has a
  // separate container-fired start (window.gameStart, §5), and its adapter
  // replaces these two. Everywhere else — including the networks that gate boot
  // (Luna's startGame, the MRAID defer-boot gate) — any game code able to
  // subscribe is already past the start, so firing immediately is the truth.
  is_game_started: function() { return true; },
  on_game_start: function(cb) { if (typeof cb === 'function') { try { cb(); } catch (e) {} } },
  // Fires only where the container signals the end of the ad (Mintegral §7
  // today). Registering elsewhere is harmless and keeps game code portable.
  on_game_close: function(cb) { if (typeof cb !== 'function') return; },
  // Luna reports real mute state through this; elsewhere the container never
  // changes it, so a subscriber gets the current value once and nothing more.
  on_mute_change: function(cb) { if (typeof cb === 'function') { try { cb(this.is_muted()); } catch (e) {} } },
  report: function() {},
  tap: function() {},
  external_commands: [],
  expose: function(name, fn, label) {
    if (typeof name !== 'string' || typeof fn !== 'function') return;
    this[name] = fn;
    for (var i = 0; i < this.external_commands.length; i++) { if (this.external_commands[i].name === name) return; }
    this.external_commands.push({ name: name, label: label || name });
    try { parent.postMessage({ type: 'plbx:command', name: name, label: label || name }, '*'); } catch (e) {}
  }
};
window.super_html = window.super_html || window.plbx_html;${extras ? '\n' + extras : ''}`
}

/** MRAID bridge — used by ironSource, AppLovin, Unity, AdColony, etc. */
export function mraidBridge(): string {
  return buildPlbxBridge(
    `if (window.mraid) { url ? mraid.open(url) : mraid.open(); } else if (url) { window.open(url, "_blank"); }`,
    // Game CTA dispatchers often call window.install()/window.open(link) directly
    // (bypassing plbx_html.download). In an MRAID ad container window.open is
    // unreliable/blocked and the network (AppLovin, ironSource, Unity, ...) only
    // tracks the click via mraid.open. Route both to mraid.open.
    `window.install = function() { var d = window.plbx_html.google_play_url || window.plbx_html.appstore_url || ""; if (window.mraid) { d ? mraid.open(d) : mraid.open(); } };
var _plbxOrigOpen = window.open;
window.open = function(u) {
  if (window.mraid) { try { u ? mraid.open(u) : mraid.open(); } catch(e) {} return null; }
  try { return _plbxOrigOpen.apply(window, arguments); } catch(e) { return null; }
};`,
  )
}

/**
 * MRAID defer-boot gate — same pattern as super-html's viewable_start_ads().
 * Defers Cocos boot until the ad has a real render surface. Fixes video+playable
 * combo black screen (AppLovin Axon etc.) where the playable HTML preloads in a
 * hidden WebView while video plays, causing Cocos to init with a 0x0 canvas.
 *
 * Registers window.__plbx_pre_boot(origBoot) — called by runtime-loader AFTER the
 * base64-ZIP unpack, right before Cocos boot. Boot fires as soon as the gate's
 * `ready()` precondition holds; otherwise it waits on real signals (no timer).
 *
 * `ready()` boots when EITHER:
 *   - mraid.isViewable() === true (the network's own signal), OR
 *   - the viewport is a real, visible render surface (innerWidth/Height > 0 and
 *     document.visibilityState === 'visible').
 * The second clause is the deterministic fallback for environments that render
 * the playable but never report viewability — notably Unity Ads server-side
 * moderation, whose headless screenshot otherwise captured a grey #333 screen
 * (Cocos never booted) and rejected the creative as "content is non-functional".
 *
 * Two robustness mechanisms, NO arbitrary "boot anyway after N ms" timer:
 *   - viewableChange listener — covers becomes-viewable-later.
 *   - bounded isViewable() poll — SAME pattern as the moloco-v2 viewable handler:
 *     the network can fire the FIRST viewableChange(true) during the ZIP-unpack
 *     window, BEFORE this listener attaches (the pulse is lost). Polling catches
 *     the already-viewable and missed-first-pulse cases the lone listener cannot.
 *
 * If no mraid at all → boot immediately (runtime preview, validators without MRAID).
 */
export function mraidDeferBootGate(): string {
  return `window.__plbx_pre_boot = function(boot) {
  var done = false;
  function go() { if (done) return; done = true; try { boot(); } catch(e) {} }
  if (!window.mraid) { go(); return; }
  function ready() {
    try { if (typeof mraid.isViewable === 'function' && mraid.isViewable()) return true; } catch(e) {}
    var w = window.innerWidth, h = window.innerHeight;
    var visible = (typeof document.visibilityState === 'undefined') || document.visibilityState === 'visible';
    return w > 0 && h > 0 && visible;
  }
  function tryBoot() { if (ready()) { go(); return true; } return false; }
  if (tryBoot()) return;
  function attach() {
    try { mraid.addEventListener('viewableChange', function(v) { if (v) tryBoot(); }); } catch(e) {}
  }
  (mraid.getState && mraid.getState() === 'loading') ? mraid.addEventListener('ready', attach) : attach();
  window.addEventListener('resize', tryBoot);
  try { document.addEventListener('visibilitychange', tryBoot); } catch(e) {}
  (function poll(n) {
    if (done) return;
    if (tryBoot()) return;
    if (n > 0) setTimeout(function() { poll(n - 1); }, 200);
  })(50);
};`
}

/** Facebook/Moloco bridge */
export function facebookBridge(): string {
  return buildPlbxBridge(
    `if (window.FbPlayableAd) { FbPlayableAd.onCTAClick(); } else if (url) { window.open(url, "_blank"); }`,
    // Some game CTA dispatchers call window.install() / window.open() DIRECTLY
    // (bypassing plbx_html.download). In Facebook's sandboxed frame window.open()
    // is blocked ("'allow-popups' permission not set") AND the FB validator never
    // sees the click. So route BOTH paths to the FB SDK:
    //   - window.install (Mintegral CTA name; harmless here, no Mintegral SDK on FB)
    //     covers dispatchers that prefer window.install() (e.g. train-miner2-c4).
    //   - window.open override covers older dispatchers that call window.open(link)
    //     directly (e.g. train-miner v1). window.open is blocked on FB regardless,
    //     so redirecting it to onCTAClick strictly improves tracking.
    `window.install = function() { if (window.FbPlayableAd && FbPlayableAd.onCTAClick) FbPlayableAd.onCTAClick(); };
var _plbxOrigOpen = window.open;
window.open = function(u) {
  if (window.FbPlayableAd && FbPlayableAd.onCTAClick) { try { FbPlayableAd.onCTAClick(); } catch(e) {} return null; }
  try { return _plbxOrigOpen.apply(window, arguments); } catch(e) { return null; }
};`,
  )
}

/** Snapchat bridge — Snap App Playables provide window.ScPlayableAd (NOT MRAID; mraid.js is forbidden). */
export function snapchatBridge(): string {
  return buildPlbxBridge(
    `if (window.ScPlayableAd) { ScPlayableAd.onCTAClick(); } else if (url) { window.open(url, "_blank"); }`,
    // Route game dispatchers that call window.install()/window.open() directly to the
    // Snap SDK — Snapchat only tracks the click via ScPlayableAd.onCTAClick(). Same
    // shape as facebookBridge, swapping FbPlayableAd → ScPlayableAd.
    `window.install = function() { if (window.ScPlayableAd && ScPlayableAd.onCTAClick) ScPlayableAd.onCTAClick(); };
var _plbxOrigOpen = window.open;
window.open = function(u) {
  if (window.ScPlayableAd && ScPlayableAd.onCTAClick) { try { ScPlayableAd.onCTAClick(); } catch(e) {} return null; }
  try { return _plbxOrigOpen.apply(window, arguments); } catch(e) { return null; }
};`,
  )
}

/** Google Ads bridge */
export function googleBridge(): string {
  return buildPlbxBridge(
    `if (window.ExitApi) { ExitApi.exit(); } else { var dest = url || window.clickTag || ""; if (dest) window.open(dest, "_blank"); }`,
    [
      `window.plbx_html.is_hide_download = function() { return true; };`,
      // Game CTA dispatchers calling window.install()/window.open() directly must
      // route to ExitApi.exit() — Google tracks the click only via ExitApi.
      `window.install = function() { if (window.ExitApi) ExitApi.exit(); };
var _plbxOrigOpen = window.open;
window.open = function(u) {
  if (window.ExitApi) { try { ExitApi.exit(); } catch(e) {} return null; }
  try { return _plbxOrigOpen.apply(window, arguments); } catch(e) { return null; }
};`,
    ].join('\n'),
  )
}

/**
 * Mintegral bridge — CTA through window.install() (§2: the playable must never
 * redirect itself).
 *
 * Lives here, built from buildPlbxBridge like every other bridge. It used to be
 * hand-rolled in mintegral.ts and had drifted: game_ready, is_muted, report and
 * tap were simply absent, so a game calling any of them threw on Mintegral and
 * nowhere else.
 *
 * gameStart/gameClose are NOT here — they are container-called hooks with their
 * own dispatchers (see mintegralLifecycle). game_end and game_retry are the
 * creative→container direction and belong on the bridge.
 */
export function mintegralBridge(): string {
  return buildPlbxBridge(
    `if (window.install) { window.install(); }
    else if (url) {
      var ua = navigator.userAgent || "";
      /iPhone/i.test(ua) ? window.location.href = url : window.open(url, "_blank");
    }`,
    `window.plbx_html.game_end = function() { if (typeof window.gameEnd === 'function') { try { window.gameEnd(); } catch(e) {} } };
window.plbx_html.game_retry = function() { if (typeof window.gameRetry === 'function') { try { window.gameRetry(); } catch(e) {} } };`,
  )
}

/** TikTok/Pangle bridge — uses playableSDK for CTA, gameReady, and gameClose */
export function tiktokBridge(): string {
  return buildPlbxBridge(
    `if (window.playableSDK) { playableSDK.openAppStore(); } else if (url) { window.open(url, "_blank"); }`,
    [
      `window.plbx_html.game_ready = function() { if (window.playableSDK && playableSDK.reportGameReady) { playableSDK.reportGameReady(); } };`,
      `window.plbx_html.game_end = function() { if (window.playableSDK && playableSDK.reportGameClose) { playableSDK.reportGameClose(); } };`,
      // Game CTA dispatchers calling window.install()/window.open() directly must
      // route to playableSDK.openAppStore() — TikTok/Pangle track via the SDK.
      `window.install = function() { if (window.playableSDK && playableSDK.openAppStore) playableSDK.openAppStore(); };
var _plbxOrigOpen = window.open;
window.open = function(u) {
  if (window.playableSDK && playableSDK.openAppStore) { try { playableSDK.openAppStore(); } catch(e) {} return null; }
  try { return _plbxOrigOpen.apply(window, arguments); } catch(e) { return null; }
};`,
    ].join('\n'),
  )
}

/**
 * Vungle (Liftoff MONETIZE) Adaptive Creative bridge — postMessage-driven, NOT
 * MRAID and NOT SDK-global-driven like the other custom bridges above.
 *
 * Not to be confused with the `liftoff` network in the registry: that is Liftoff
 * Accelerate/DSP, which IS MRAID (`mraid: true`) and must NOT use this bridge.
 * Vungle
 * tracks neither `window.open()` nor an empty `game_end`; it wants two
 * string messages posted to `parent`:
 *
 *   - CTA (synchronous, inside the user-gesture `download()` call):
 *       parent.postMessage('download', '*')
 *   - Result/endcard (`game_end()`):
 *       parent.postMessage('complete', '*')
 *
 * The store URL is intentionally unused — Vungle consumes the event itself,
 * not a direct store link, so `download` fires unconditionally. `complete`
 * is wired through `game_end`, never through the CTA, keeping the two
 * lifecycle signals independent (one CTA tap must not also close the ad).
 * Keep in sync with expectedCtaMethod('vungle') and the Vungle preview mock
 * in preview/sdk-mocks.ts ('download' -> vungle_download, 'complete' ->
 * vungle_complete).
 */
export function vungleBridge(): string {
  return buildPlbxBridge(
    `try { parent.postMessage('download', '*'); } catch (e) {}`,
    // Same trap as the MRAID/Facebook bridges: plenty of game CTA dispatchers never
    // touch plbx_html.download() and just call window.install() or window.open(link)
    // themselves. Vungle tracks neither — the click would vanish exactly the way it
    // did before this adapter existed. Route both to the `download` postMessage and
    // swallow the navigation (an Adaptive Creative must not reach the store itself).
    // `complete` is deliberately NOT touched here: Vungle forbids download and
    // complete firing together, so only game_end may send it.
    `window.install = function() { try { parent.postMessage('download', '*'); } catch (e) {} };
window.open = function(u) { try { parent.postMessage('download', '*'); } catch (e) {} return null; };
window.plbx_html.game_end = function() { try { parent.postMessage('complete', '*'); } catch (e) {} };`,
  )
}

/** Generic fallback bridge */
export function genericBridge(): string {
  return buildPlbxBridge(`if (url) { window.open(url, "_blank"); }`)
}

/**
 * Luna (Unity Playworks) bridge.
 *
 * Luna is an authoring/export platform, not a delivery network: it re-exports our
 * archive per ad network and injects that network's SDK itself. So the contract
 * here is Luna's own, and it owns three things we must hand over:
 *
 *  - the BOOT — "all startup logic inside startGame()", which Luna calls once the
 *    container is ready (docs: JS playables / setup);
 *  - the CTA — Luna's standard **Ad Click** event fires from
 *    `Luna.Unity.Playable.InstallFullGame()` and from nowhere else, so a CTA that
 *    reaches the store any other way is simply not counted;
 *  - the CONTAINER LIFECYCLE — the `luna:*` window events below.
 *
 * We add the analytics CHANNEL (`plbx_html.log_event`) but never concrete events:
 * `playtime_10s` and level funnels are the game project's business.
 *
 * Every call into Luna is wrapped — a throw inside a container callback would take
 * the whole playable down, and the SDK globals are absent in local dev entirely.
 */
export function lunaBridge(): string {
  return buildPlbxBridge(
    // The url argument is deliberately ignored: Luna resolves the store link
    // itself from luna.json, and only InstallFullGame() registers the click.
    `_plbx_luna_install();`,
    `// --- Boot gate. Luna's contract is "define startGame(), we call it".
//
// startGame is defined RIGHT HERE, synchronously at bridge-injection time, and
// NOT inside __plbx_pre_boot: the runtime loader calls __plbx_pre_boot only
// AFTER it has unpacked the base64/JSZip asset payload. Measured on a packaged
// 3.5 MB artifact in headless Chromium: at the load event (t=186ms) startGame
// did not exist yet, it appeared at t=274ms. A host that calls startGame() on
// load — Luna does — hit "startGame is not a function", and because window.Luna
// is present the self-start fallback below is disabled, so the creative sat on
// the splash for the entire impression. Now the early call is recorded and boot
// happens the moment the loader hands us its callback.
var _plbx_luna_started = false, _plbx_luna_go = null;
window.startGame = function() {
  if (_plbx_luna_started) return;                 // Luna may call it more than once
  _plbx_luna_started = true;
  if (_plbx_luna_go) { try { _plbx_luna_go(); } catch(e) { console.error('[plbx] luna boot:', e); } }
  // else: loader not up yet — __plbx_pre_boot boots as soon as it arrives.
};
window.__plbx_pre_boot = function(go) {
  _plbx_luna_go = go;
  if (_plbx_luna_started) { try { go(); } catch(e) { console.error('[plbx] luna boot:', e); } return; }
  // No Luna host (local dev, or our preview without the mock) — nobody will ever
  // call startGame(), so start ourselves instead of hanging on the splash.
  if (!window.Luna) window.startGame();
};

// --- CTA. Assigned explicitly rather than left to the object literal above,
// which is skipped whenever the game pre-defines window.plbx_html: every
// dispatcher path (plbx_html.download, the super_html alias, a bare
// window.install()) has to reach InstallFullGame or Ad Click never fires.
function _plbx_luna_install() {
  try { Luna.Unity.Playable.InstallFullGame(); } catch(e) { console.error('[plbx] luna cta:', e); }
}
window.plbx_html.download = _plbx_luna_install;
window.install = _plbx_luna_install;
// Same trap the Facebook/Snap/Google/TikTok/Vungle bridges already close: plenty
// of game CTA dispatchers never touch plbx_html.download and call window.open(link)
// themselves (train-miner v1). Under Luna such a click reaches nothing —
// InstallFullGame() is the ONLY thing that raises Luna's standard Ad Click — so
// the click would be missing for EVERY network Luna re-exports to. With no Luna
// host (local dev) fall through to the real window.open so the CTA still works.
var _plbxOrigOpen = window.open;
window.open = function(u) {
  if (window.Luna) { _plbx_luna_install(); return null; }
  try { return _plbxOrigOpen.apply(window, arguments); } catch(e) { return null; }
};

// --- Game end. Luna requires it for the Mintegral/Vungle exports; inert elsewhere.
window.plbx_html.game_end = function() {
  try { Luna.Unity.LifeCycle.GameEnded(); } catch(e) { console.error('[plbx] luna game_end:', e); }
};

// --- Analytics channel. window.pi is injected by Luna's exporter, so it is
// missing in local dev and during early boot. Calls made before it appears are
// queued and flushed, because a silent drop is the failure mode we are guarding
// against. The cap is Luna's per-SESSION limit (256) — the 32 that used to sit
// here is Luna's per-NAME limit and sizing the whole queue by it threw away
// events a conforming playable is allowed to send. Overflow is counted and
// surfaced (one console.warn + a counter the preview can read off plbx_html),
// because an UNCOUNTED drop is exactly the silence this queue exists to prevent.
var _plbx_luna_q = [], _PLBX_LUNA_Q_MAX = 256, _plbx_luna_warned = false;
window.plbx_html.luna_dropped_events = 0;
function _plbx_luna_pi() {
  return (window.pi && typeof window.pi.logCustomEvent === 'function') ? window.pi : null;
}
function _plbx_luna_send(name, value) {
  try { window.pi.logCustomEvent(name, value); } catch(e) { console.error('[plbx] luna event:', e); }
}
// True once pi is live AND the backlog has been handed over. Draining before
// every send is what keeps a funnel readable: sending the fresh event first
// delivered it to Luna AHEAD of the older queued ones.
function _plbx_luna_drain() {
  if (!_plbx_luna_pi()) return false;
  while (_plbx_luna_q.length) { var e = _plbx_luna_q.shift(); _plbx_luna_send(e[0], e[1]); }
  return true;
}
window.plbx_html.log_event = function(name, value) {
  // Luna drops a string-named event that carries no integer parameter, so a
  // missing or non-numeric value becomes 1 rather than nothing.
  var v = (typeof value === 'number' && isFinite(value)) ? (value | 0) : 1;
  if (_plbx_luna_drain()) { _plbx_luna_send(name, v); return; }
  if (_plbx_luna_q.length < _PLBX_LUNA_Q_MAX) { _plbx_luna_q.push([name, v]); return; }
  window.plbx_html.luna_dropped_events++;
  if (!_plbx_luna_warned) {
    _plbx_luna_warned = true;
    console.warn('[plbx] luna: analytics queue full at ' + _PLBX_LUNA_Q_MAX + ' events, dropping (window.pi never appeared?)');
  }
};
// Bounded poll — 50 tries x 100ms, the same bound mraidDeferBootGate uses. The
// unbounded re-arm it replaces left a 10 Hz timer running for the whole life of
// the ad whenever window.pi never showed up (local dev, any non-Luna host).
// Giving up is safe: log_event drains the backlog itself if pi appears later.
(function _plbx_luna_flush(n) {
  if (_plbx_luna_drain()) return;
  if (n > 0) { setTimeout(function() { _plbx_luna_flush(n - 1); }, 100); return; }
  if (_plbx_luna_q.length) console.warn('[plbx] luna: window.pi never appeared; ' + _plbx_luna_q.length + ' event(s) still queued');
})(50);

// --- Container lifecycle. Luna fires these on window. Everything is guarded:
// a throw inside a container callback takes the whole playable down.
// 'luna:build' is deliberately unhandled — it fires right after load, and boot
// is gated on startGame().
//
// Muting: cc.audioEngine is the Cocos Creator **2.x** API. The 3.8 web-mobile
// builds we actually ship contain ZERO references to it — they play through Web
// Audio (AudioContext) + AudioSource — so an audioEngine-only mute was a silent
// no-op on the primary target: the ad kept making noise after Luna muted it,
// which downstream networks flag as audio-on-mute. So track the contexts
// themselves. This bridge runs before the engine boots, so patching the
// constructor here catches every context Cocos creates; same approach as the
// preview mock in preview/sdk-mocks.ts. The 2.x call and the <audio>/<video>
// pass stay as additional, independently guarded paths — a build may use any of
// the three, and one of them throwing must not skip the other two.
//
// Suspending is NOT enough on its own. Cocos 3.8's AudioContextAgent has
//   runContext = function () { ... if ("suspended" === i.state)
//                                    i.resume().catch(...) ... }
// and calls it from AudioPlayerWeb.doPlay() and AudioPlayerWebOneShot.play(),
// i.e. on EVERY playback attempt (plus from a touchend/mouseup handler it
// installs on GameCanvas). So a bare suspend() lasts exactly until the game
// plays its next sound — Luna mutes, one more sound plays, the ad is audible
// again while the container still believes it is muted. Therefore, while
// muted, resume() itself is neutralised on the tracked contexts: the engine's
// resume becomes a no-op and only luna:unmute (which puts the original back)
// can bring audio back.
var _plbx_luna_ctxs = [], _plbx_luna_muted = false;
// The engine chains on the return value (i.resume().catch(...), and .then(...)
// in the gesture path), so the stand-in must be thenable or Cocos throws
// inside its own play path.
function _plbx_luna_no_resume() { return Promise.resolve(); }
// A closed context rejects/throws on suspend()/resume(); swallow both shapes so
// one dead context cannot break the mute of the others (or raise an unhandled
// rejection in the ad).
function _plbx_luna_settle(p) {
  try { if (p && typeof p.catch === 'function') p.catch(function() {}); } catch(e) {}
}
function _plbx_luna_quiet(ctx) {
  // Stash the original ONCE: a second mute must not stash our own no-op as
  // "the original", which would make the next unmute restore a no-op and leave
  // the ad silent for good.
  if (!ctx._plbx_luna_resume) {
    ctx._plbx_luna_resume = ctx.resume;
    ctx.resume = _plbx_luna_no_resume;
  }
  _plbx_luna_settle(ctx.suspend());
}
function _plbx_luna_loud(ctx) {
  if (ctx._plbx_luna_resume) {
    ctx.resume = ctx._plbx_luna_resume;
    ctx._plbx_luna_resume = null;
  }
  _plbx_luna_settle(ctx.resume());
}
(function() {
  try {
    var _AC = window.AudioContext || window.webkitAudioContext;
    if (!_AC) return;
    var _PlbxLunaAC = function AudioContext(opts) {
      // Options are forwarded — Cocos passes { latencyHint } on some platforms
      // and swallowing it would change playback behaviour.
      var ctx = (opts === undefined) ? new _AC() : new _AC(opts);
      _plbx_luna_ctxs.push(ctx);
      // Cocos builds its context lazily on the first sound, which can land
      // AFTER Luna muted us — born muted, or that first sound escapes.
      if (_plbx_luna_muted) { try { _plbx_luna_quiet(ctx); } catch(e) {} }
      return ctx;
    };
    _PlbxLunaAC.prototype = _AC.prototype;
    window.AudioContext = _PlbxLunaAC;
    if (window.webkitAudioContext) window.webkitAudioContext = _PlbxLunaAC;
  } catch(e) {}
})();
function _plbx_luna_audio(muted) {
  _plbx_luna_muted = muted;
  for (var i = 0; i < _plbx_luna_ctxs.length; i++) {
    // Per-context guard: a closed/broken context must not cost the others
    // their mute.
    try { muted ? _plbx_luna_quiet(_plbx_luna_ctxs[i]) : _plbx_luna_loud(_plbx_luna_ctxs[i]); } catch(e) {}
  }
  try {
    if (window.cc && window.cc.audioEngine) {
      if (muted) { window.cc.audioEngine.pauseAll(); } else { window.cc.audioEngine.resumeAll(); }
    }
  } catch(e) {}
  try {
    var m = document.querySelectorAll('audio, video');
    for (var j = 0; j < m.length; j++) { m[j].muted = muted; }
  } catch(e) {}
}
window.addEventListener('luna:pause', function() { try { if (window.cc && cc.game) cc.game.pause(); } catch(e) {} });
window.addEventListener('luna:resume', function() { try { if (window.cc && cc.game) cc.game.resume(); } catch(e) {} });
window.addEventListener('luna:mute', function() { _plbx_luna_audio(true); });
window.addEventListener('luna:unmute', function() { _plbx_luna_audio(false); });`,
  )
}

export class BaseAdapter implements NetworkAdapter {
  constructor(
    public readonly networkId: string,
    protected readonly networkConfig: NetworkConfig,
  ) {}

  /** Override in subclasses for network-specific bridge */
  protected getPlbxBridge(_config: PackageConfig): string {
    if (this.networkConfig.mraid) return mraidBridge()
    return genericBridge()
  }

  transform(builder: HtmlBuilder, config: PackageConfig): void {
    // Inject MRAID if needed
    if (this.networkConfig.mraid) {
      builder.injectHeadScript('mraid.js')
      // Defer Cocos boot until mraid.isViewable() — fixes video+playable combo black screen
      builder.injectBodyScript(mraidDeferBootGate())
    }
    // Inject SDK URL if specified
    if (this.networkConfig.sdkUrl) {
      builder.injectHeadScript(this.networkConfig.sdkUrl)
    }
    // Inject SDK inline JS if specified
    if (this.networkConfig.sdkInline) {
      builder.injectBodyScript(this.networkConfig.sdkInline)
    }

    // Inject plbx_html bridge (store URLs from config)
    const bridge = this.getPlbxBridge(config)
    const storeSetup = [
      config.storeUrlIos
        ? `window.plbx_html.appstore_url = "${config.storeUrlIos}";`
        : '',
      config.storeUrlAndroid
        ? `window.plbx_html.google_play_url = "${config.storeUrlAndroid}";`
        : '',
      // super-html channel marker. Games written for super-html (e.g. train-miner)
      // detect the build via `window.super_html_channel` and route CTA through
      // `super_html.download()` (which we alias to plbx_html.download → the right
      // per-network SDK) + set their own store URLs. Without it the game falls to
      // window.install()/window.open() which is unreliable/blocked in ad sandboxes.
      `window.super_html_channel = "${this.networkId}";`,
    ]
      .filter(Boolean)
      .join('\n')
    builder.injectBodyScript(bridge + (storeSetup ? '\n' + storeSetup : ''))

    // Inject custom head from config
    if (config.customInjectHead) {
      builder.injectBodyScript(config.customInjectHead)
    }
    // Inject custom body from config
    if (config.customInjectBody) {
      builder.injectBodyScript(config.customInjectBody)
    }
  }

  getJsBundleName(): string | null {
    return this.networkConfig.jsBundle || null
  }

  getZipConfig(config: PackageConfig): Record<string, any> | null {
    return this.networkConfig.zipConfig || null
  }

  getZipExtraFiles(
    _config: PackageConfig,
  ): Array<{ zipPath: string; content: string }> {
    return []
  }

  getArtifactVariants(_config: PackageConfig): ArtifactVariant[] {
    return [{ suffix: '', transformHtml: (html) => html }]
  }

  getForbiddenStrings(): string[] {
    return forbiddenStringsFor(this.networkId)
  }

  getRequiredStrings(): string[] {
    // MRAID networks must ship the defer-boot gate — without it, video+playable
    // combo (AppLovin Axon, etc.) shows black screen because Cocos initializes
    // in hidden WebView with 0x0 canvas.
    if (this.networkConfig.mraid) {
      return [
        '__plbx_pre_boot = function',
        'mraid.isViewable',
        'viewableChange',
        // Render-surface fallback — without it, environments that never report
        // viewability (Unity Ads headless moderation) grey-screen the creative.
        'document.visibilityState',
        'mraid.js',
      ]
    }
    return []
  }
}
