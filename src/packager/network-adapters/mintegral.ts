import { HtmlBuilder } from '../html-builder'
import { NetworkConfig, PackageConfig } from '../../types'
import { BaseAdapter } from './base'

const MINTEGRAL_VIEWPORT =
  'width=device-width,user-scalable=no,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0'

/**
 * Build Mintegral-specific plbx_html bridge.
 *
 * The PlayTurbo lifecycle has TWO directions, and the names alone do not say
 * which (https://www.playturbo.com/review/doc):
 *
 *   creative CALLS  → window.install()   CTA (§2)
 *                     window.gameEnd()   playable won/lost (§3)
 *                     window.gameReady() assets loaded (§4)
 *                     window.gameRetry() replay initiated (§6, only if the
 *                                        playable offers a replay)
 *   creative DEFINES ← window.gameStart() "we will automatically call this
 *                                        function at the beginning" (§5)
 *                     window.gameClose() "we will automatically call this
 *                                        function at the end" (§7)
 *
 * The two DEFINES are hooks for the game — the spec's own examples are
 * "starting the countdown, starting the background music" and "turn off this
 * background music". Games reach them through plbx_html.on_game_start /
 * on_game_close rather than by assigning the globals, so the packager keeps
 * ownership of the global and a game can subscribe at any point in its boot.
 *
 * Do NOT call gameClose() from download() or game_end(): the container owns
 * that timing. Calling it on a CTA tap ran the game's end-of-ad cleanup in the
 * middle of the ad — with the spec's own example hook, that killed the music.
 */
function mintegralBridge(): string {
  return `window.plbx_html = window.plbx_html || {
  google_play_url: "",
  appstore_url: "",
  download: function(url) {
    url = url || this.google_play_url || this.appstore_url || "";
    if (window.install) { window.install(); }
    else if (url) {
      var ua = navigator.userAgent || "";
      /iPhone/i.test(ua) ? window.location.href = url : window.open(url, "_blank");
    }
  },
  game_end: function() {
    if (typeof window.gameEnd === 'function') { try { window.gameEnd(); } catch(e) {} }
  },
  game_retry: function() {
    if (typeof window.gameRetry === 'function') { try { window.gameRetry(); } catch(e) {} }
  },
  is_audio: function() { return true; },
  is_hide_download: function() { return false; },
  external_commands: [],
  expose: function(name, fn, label) {
    if (typeof name !== 'string' || typeof fn !== 'function') return;
    this[name] = fn;
    for (var i = 0; i < this.external_commands.length; i++) { if (this.external_commands[i].name === name) return; }
    this.external_commands.push({ name: name, label: label || name });
    try { parent.postMessage({ type: 'plbx:command', name: name, label: label || name }, '*'); } catch (e) {}
  }
};
window.super_html = window.super_html || window.plbx_html;`
}

/**
 * Mintegral's two container-called hooks, wired to plbx_html subscribers.
 *
 * PlayTurbo calls window.gameStart() at the start of the playable and
 * window.gameClose() at the end (§5, §7). Both used to be guarded no-op stubs,
 * so the container's call reached nothing and a game had no way in — the spec's
 * own use cases (start the countdown/BGM, stop the BGM) were unreachable.
 *
 * Runs right after the bridge and long before the loader, whose own
 * `if (typeof window.gameStart !== 'function')` stubs then no-op. That ordering
 * is what lets these dispatchers own the globals; the loader stubs stay as the
 * fallback for networks without a lifecycle adapter.
 *
 * A subscriber registering after the container already fired is called
 * immediately: Cocos boots asynchronously, so a scene that subscribes in
 * onLoad can easily be later than gameStart, and silently missing the start
 * signal is exactly the bug this replaces.
 *
 * A pre-existing window.gameStart/gameClose (a game that assigns the global
 * itself, the pattern the spec shows) is kept and called first, so this is
 * additive rather than a hijack.
 */
function mintegralLifecycle(): string {
  return `(function () {
  var started = false, closed = false;
  var startSubs = [], closeSubs = [];
  function run(subs) {
    for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) {} }
  }
  function subscribe(subs, fired, cb) {
    if (typeof cb !== 'function') return;
    subs.push(cb);
    if (fired) { try { cb(); } catch (e) {} }
  }
  window.plbx_html = window.plbx_html || {};
  window.plbx_html.on_game_start = function (cb) { subscribe(startSubs, started, cb); };
  window.plbx_html.on_game_close = function (cb) { subscribe(closeSubs, closed, cb); };
  window.plbx_html.is_game_started = function () { return started; };
  var priorStart = typeof window.gameStart === 'function' ? window.gameStart : null;
  var priorClose = typeof window.gameClose === 'function' ? window.gameClose : null;
  window.gameStart = function () {
    started = true;
    if (priorStart) { try { priorStart(); } catch (e) {} }
    run(startSubs);
  };
  window.gameClose = function () {
    closed = true;
    if (priorClose) { try { priorClose(); } catch (e) {} }
    run(closeSubs);
  };
})();`
}

/**
 * Mintegral adapter.
 * - Renames JS bundle to creative.js (handled via networkConfig.jsBundle)
 * - Injects custom viewport meta
 * - Injects Mintegral-specific bridge (install-based CTA)
 * - Injects the gameStart/gameClose dispatchers the container calls into
 */
export class MintegralAdapter extends BaseAdapter {
  constructor(networkId: string, networkConfig: NetworkConfig) {
    super(networkId, networkConfig)
  }

  protected getPlbxBridge(_config: PackageConfig): string {
    return mintegralBridge()
  }

  transform(builder: HtmlBuilder, config: PackageConfig): void {
    super.transform(builder, config)
    builder.injectMeta('viewport', MINTEGRAL_VIEWPORT)
    builder.injectBodyScript(mintegralLifecycle())
  }

}
